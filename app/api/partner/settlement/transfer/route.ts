import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { initiateBankTransfer } from '@/services/shadval-pay'
import type { ShadvalTransferRequest } from '@/services/shadval-pay'
import { sendSettlementCallback } from '@/lib/settlement-callback'
import { resolveShadvalCharge, getShadvalSlabLimits } from '@/lib/shadval-charge'
import {
  reserveIdempotencyKey,
  finalizeIdempotencyKey,
  getIdempotencyKeyFromHeaders,
} from '@/lib/security/idempotency'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const GST_PERCENT = 18

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

/**
 * POST /api/partner/settlement/transfer
 * Initiate settlement transfer to a verified account
 */
export async function POST(request: NextRequest) {
  try {
    let authResult
    try {
      authResult = await authenticatePartner(request)
    } catch (error) {
      const e = error as PartnerAuthError
      return NextResponse.json(
        { success: false, error: { code: e.code, message: e.message } },
        { status: e.status }
      )
    }

    const { partner } = authResult
    const access = partnerCanUseApi(partner, 'settlement')
    if (!access.allowed) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: access.message } },
        { status: 403 }
      )
    }

    // Idempotency key support
    const idempotencyKey = getIdempotencyKeyFromHeaders(request.headers)
    const idempResult = await reserveIdempotencyKey({
      scope: `partner_settlement:${partner.id}`,
      key: idempotencyKey,
      userId: partner.id,
    })
    if (!idempResult.fresh) {
      if (idempResult.cachedResponse) {
        return NextResponse.json(idempResult.cachedResponse, { status: idempResult.cachedResponse?.status_code || 200 })
      }
      return NextResponse.json(
        { success: false, error: { code: 'DUPLICATE', message: 'Request with this idempotency key is already being processed.' } },
        { status: 409 }
      )
    }

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
        { status: 400 }
      )
    }

    const { account_id, amount, mode = 'IMPS', narration } = body

    if (!account_id || !amount) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'account_id and amount are required' } },
        { status: 400 }
      )
    }

    const amountNum = parseFloat(amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid amount' } },
        { status: 400 }
      )
    }

    const validModes = ['IMPS', 'NEFT', 'RTGS']
    if (!validModes.includes(mode)) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid mode. Must be IMPS, NEFT, or RTGS' } },
        { status: 400 }
      )
    }

    const supabase = getSupabase()

    // Fetch account (verified or unverified — risk is on the user)
    const { data: account, error: acctError } = await supabase
      .from('shadval_settlement_accounts')
      .select('*')
      .eq('id', account_id)
      .eq('retailer_id', partner.id)
      .eq('is_active', true)
      .maybeSingle()

    if (acctError || !account) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Account not found or inactive' } },
        { status: 404 }
      )
    }

    // Check partner wallet balance
    const { data: walletBalance, error: balErr } = await supabase.rpc('get_partner_wallet_balance', {
      p_partner_id: partner.id
    })

    if (balErr || walletBalance === null) {
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to check wallet balance' } },
        { status: 500 }
      )
    }

    // Check if wallet is frozen
    const { data: walletInfo } = await supabase
      .from('partner_wallets')
      .select('is_frozen, freeze_reason')
      .eq('partner_id', partner.id)
      .maybeSingle()

    if (walletInfo?.is_frozen) {
      return NextResponse.json(
        { success: false, error: { code: 'WALLET_FROZEN', message: `Wallet is frozen: ${walletInfo.freeze_reason || 'Contact admin'}` } },
        { status: 403 }
      )
    }

    // Resolve the partner's Settlement-2 (Shadval) scheme charge for this amount + mode.
    // Charge = base retailer_charge + 18% GST, debited from the partner wallet on top
    // of the transfer amount. Scoped to schemes the partner is actually mapped to.
    const { baseCharge } = await resolveShadvalCharge(supabase, partner.id, amountNum, mode)

    // Enforce slab limits: if charge slabs are configured for this mode across the
    // partner's mapped schemes, the amount must fall within one of them. Otherwise the
    // charge silently resolves to 0 and a transfer could go through outside the limit.
    const slabLimits = await getShadvalSlabLimits(supabase, partner.id, mode)
    if (slabLimits) {
      const inSlab = slabLimits.rows.some((s: any) =>
        amountNum >= parseFloat(String(s.min_amount)) && amountNum <= parseFloat(String(s.max_amount))
      )
      if (!inSlab) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'AMOUNT_NOT_ALLOWED',
              message: `Amount not allowed for ${mode}. Allowed range: ₹${slabLimits.min.toLocaleString('en-IN')} – ₹${slabLimits.max.toLocaleString('en-IN')}.`,
            },
            min_allowed: slabLimits.min,
            max_allowed: slabLimits.max,
          },
          { status: 400 }
        )
      }
    }

    const gstAmount = Math.round((baseCharge * GST_PERCENT) / 100 * 100) / 100
    const charges = Math.round((baseCharge + gstAmount) * 100) / 100
    const totalRequired = Math.round((amountNum + charges) * 100) / 100

    if (walletBalance < totalRequired) {
      return NextResponse.json(
        {
          success: false,
          error: { code: 'INSUFFICIENT_BALANCE', message: `Insufficient balance. Required: ₹${totalRequired}. Available: ₹${walletBalance}` },
          wallet_balance: walletBalance,
          amount: amountNum,
          charges,
          total_required: totalRequired,
        },
        { status: 400 }
      )
    }

    // Duplicate prevention — same account + same amount within 1 min
    // SUCCESS txns: block for full 60s (prevents double credit/debit)
    // PENDING txns: block only for 15s (allows retry after stale timeouts)
    const oneMinAgo = new Date(Date.now() - 60 * 1000).toISOString()
    const fifteenSecAgo = new Date(Date.now() - 15 * 1000).toISOString()

    const { data: recentSuccessTx } = await supabase
      .from('shadval_settlement')
      .select('id, status, created_at')
      .eq('retailer_id', partner.id)
      .eq('account_number', account.account_number)
      .eq('amount', amountNum)
      .gte('created_at', oneMinAgo)
      .eq('status', 'SUCCESS')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { data: recentPendingTx } = await supabase
      .from('shadval_settlement')
      .select('id, status, created_at')
      .eq('retailer_id', partner.id)
      .eq('account_number', account.account_number)
      .eq('amount', amountNum)
      .gte('created_at', fifteenSecAgo)
      .eq('status', 'PENDING')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const recentTx = recentSuccessTx || recentPendingTx
    if (recentTx) {
      const secAgo = Math.round((Date.now() - new Date(recentTx.created_at).getTime()) / 1000)
      const waitSec = recentTx.status === 'SUCCESS' ? 60 - secAgo : 15 - secAgo
      return NextResponse.json(
        { success: false, error: { code: 'DUPLICATE', message: `Identical transaction (same account + amount) initiated ${secAgo}s ago. Wait ${Math.max(waitSec, 1)}s.` }, wait_seconds: Math.max(waitSec, 1) },
        { status: 429 }
      )
    }

    const refId = `PSV2_${partner.id}_${Date.now()}`

    // Create transaction record
    const { data: txRecord, error: txErr } = await supabase
      .from('shadval_settlement')
      .insert({
        retailer_id: partner.id,
        account_number: account.account_number,
        ifsc_code: account.ifsc_code,
        account_holder_name: account.verified_name || account.account_holder_name,
        amount: amountNum,
        charges,
        total_debit: amountNum + charges,
        mode,
        reference_id: refId,
        status: 'PENDING',
        contact_name: account.contact_name || partner.name,
        contact_email: account.contact_email || '',
        contact_mobile: account.contact_mobile || '',
        narration: narration || 'Partner Settlement Transfer',
      })
      .select()
      .single()

    if (txErr || !txRecord) {
      console.error('[Partner Settlement Transfer] Insert error:', txErr)
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create transaction record' } },
        { status: 500 }
      )
    }

    // Debit partner wallet
    const { error: debitErr } = await supabase.rpc('debit_partner_wallet', {
      p_partner_id: partner.id,
      p_amount: totalRequired,
      p_payout_transaction_id: txRecord.id,
      p_description: charges > 0
        ? `Settlement transfer ₹${amountNum} + charge ₹${baseCharge} + GST ₹${gstAmount} = ₹${totalRequired} to ${account.account_number} (${account.account_holder_name})`
        : `Settlement transfer ₹${amountNum} to ${account.account_number} (${account.account_holder_name})`,
      p_reference_id: refId,
    })

    if (debitErr) {
      console.error('[Partner Settlement Transfer] Wallet debit error:', debitErr)
      await supabase.from('shadval_settlement').update({ status: 'FAILED', status_message: 'Wallet debit failed' }).eq('id', txRecord.id)
      return NextResponse.json(
        { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to debit wallet' } },
        { status: 500 }
      )
    }

    // Initiate bank transfer via Shadval Pay
    const transferRequest: ShadvalTransferRequest = {
      amount: amountNum,
      mode: mode as 'IMPS' | 'NEFT' | 'RTGS',
      fund_account: {
        name: account.account_holder_name,
        ifsc: account.ifsc_code,
        account_number: account.account_number,
      },
      contact_details: {
        name: account.contact_name || partner.name || account.account_holder_name,
        email: account.contact_email || '',
        mobile: account.contact_mobile || '',
      },
      reference_id: refId,
      latitude: '28.6139',
      longitude: '77.2090',
      narration: narration || 'Partner Settlement Transfer',
    }

    const apiResult = await initiateBankTransfer(transferRequest)
    const isSuccess = apiResult.status === 'SUCCESS'
    const isFailed = apiResult.status === 'FAILED'
    const finalStatus = isSuccess ? 'SUCCESS' : isFailed ? 'FAILED' : 'PENDING'

    // Update transaction with API result
    await supabase
      .from('shadval_settlement')
      .update({
        status: finalStatus,
        order_id: apiResult.data?.order_id || null,
        internal_ref_id: apiResult.data?.internal_ref_id || null,
        utr: apiResult.data?.utr || null,
        status_message: apiResult.message,
        provider_timestamp: apiResult.data?.timestamp || null,
      })
      .eq('id', txRecord.id)

    // Refund on failure
    if (isFailed) {
      try {
        await supabase.rpc('refund_partner_wallet', {
          p_partner_id: partner.id,
          p_amount: totalRequired,
          p_payout_transaction_id: txRecord.id,
          p_description: `Settlement failed - Refund: ${apiResult.message}`,
          p_reference_id: `REFUND_${refId}`,
        })
      } catch {}
    }

    // Fire settlement callback to partner webhook (non-blocking)
    if (finalStatus !== 'PENDING') {
      const updatedTx = {
        ...txRecord,
        status: finalStatus,
        order_id: apiResult.data?.order_id || null,
        utr: apiResult.data?.utr || null,
        status_message: apiResult.message,
        provider_timestamp: apiResult.data?.timestamp || null,
      }
      sendSettlementCallback(partner.id, updatedTx).catch(() => {})
    }

    const responseBody = {
      success: !isFailed,
      message: apiResult.message,
      transaction: {
        id: txRecord.id,
        reference_id: refId,
        order_id: apiResult.data?.order_id || null,
        utr: apiResult.data?.utr || null,
        amount: amountNum,
        charges,
        total_debited: totalRequired,
        mode,
        status: finalStatus,
        account_number: account.account_number,
        account_holder_name: account.verified_name || account.account_holder_name,
        ifsc_code: account.ifsc_code,
      },
      ...(isFailed ? { refunded: true } : {}),
    }

    // Finalize idempotency key with the response
    finalizeIdempotencyKey({
      scope: `partner_settlement:${partner.id}`,
      key: idempotencyKey || '',
      status: isFailed ? 'failed' : 'completed',
      response: responseBody,
    }).catch(() => {})

    return NextResponse.json(responseBody)
  } catch (error: any) {
    console.error('[Partner Settlement Transfer] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
