import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { authorizeSubPartner } from '@/lib/partner-access'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'
import { createClient } from '@supabase/supabase-js'
import { getTransferStatus } from '@/services/payout'
import { transactionStatus } from '@/services/bbps'
import { checkTransactionStatus as shadvalCheckStatus } from '@/services/shadval-pay'
import { creditSettlementFeeToPlatformWallet } from '@/lib/wallet/platform-revenue-wallet'
import { reverseServiceCommission } from '@/lib/commission/distribute-service-commission'
import { refundShadvalSettlement } from '@/lib/settlement-2/shadval-refund'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/reports/service-transactions/verify
 *
 * Verifies a pending transaction's status with the provider API.
 * If failed/reversal → refunds wallet (amount + charges) + reverses commissions.
 * If success → updates status only.
 * If still pending → no change.
 *
 * Body: { service_type: 'Settlement' | 'BBPS', transaction_id: string }
 * Auth: admin, finance_executive, retailer, partner (retailer/partner: own txns only)
 */
export async function POST(request: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const access = authorizeSubPartner(user, 'reports')
    if (!access.ok) return access.response

    const allowedRoles = ['admin', 'finance_executive', 'retailer', 'partner']
    if (!allowedRoles.includes(user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const body = await request.json()
    const { service_type, transaction_id, settlement_source } = body

    if (!service_type || !transaction_id) {
      return NextResponse.json({ error: 'service_type and transaction_id are required' }, { status: 400 })
    }

    const isAdmin = ['admin', 'finance_executive'].includes(user.role)

    if (service_type === 'Settlement') {
      // A "Settlement" row can originate from 3 different tables. Route to the
      // matching provider/refund path. Older clients may not send the source —
      // fall back to auto-detection by looking the id up across tables.
      const source = settlement_source || (await detectSettlementSource(supabase, transaction_id))

      if (source === 'shadval') {
        return await verifyShadval(supabase, user, isAdmin, transaction_id, request)
      }
      if (source === 'settlements') {
        return await verifySettlements(supabase, user, isAdmin, transaction_id, request)
      }
      // Default: SparkUp/ExpressPay payout (payout_transactions)
      return await verifyPayout(supabase, user, isAdmin, transaction_id, request)
    } else if (service_type === 'BBPS') {
      return await verifyBBPS(supabase, user, isAdmin, transaction_id, request)
    }

    return NextResponse.json({ error: `Unsupported service_type: ${service_type}. Supported: Settlement, BBPS` }, { status: 400 })
  } catch (err: any) {
    console.error('[Verify] Unhandled error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}

// ============================================================================
// PAYOUT / SETTLEMENT VERIFICATION
// ============================================================================

async function verifyPayout(
  supabase: ReturnType<typeof createClient>,
  user: any,
  isAdmin: boolean,
  txId: string,
  request: NextRequest
) {
  // Fetch transaction
  let query = supabase
    .from('payout_transactions')
    .select('id, retailer_id, client_ref_id, transaction_id, status, amount, charges, wallet_debited, created_at, transfer_mode')
    .eq('id', txId)

  // Non-admin: ownership check
  if (!isAdmin) {
    query = query.eq('retailer_id', user.partner_id)
  }

  const { data: tx, error: txErr } = await query.maybeSingle()

  if (txErr || !tx) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  }

  if (!['pending', 'processing'].includes(tx.status)) {
    return NextResponse.json({
      success: true,
      action: 'no_change',
      message: `Transaction is already ${tx.status}. No verification needed.`,
      status: tx.status,
    })
  }

  // No UTR → can't verify with provider
  if (!tx.transaction_id) {
    return NextResponse.json({
      success: true,
      action: 'no_change',
      message: 'Transaction has no UTR reference. Cannot verify with provider. Awaiting manual review.',
      status: tx.status,
    })
  }

  // Check with provider
  const statusResult = await getTransferStatus({ transactionId: tx.transaction_id })

  if (!statusResult.success || !statusResult.status) {
    return NextResponse.json({
      success: true,
      action: 'provider_error',
      message: 'Could not reach provider. Please try again later.',
      status: tx.status,
    })
  }

  const newStatus = statusResult.status

  // Still pending at provider
  if (['pending', 'processing'].includes(newStatus)) {
    return NextResponse.json({
      success: true,
      action: 'still_pending',
      message: 'Transaction is still pending at provider.',
      status: newStatus,
    })
  }

  // SUCCESS
  if (newStatus === 'success') {
    await supabase
      .from('payout_transactions')
      .update({
        status: 'success',
        rrn: statusResult.operator_id || null,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', tx.id)
      .in('status', ['pending', 'processing'])

    await logVerifyActivity(request, user, 'payout_verify_success', tx.id, { previous_status: tx.status, new_status: 'success' })

    return NextResponse.json({
      success: true,
      action: 'marked_success',
      message: 'Transaction confirmed successful by provider.',
      status: 'success',
      refunded: false,
    })
  }

  // FAILED — atomic claim + refund + commission reversal
  if (newStatus === 'failed') {
    const { data: claimed } = await supabase
      .from('payout_transactions')
      .update({
        status: 'refunded',
        failure_reason: statusResult.status_message || 'Transaction failed (verified)',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', tx.id)
      .in('status', ['pending', 'processing'])
      .select('id')

    if (!claimed || claimed.length === 0) {
      return NextResponse.json({
        success: true,
        action: 'already_processed',
        message: 'Transaction was already processed by another request.',
        status: 'refunded',
        refunded: false,
      })
    }

    let refundedAmount = 0
    let refundCritical = false

    // Refund wallet (amount + charges)
    if (tx.wallet_debited) {
      const totalAmount = parseFloat(String(tx.amount)) + parseFloat(String(tx.charges || 0))

      const { error: refundErr } = await supabase.rpc('add_ledger_entry', {
        p_user_id: tx.retailer_id,
        p_user_role: resolveRole(tx.retailer_id),
        p_wallet_type: 'primary',
        p_fund_category: 'payout',
        p_service_type: 'payout',
        p_tx_type: 'REFUND',
        p_credit: totalAmount,
        p_debit: 0,
        // Same reference_id as cron/status paths → DB unique index (reference_id, retailer_id)
        // becomes a hard backstop against double-refund even if a race slips past the status claim.
        p_reference_id: `REFUND_${tx.client_ref_id}`,
        p_transaction_id: tx.id,
        p_status: 'completed',
        p_remarks: `Payout failed - Refund via verification: ${statusResult.status_message || 'Provider confirmed failed'}`,
      })

      if (refundErr) {
        // Duplicate = money was already refunded by another path (cron/status). Benign.
        if (isDuplicateLedgerError(refundErr)) {
          refundedAmount = totalAmount
        } else {
          // Genuine failure AFTER status was claimed 'refunded' → money NOT returned.
          // Stamp the transaction so it surfaces in the admin critical-alerts banner.
          refundCritical = true
          await supabase
            .from('payout_transactions')
            .update({
              failure_reason: `${statusResult.status_message || 'Transaction failed'} [CRITICAL: REFUND_FAILED - Manual review required] (${refundErr.message})`,
              updated_at: new Date().toISOString(),
            })
            .eq('id', tx.id)
          console.error(`[Verify] 🚨 CRITICAL: Payout ${tx.id} marked refunded but wallet refund FAILED:`, refundErr.message)
        }
      } else {
        refundedAmount = totalAmount
      }
    }

    // Reverse commissions (skip if refund itself failed — needs manual review first)
    if (!refundCritical) {
      await reversePayoutCommissions(supabase, tx)
    }

    if (refundCritical) {
      await logVerifyActivity(request, user, 'payout_verify_refund_FAILED_CRITICAL', tx.id, {
        previous_status: tx.status,
        new_status: 'refunded',
        refund_failed: true,
      })
      return NextResponse.json({
        success: false,
        action: 'refund_failed_critical',
        critical: true,
        message: `⚠️ CRITICAL: Transaction marked failed but wallet refund did NOT complete. Manual review required for txn ${tx.id}.`,
        status: 'refunded',
        refunded: false,
      }, { status: 500 })
    }

    await logVerifyActivity(request, user, 'payout_verify_failed_refunded', tx.id, {
      previous_status: tx.status,
      new_status: 'refunded',
      refunded_amount: refundedAmount,
      reason: statusResult.status_message,
    })

    return NextResponse.json({
      success: true,
      action: 'failed_and_refunded',
      message: `Transaction failed. ₹${refundedAmount.toFixed(2)} refunded to wallet. Commissions reversed.`,
      status: 'refunded',
      refunded: true,
      refunded_amount: refundedAmount,
    })
  }

  return NextResponse.json({
    success: true,
    action: 'unknown_status',
    message: `Provider returned unexpected status: ${newStatus}`,
    status: newStatus,
  })
}

// ============================================================================
// SETTLEMENT SOURCE DETECTION (back-compat for clients not sending the source)
// ============================================================================

async function detectSettlementSource(
  supabase: ReturnType<typeof createClient>,
  txId: string
): Promise<'shadval' | 'payout' | 'settlements' | null> {
  const [{ data: sv }, { data: po }, { data: st }] = await Promise.all([
    supabase.from('shadval_settlement').select('id').eq('id', txId).maybeSingle(),
    supabase.from('payout_transactions').select('id').eq('id', txId).maybeSingle(),
    supabase.from('settlements').select('id').eq('id', txId).maybeSingle(),
  ])
  if (sv) return 'shadval'
  if (po) return 'payout'
  if (st) return 'settlements'
  return null
}

// ============================================================================
// SETTLEMENTS TABLE VERIFICATION (wallet→bank instant / T+1)
// Released by admin via SparkUp/ExpressPay payout; polls by payout_reference_id.
// ============================================================================

async function verifySettlements(
  supabase: ReturnType<typeof createClient>,
  user: any,
  isAdmin: boolean,
  txId: string,
  request: NextRequest
) {
  let query = supabase
    .from('settlements')
    .select('id, user_id, user_role, status, amount, charge, net_amount, ledger_entry_id, payout_reference_id, settlement_mode')
    .eq('id', txId)

  if (!isAdmin) {
    query = query.eq('user_id', user.partner_id)
  }

  const { data: tx, error: txErr } = await query.maybeSingle()

  if (txErr || !tx) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  }

  if (!['pending', 'processing'].includes(tx.status)) {
    return NextResponse.json({
      success: true,
      action: 'no_change',
      message: `Transaction is already ${tx.status}. No verification needed.`,
      status: tx.status,
    })
  }

  // No payout reference yet → the admin hasn't released this to the bank.
  if (!tx.payout_reference_id) {
    return NextResponse.json({
      success: true,
      action: 'no_change',
      message: 'Settlement is awaiting admin approval/release. Nothing to verify with the provider yet.',
      status: tx.status,
    })
  }

  // Poll payout provider
  const statusResult = await getTransferStatus({ transactionId: String(tx.payout_reference_id) })

  if (!statusResult.success || !statusResult.status) {
    return NextResponse.json({
      success: true,
      action: 'provider_error',
      message: 'Could not reach provider. Please try again later.',
      status: tx.status,
    })
  }

  const newStatus = statusResult.status

  if (['pending', 'processing'].includes(newStatus)) {
    return NextResponse.json({
      success: true,
      action: 'still_pending',
      message: 'Transaction is still pending at provider.',
      status: newStatus,
    })
  }

  // SUCCESS
  if (newStatus === 'success') {
    await supabase
      .from('settlements')
      .update({
        status: 'success',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', tx.id)
      .in('status', ['pending', 'processing'])

    if (tx.ledger_entry_id) {
      await supabase.from('wallet_ledger').update({ status: 'completed' }).eq('id', tx.ledger_entry_id)
    }

    // Collect the settlement fee to the platform wallet (idempotent by settlement id)
    const charge = parseFloat(String(tx.charge ?? 0))
    if (charge > 0) {
      const rev = await creditSettlementFeeToPlatformWallet(supabase, {
        settlementId: tx.id,
        charge,
        settlerUserId: tx.user_id,
        settlerUserRole: tx.user_role,
      })
      if (!rev.ok) console.error('[Verify Settlements] Platform settlement-fee credit failed:', rev.error)
    }

    await logVerifyActivity(request, user, 'settlement_verify_success', tx.id, { previous_status: tx.status, new_status: 'success' })

    return NextResponse.json({
      success: true,
      action: 'marked_success',
      message: 'Transaction confirmed successful by provider.',
      status: 'success',
      refunded: false,
    })
  }

  // FAILED — atomic claim + refund (same reference as admin-release refund → dedup)
  if (newStatus === 'failed') {
    const { data: claimed } = await supabase
      .from('settlements')
      .update({
        status: 'failed',
        failure_reason: statusResult.status_message || 'Transaction failed (verified)',
        updated_at: new Date().toISOString(),
      })
      .eq('id', tx.id)
      .in('status', ['pending', 'processing'])
      .select('id')

    if (!claimed || claimed.length === 0) {
      return NextResponse.json({
        success: true,
        action: 'already_processed',
        message: 'Transaction was already processed by another request.',
        status: 'failed',
        refunded: false,
      })
    }

    const refundAmount = parseFloat(String(tx.amount))
    let refundedAmount = 0
    let refundCritical = false

    const { error: refundErr } = await supabase.rpc('add_ledger_entry', {
      p_user_id: tx.user_id,
      p_user_role: tx.user_role,
      p_wallet_type: 'primary',
      p_fund_category: 'settlement',
      p_service_type: 'settlement',
      p_tx_type: 'REFUND',
      p_credit: refundAmount,
      p_debit: 0,
      // Same reference as /api/admin/settlement/release failure path → DB unique
      // index is the hard backstop against a double refund.
      p_reference_id: `PAYOUT_FAILED_REFUND_${tx.id}`,
      p_transaction_id: tx.id,
      p_status: 'completed',
      p_remarks: `Settlement payout failed - Refund via verification: ${statusResult.status_message || 'Provider confirmed failed'}`,
    })

    if (refundErr) {
      if (isDuplicateLedgerError(refundErr)) {
        refundedAmount = refundAmount
        await supabase
          .from('settlements')
          .update({ failure_reason: `${statusResult.status_message || 'Transaction failed'} [Wallet refunded]` })
          .eq('id', tx.id)
      } else {
        refundCritical = true
        await supabase
          .from('settlements')
          .update({
            failure_reason: `${statusResult.status_message || 'Transaction failed'} [CRITICAL: REFUND_FAILED - Manual review required] (${refundErr.message})`,
            updated_at: new Date().toISOString(),
          })
          .eq('id', tx.id)
        console.error(`[Verify Settlements] 🚨 CRITICAL: ${tx.id} marked failed but wallet refund FAILED:`, refundErr.message)
      }
    } else {
      refundedAmount = refundAmount
      await supabase
        .from('settlements')
        .update({ failure_reason: `${statusResult.status_message || 'Transaction failed'} [Wallet refunded]` })
        .eq('id', tx.id)
    }

    if (refundCritical) {
      await logVerifyActivity(request, user, 'settlement_verify_refund_FAILED_CRITICAL', tx.id, {
        previous_status: tx.status,
        new_status: 'failed',
        refund_failed: true,
      })
      return NextResponse.json({
        success: false,
        action: 'refund_failed_critical',
        critical: true,
        message: `⚠️ CRITICAL: Transaction marked failed but wallet refund did NOT complete. Manual review required for txn ${tx.id}.`,
        status: 'failed',
        refunded: false,
      }, { status: 500 })
    }

    await logVerifyActivity(request, user, 'settlement_verify_failed_refunded', tx.id, {
      previous_status: tx.status,
      new_status: 'failed',
      refunded_amount: refundedAmount,
    })

    return NextResponse.json({
      success: true,
      action: 'failed_and_refunded',
      message: `Transaction failed. ₹${refundedAmount.toFixed(2)} refunded to wallet.`,
      status: 'failed',
      refunded: true,
      refunded_amount: refundedAmount,
    })
  }

  return NextResponse.json({
    success: true,
    action: 'unknown_status',
    message: `Provider returned unexpected status: ${newStatus}`,
    status: newStatus,
  })
}

// ============================================================================
// SHADVAL (SETTLEMENT-2) VERIFICATION
// Mirrors /api/settlement-2/status but keyed by row id and admin-capable.
// ============================================================================

async function verifyShadval(
  supabase: ReturnType<typeof createClient>,
  user: any,
  isAdmin: boolean,
  txId: string,
  request: NextRequest
) {
  let query = supabase
    .from('shadval_settlement')
    .select('id, retailer_id, status, status_message, amount, charges, total_debit, actual_wallet_debit, reference_id, distributor_commission, md_commission, company_earning')
    .eq('id', txId)

  if (!isAdmin) {
    query = query.eq('retailer_id', user.partner_id)
  }

  const { data: tx, error: txErr } = await query.maybeSingle()

  if (txErr || !tx) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  }

  // RECOVERY: the row is already FAILED but an earlier refund may never have
  // completed (e.g. it hit the wallets_user_role_check constraint because a
  // partner was refunded down the retailer path, leaving a CRITICAL marker and
  // the money stuck). Re-attempt the refund idempotently so the "Check" button
  // can always make the settler whole — a second click is a safe no-op.
  if (tx.status === 'FAILED') {
    const refund = await refundShadvalSettlement(supabase, tx, { note: 'verification recovery' })

    if (refund.critical) {
      await supabase
        .from('shadval_settlement')
        .update({
          status_message: `${stripRefundMarkers(tx.status_message)} [CRITICAL: REFUND_FAILED - Manual review required] (${refund.error})`,
        })
        .eq('id', tx.id)
      await logVerifyActivity(request, user, 'shadval_verify_refund_FAILED_CRITICAL', tx.id, { refund_failed: true, recovery: true })
      return NextResponse.json({
        success: false,
        action: 'refund_failed_critical',
        critical: true,
        message: `⚠️ CRITICAL: Refund still could not complete for txn ${tx.id}. ${refund.error}`,
        status: 'FAILED',
        refunded: false,
      }, { status: 500 })
    }

    if (refund.alreadyRefunded) {
      return NextResponse.json({
        success: true,
        action: 'no_change',
        message: `Transaction already FAILED and the wallet was already refunded (₹${refund.refunded.toFixed(2)}). No action needed.`,
        status: 'FAILED',
      })
    }

    if (refund.refunded > 0) {
      await supabase
        .from('shadval_settlement')
        .update({
          status_message: `${stripRefundMarkers(tx.status_message)} [Wallet refunded ₹${refund.refunded.toFixed(2)} via verification recovery]`,
        })
        .eq('id', tx.id)
      await reverseShadvalCommissions(supabase, tx)
      await logVerifyActivity(request, user, 'shadval_verify_recovery_refunded', tx.id, { refunded_amount: refund.refunded })
      return NextResponse.json({
        success: true,
        action: 'failed_and_refunded',
        message: `Recovered failed settlement. ₹${refund.refunded.toFixed(2)} refunded to wallet.`,
        status: 'FAILED',
        refunded: true,
        refunded_amount: refund.refunded,
      })
    }

    return NextResponse.json({
      success: true,
      action: 'no_change',
      message: 'Transaction is already FAILED and no wallet debit was found to refund.',
      status: 'FAILED',
    })
  }

  if (tx.status !== 'PENDING') {
    return NextResponse.json({
      success: true,
      action: 'no_change',
      message: `Transaction is already ${tx.status}. No verification needed.`,
      status: tx.status,
    })
  }

  if (!tx.reference_id) {
    return NextResponse.json({
      success: true,
      action: 'no_change',
      message: 'Transaction has no provider reference. Cannot verify.',
      status: tx.status,
    })
  }

  // Poll provider
  let apiResult: any
  try {
    apiResult = await shadvalCheckStatus({ reference_id: tx.reference_id })
  } catch (err: any) {
    console.error('[Verify Shadval] Provider check failed:', err?.message)
    return NextResponse.json({
      success: true,
      action: 'provider_error',
      message: 'Could not reach provider. Please try again later.',
      status: tx.status,
    })
  }

  if (apiResult?.status !== 'SUCCESS' || !apiResult?.data) {
    return NextResponse.json({
      success: true,
      action: 'provider_error',
      message: apiResult?.message || 'Provider did not return a conclusive status.',
      status: tx.status,
    })
  }

  const txnStatusLower = apiResult.data.txn_status?.toLowerCase() || ''
  const newStatus = (txnStatusLower.includes('success') && !txnStatusLower.includes('refund'))
    ? 'SUCCESS'
    : (txnStatusLower.includes('fail') || txnStatusLower.includes('refund'))
    ? 'FAILED'
    : 'PENDING'

  // Still pending at provider
  if (newStatus === 'PENDING') {
    return NextResponse.json({
      success: true,
      action: 'still_pending',
      message: 'Transaction is still pending at provider.',
      status: 'PENDING',
    })
  }

  // SUCCESS
  if (newStatus === 'SUCCESS') {
    await supabase
      .from('shadval_settlement')
      .update({
        status: 'SUCCESS',
        utr: apiResult.data.utr || undefined,
        order_id: apiResult.data.order_id || undefined,
        status_message: apiResult.data.status_message || apiResult.data.txn_status,
        provider_timestamp: apiResult.data.timestamp,
      })
      .eq('id', tx.id)
      .eq('status', 'PENDING')

    await logVerifyActivity(request, user, 'shadval_verify_success', tx.id, { previous_status: 'PENDING', new_status: 'SUCCESS' })

    return NextResponse.json({
      success: true,
      action: 'marked_success',
      message: 'Transaction confirmed successful by provider.',
      status: 'SUCCESS',
      refunded: false,
    })
  }

  // FAILED — atomically claim PENDING→FAILED to prevent double-refund
  const { data: claimed } = await supabase
    .from('shadval_settlement')
    .update({
      status: 'FAILED',
      utr: apiResult.data.utr || undefined,
      order_id: apiResult.data.order_id || undefined,
      status_message: `${apiResult.data.status_message || apiResult.data.txn_status} [Wallet refunded]`,
      provider_timestamp: apiResult.data.timestamp,
    })
    .eq('id', tx.id)
    .eq('status', 'PENDING')
    .select('id')

  if (!claimed || claimed.length === 0) {
    return NextResponse.json({
      success: true,
      action: 'already_processed',
      message: 'Transaction was already processed by another request.',
      status: 'FAILED',
      refunded: false,
    })
  }

  // Refund exactly what was debited, routed to the correct wallet backend
  // (partner_wallets for partners, wallets for retailers). Idempotent via the
  // deterministic REFUND_<reference_id>, shared with the settlement-2 status poll.
  const refund = await refundShadvalSettlement(supabase, tx, { note: 'verification' })
  const refundedAmount = refund.refunded
  const refundCritical = refund.critical

  if (refundCritical) {
    await supabase
      .from('shadval_settlement')
      .update({
        status_message: `${apiResult.data.status_message || 'FAILED'} [CRITICAL: REFUND_FAILED - Manual review required] (${refund.error})`,
      })
      .eq('id', tx.id)
    console.error(`[Verify Shadval] 🚨 CRITICAL: ${tx.id} marked FAILED but wallet refund FAILED:`, refund.error)
  }

  if (refundCritical) {
    await logVerifyActivity(request, user, 'shadval_verify_refund_FAILED_CRITICAL', tx.id, {
      previous_status: 'PENDING',
      new_status: 'FAILED',
      refund_failed: true,
    })
    return NextResponse.json({
      success: false,
      action: 'refund_failed_critical',
      critical: true,
      message: `⚠️ CRITICAL: Transaction marked failed but wallet refund did NOT complete. Manual review required for txn ${tx.id}.`,
      status: 'FAILED',
      refunded: false,
    }, { status: 500 })
  }

  // Reverse commission/revenue (skip if refund itself failed above)
  await reverseShadvalCommissions(supabase, tx)

  await logVerifyActivity(request, user, 'shadval_verify_failed_refunded', tx.id, {
    previous_status: 'PENDING',
    new_status: 'FAILED',
    refunded_amount: refundedAmount,
  })

  return NextResponse.json({
    success: true,
    action: 'failed_and_refunded',
    message: `Transaction failed. ₹${refundedAmount.toFixed(2)} refunded to wallet. Commissions reversed.`,
    status: 'FAILED',
    refunded: true,
    refunded_amount: refundedAmount,
  })
}

/** Drop stale refund status markers so a recovery refund doesn't stack them. */
function stripRefundMarkers(msg: string | null | undefined): string {
  return String(msg || '')
    .replace(/\s*\[CRITICAL: REFUND_FAILED[^\]]*\]\s*\([^)]*\)/gi, '')
    .replace(/\s*\[Wallet refunded[^\]]*\]/gi, '')
    .trim()
}

async function reverseShadvalCommissions(supabase: ReturnType<typeof createClient>, tx: any) {
  const chargesNum = parseFloat(String(tx.charges || 0))
  if (chargesNum <= 0) return
  // Reverses DT commission + company revenue (no MD) using the shared helper's
  // deterministic references.
  await reverseServiceCommission({
    supabase,
    service: 'shadval_settlement',
    refPrefix: 'SHADVAL',
    refKey: tx.reference_id,
    transactionUuid: tx.id,
  })
}

// ============================================================================
// BBPS VERIFICATION
// ============================================================================

async function verifyBBPS(
  supabase: ReturnType<typeof createClient>,
  user: any,
  isAdmin: boolean,
  txId: string,
  request: NextRequest
) {
  // Fetch transaction
  let query = supabase
    .from('bbps_transactions')
    .select('id, retailer_id, agent_transaction_id, transaction_id, status, bill_amount, retailer_charge, wallet_debited, wallet_debit_id, scheme_id, created_at')
    .eq('id', txId)

  if (!isAdmin) {
    query = query.eq('retailer_id', user.partner_id)
  }

  const { data: tx, error: txErr } = await query.maybeSingle()

  if (txErr || !tx) {
    return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  }

  if (!['pending', 'processing', 'initiated'].includes(tx.status)) {
    return NextResponse.json({
      success: true,
      action: 'no_change',
      message: `Transaction is already ${tx.status}. No verification needed.`,
      status: tx.status,
    })
  }

  // Check with BBPS provider
  const providerTxnId = tx.transaction_id || tx.agent_transaction_id
  if (!providerTxnId) {
    return NextResponse.json({
      success: true,
      action: 'no_change',
      message: 'No transaction reference available. Cannot verify with provider.',
      status: tx.status,
    })
  }

  let providerStatus: string | null = null
  try {
    const result = await transactionStatus({
      transactionId: providerTxnId,
      trackType: tx.transaction_id ? 'TRANS_REF_ID' : 'AGENT_TXN_ID',
    })
    providerStatus = result.status?.toLowerCase() || result.payment_status?.toLowerCase() || null
  } catch (err: any) {
    console.error('[Verify BBPS] Provider check failed:', err.message)
    return NextResponse.json({
      success: true,
      action: 'provider_error',
      message: 'Could not reach BBPS provider. Please try again later.',
      status: tx.status,
    })
  }

  if (!providerStatus || providerStatus === 'not_available') {
    return NextResponse.json({
      success: true,
      action: 'provider_error',
      message: 'BBPS provider did not return a conclusive status.',
      status: tx.status,
    })
  }

  // Normalize provider status
  const isSuccess = ['success', 'successful', 'completed', 'captured'].includes(providerStatus)
  const isFailed = ['failed', 'failure', 'rejected', 'reversed', 'reversal', 'refund'].includes(providerStatus)

  // Still pending at provider
  if (!isSuccess && !isFailed) {
    return NextResponse.json({
      success: true,
      action: 'still_pending',
      message: `Transaction still ${providerStatus} at BBPS provider.`,
      status: tx.status,
    })
  }

  // SUCCESS
  if (isSuccess) {
    await supabase
      .from('bbps_transactions')
      .update({
        status: 'success',
        completed_at: new Date().toISOString(),
      })
      .eq('id', tx.id)
      .in('status', ['pending', 'processing', 'initiated'])

    await logVerifyActivity(request, user, 'bbps_verify_success', tx.id, { previous_status: tx.status, new_status: 'success' })

    return NextResponse.json({
      success: true,
      action: 'marked_success',
      message: 'BBPS transaction confirmed successful by provider.',
      status: 'success',
      refunded: false,
    })
  }

  // FAILED — atomic claim + refund + commission reversal
  const { data: claimed } = await supabase
    .from('bbps_transactions')
    .update({
      status: 'failed',
      error_message: `Failed (verified): ${providerStatus}`,
      completed_at: new Date().toISOString(),
    })
    .eq('id', tx.id)
    .in('status', ['pending', 'processing', 'initiated'])
    .select('id')

  if (!claimed || claimed.length === 0) {
    return NextResponse.json({
      success: true,
      action: 'already_processed',
      message: 'Transaction was already processed by another request.',
      status: 'failed',
      refunded: false,
    })
  }

  let refundedAmount = 0
  let refundCritical = false

  // Refund wallet (bill_amount + retailer_charge)
  if (tx.wallet_debited) {
    const totalAmount = parseFloat(String(tx.bill_amount || 0)) + parseFloat(String(tx.retailer_charge || 0))

    const { error: refundErr } = await supabase.rpc('add_ledger_entry', {
      p_user_id: tx.retailer_id,
      p_user_role: resolveRole(tx.retailer_id),
      p_wallet_type: 'primary',
      p_fund_category: 'bbps',
      p_service_type: 'bbps',
      p_tx_type: 'REFUND',
      p_credit: totalAmount,
      p_debit: 0,
      // Same reference_id as bbps/bill/pay refund → DB unique index is the hard backstop.
      p_reference_id: `REFUND_${tx.agent_transaction_id || tx.id}`,
      p_transaction_id: tx.id,
      p_status: 'completed',
      p_remarks: `BBPS failed - Refund via verification: Provider status=${providerStatus}`,
    })

    if (refundErr) {
      if (isDuplicateLedgerError(refundErr)) {
        // Already refunded by another path — benign.
        refundedAmount = totalAmount
        await supabase.from('bbps_transactions').update({ wallet_debited: false }).eq('id', tx.id)
      } else {
        refundCritical = true
        await supabase
          .from('bbps_transactions')
          .update({
            error_message: `Failed (verified): ${providerStatus} [CRITICAL: REFUND_FAILED - Manual review required] (${refundErr.message})`,
          })
          .eq('id', tx.id)
        console.error(`[Verify] 🚨 CRITICAL: BBPS ${tx.id} marked failed but wallet refund FAILED:`, refundErr.message)
      }
    } else {
      refundedAmount = totalAmount
      // Mark wallet as not debited (refunded)
      await supabase
        .from('bbps_transactions')
        .update({ wallet_debited: false })
        .eq('id', tx.id)
    }
  }

  if (refundCritical) {
    await logVerifyActivity(request, user, 'bbps_verify_refund_FAILED_CRITICAL', tx.id, {
      previous_status: tx.status,
      new_status: 'failed',
      refund_failed: true,
      provider_status: providerStatus,
    })
    return NextResponse.json({
      success: false,
      action: 'refund_failed_critical',
      critical: true,
      message: `⚠️ CRITICAL: BBPS transaction marked failed but wallet refund did NOT complete. Manual review required for txn ${tx.id}.`,
      status: 'failed',
      refunded: false,
    }, { status: 500 })
  }

  // Reverse commissions for BBPS
  await reverseBBPSCommissions(supabase, tx)

  await logVerifyActivity(request, user, 'bbps_verify_failed_refunded', tx.id, {
    previous_status: tx.status,
    new_status: 'failed',
    refunded_amount: refundedAmount,
    provider_status: providerStatus,
  })

  return NextResponse.json({
    success: true,
    action: 'failed_and_refunded',
    message: `BBPS transaction failed. ₹${refundedAmount.toFixed(2)} refunded to wallet. Commissions reversed.`,
    status: 'failed',
    refunded: true,
    refunded_amount: refundedAmount,
  })
}

// ============================================================================
// HELPERS
// ============================================================================

function resolveRole(retailerId: string): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return uuidRegex.test(retailerId) ? 'partner' : 'retailer'
}

// A duplicate ledger error means the refund was already posted (by cron/status or a race).
// This is benign — money was returned exactly once. Anything else is a genuine failure.
function isDuplicateLedgerError(err: any): boolean {
  const msg = (err?.message || '').toLowerCase()
  return msg.includes('duplicate') || err?.code === '23505'
}

async function reversePayoutCommissions(supabase: ReturnType<typeof createClient>, tx: any) {
  try {
    const refId = `PAYOUT_COMM_${tx.client_ref_id}`
    // Find all commission credits for this transaction
    const { data: entries } = await supabase
      .from('wallet_ledger')
      .select('id, user_id, user_role, credit, fund_category, service_type, tx_type')
      .eq('transaction_id', tx.id)
      .eq('tx_type', 'COMMISSION_CREDIT')
      .eq('service_type', 'payout')

    if (!entries || entries.length === 0) return

    for (const entry of entries) {
      if (entry.credit <= 0) continue
      await supabase.rpc('add_ledger_entry', {
        p_user_id: entry.user_id,
        p_user_role: entry.user_role,
        p_wallet_type: 'primary',
        p_fund_category: 'commission',
        p_service_type: 'payout',
        p_tx_type: 'COMMISSION_REVERSAL',
        p_credit: 0,
        p_debit: entry.credit,
        p_reference_id: `REV_${refId}_${entry.id}`,
        p_transaction_id: tx.id,
        p_status: 'completed',
        p_remarks: `Commission reversal - Payout verification failed (txn ${tx.id})`,
      })
    }

    // Also reverse company revenue
    const { data: revEntries } = await supabase
      .from('wallet_ledger')
      .select('id, user_id, user_role, credit')
      .eq('transaction_id', tx.id)
      .eq('tx_type', 'COMPANY_REVENUE')
      .eq('service_type', 'payout')

    if (revEntries) {
      for (const entry of revEntries) {
        if (entry.credit <= 0) continue
        await supabase.rpc('add_ledger_entry', {
          p_user_id: entry.user_id,
          p_user_role: entry.user_role,
          p_wallet_type: 'primary',
          p_fund_category: 'revenue',
          p_service_type: 'payout',
          p_tx_type: 'COMMISSION_REVERSAL',
          p_credit: 0,
          p_debit: entry.credit,
          p_reference_id: `REV_REVENUE_${tx.client_ref_id}_${entry.id}`,
          p_transaction_id: tx.id,
          p_status: 'completed',
          p_remarks: `Revenue reversal - Payout verification failed (txn ${tx.id})`,
        })
      }
    }
  } catch (err: any) {
    console.error('[Verify] Payout commission reversal error (non-fatal):', err.message)
  }
}

async function reverseBBPSCommissions(supabase: ReturnType<typeof createClient>, tx: any) {
  try {
    // Find all commission credits for this BBPS transaction
    const { data: entries } = await supabase
      .from('wallet_ledger')
      .select('id, user_id, user_role, credit, fund_category, service_type, tx_type')
      .eq('transaction_id', tx.id)
      .eq('tx_type', 'COMMISSION_CREDIT')
      .eq('service_type', 'bbps')

    if (!entries || entries.length === 0) return

    for (const entry of entries) {
      if (entry.credit <= 0) continue
      await supabase.rpc('add_ledger_entry', {
        p_user_id: entry.user_id,
        p_user_role: entry.user_role,
        p_wallet_type: 'primary',
        p_fund_category: 'commission',
        p_service_type: 'bbps',
        p_tx_type: 'COMMISSION_REVERSAL',
        p_credit: 0,
        p_debit: entry.credit,
        p_reference_id: `REV_BBPS_COMM_${tx.agent_transaction_id || tx.id}_${entry.id}`,
        p_transaction_id: tx.id,
        p_status: 'completed',
        p_remarks: `Commission reversal - BBPS verification failed (txn ${tx.id})`,
      })
    }

    // Also reverse company revenue
    const { data: revEntries } = await supabase
      .from('wallet_ledger')
      .select('id, user_id, user_role, credit')
      .eq('transaction_id', tx.id)
      .eq('tx_type', 'COMPANY_REVENUE')
      .eq('service_type', 'bbps')

    if (revEntries) {
      for (const entry of revEntries) {
        if (entry.credit <= 0) continue
        await supabase.rpc('add_ledger_entry', {
          p_user_id: entry.user_id,
          p_user_role: entry.user_role,
          p_wallet_type: 'primary',
          p_fund_category: 'revenue',
          p_service_type: 'bbps',
          p_tx_type: 'COMMISSION_REVERSAL',
          p_credit: 0,
          p_debit: entry.credit,
          p_reference_id: `REV_BBPS_REVENUE_${tx.agent_transaction_id || tx.id}_${entry.id}`,
          p_transaction_id: tx.id,
          p_status: 'completed',
          p_remarks: `Revenue reversal - BBPS verification failed (txn ${tx.id})`,
        })
      }
    }
  } catch (err: any) {
    console.error('[Verify] BBPS commission reversal error (non-fatal):', err.message)
  }
}

async function logVerifyActivity(
  request: NextRequest,
  user: any,
  activityType: string,
  transactionId: string,
  metadata: Record<string, any>
) {
  try {
    const ctx = getRequestContext(request)
    await logActivityFromContext(ctx, user, {
      activity_type: activityType,
      activity_category: 'transaction',
      activity_description: `Transaction verification: ${activityType}`,
      reference_id: transactionId,
      reference_table: 'transactions',
      metadata,
    })
  } catch (err) {
    console.error('[Verify] Activity log error (non-fatal):', err)
  }
}
