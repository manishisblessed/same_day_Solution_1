import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import * as crypto from 'crypto'
import { sendSignedCallback } from '@/lib/partner-webhook/deliver'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

function extractClientIp(request: NextRequest): string | null {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xreal = request.headers.get('x-real-ip')
  if (xreal) return xreal.trim()
  return null
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  try {
    return crypto.timingSafeEqual(ab, bb)
  } catch {
    return false
  }
}

/**
 * Authenticate the inbound RechargeKit callback. This endpoint finalizes
 * bbps_transactions and moves money (commission credits / refunds), so it must
 * not act on unauthenticated requests.
 *
 * Controls (both fail-closed only when configured, for safe rollout):
 *   - RECHARGEKIT_CALLBACK_SECRET : shared token via `x-callback-token` header
 *     or `?token=` query param (primary control).
 *   - RECHARGEKIT_CALLBACK_IPS    : optional comma-separated source-IP allowlist.
 *
 * To enforce: set RECHARGEKIT_CALLBACK_SECRET and register the callback URL with
 * RechargeKit as `.../api/rechargekit/callback?token=<secret>` (or the header).
 */
function verifyRechargekitCaller(request: NextRequest): NextResponse | null {
  const secret = process.env.RECHARGEKIT_CALLBACK_SECRET
  const ipAllowlist = (process.env.RECHARGEKIT_CALLBACK_IPS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (ipAllowlist.length > 0) {
    const clientIp = extractClientIp(request)
    if (!clientIp || !ipAllowlist.includes(clientIp)) {
      console.error(`[Rechargekit Callback] Rejected: source IP ${clientIp || 'unknown'} not in allowlist`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  if (secret) {
    const provided =
      request.headers.get('x-callback-token') ||
      request.nextUrl.searchParams.get('token') ||
      ''
    if (!provided || !timingSafeEqualStr(provided, secret)) {
      console.error('[Rechargekit Callback] Rejected: invalid or missing callback token')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else {
    console.warn('[Rechargekit Callback] RECHARGEKIT_CALLBACK_SECRET not configured — accepting unauthenticated callback. Set it and register the token with RechargeKit to enforce.')
  }

  return null
}

/**
 * Handle a callback for a PARTNER API transaction (lives in partner_wallet_ledger,
 * keyed by reference_id = RKCC...). Finalizes the ledger (idempotent refund on
 * failure) and forwards a signed webhook to the partner's webhook_url if set.
 *
 * Returns a NextResponse when the requestId belongs to a partner transaction,
 * or null when it does not (so the caller can fall through to a 404).
 */
async function handlePartnerRechargekitCallback(
  supabaseAdmin: SupabaseClient,
  requestId: string,
  providerStatus: number,
  orderId: string,
  operatorRef: string,
  providerMsg: string
): Promise<NextResponse | null> {
  const { data: entries, error } = await supabaseAdmin
    .from('partner_wallet_ledger')
    .select('id, partner_id, debit, description, status, reference_id, created_at')
    .eq('reference_id', requestId)
    .eq('transaction_type', 'DEBIT')
    .order('created_at', { ascending: false })
    .limit(1)

  const entry = entries?.[0]
  if (error || !entry) return null

  const partnerId = entry.partner_id

  // Amounts encoded in the debit description: "... ₹<bill> + ₹<charge> charge ..."
  const m = entry.description?.match(/₹([\d.]+)\s*\+\s*₹([\d.]+)\s*charge/)
  const billAmount = m ? parseFloat(m[1]) : 0
  const chargeAmount = m ? parseFloat(m[2]) : 0
  const refundAmount = Math.round((billAmount + chargeAmount) * 100) / 100

  let finalStatus: 'SUCCESS' | 'FAILED' | 'REFUNDED' | 'PENDING' = 'PENDING'

  if (providerStatus === 1) {
    finalStatus = 'SUCCESS'
    if ((entry.status || '').toUpperCase() !== 'SUCCESS') {
      const newDesc = `${entry.description || ''} | Callback TxnID:${orderId || requestId} | Ref:${operatorRef || 'N/A'}`
      await supabaseAdmin
        .from('partner_wallet_ledger')
        .update({ status: 'SUCCESS', description: newDesc })
        .eq('id', entry.id)
    }
  } else if (providerStatus === 3) {
    finalStatus = 'FAILED'
    // Idempotent refund — only if no REFUND_ entry already exists
    const { data: refundExists } = await supabaseAdmin
      .from('partner_wallet_ledger')
      .select('id')
      .eq('partner_id', partnerId)
      .eq('reference_id', `REFUND_${requestId}`)
      .limit(1)

    if (refundExists && refundExists.length > 0) {
      finalStatus = 'REFUNDED'
    } else if (refundAmount > 0) {
      const { error: refundErr } = await supabaseAdmin.rpc('refund_partner_wallet', {
        p_partner_id: partnerId,
        p_amount: refundAmount,
        p_payout_transaction_id: null,
        p_description: `CC-2 refund ₹${refundAmount} | Callback failed: ${providerMsg || 'payment failed'}`,
        p_reference_id: `REFUND_${requestId}`,
        p_service_type: 'rechargekit',
      })
      if (refundErr) {
        console.error('[Rechargekit Callback] Partner refund failed:', requestId, refundErr)
      } else {
        finalStatus = 'REFUNDED'
      }
    }
    await supabaseAdmin
      .from('partner_wallet_ledger')
      .update({ status: 'FAILED' })
      .eq('id', entry.id)
  }

  // Forward a signed webhook to the partner (fire-and-forget) if configured.
  try {
    const { data: partnerRow } = await supabaseAdmin
      .from('partners')
      .select('rechargekit_webhook_url, webhook_secret')
      .eq('id', partnerId)
      .eq('status', 'active')
      .maybeSingle()

    const ccWebhookUrl = (partnerRow as { rechargekit_webhook_url?: string | null })?.rechargekit_webhook_url

    if (ccWebhookUrl) {
      const payload = {
        event: 'rechargekit.cc.status',
        request_id: requestId,
        txn_id: finalStatus === 'FAILED' || finalStatus === 'REFUNDED' ? null : orderId || requestId,
        status: finalStatus,
        amount: billAmount || null,
        charge: chargeAmount || null,
        operator_reference: operatorRef || null,
        message: providerMsg || null,
        timestamp: new Date().toISOString(),
      }
      void sendSignedCallback({
        url: ccWebhookUrl,
        secret: (partnerRow as { webhook_secret?: string | null }).webhook_secret ?? null,
        payload,
        txnId: requestId,
        event: 'rechargekit.cc.status',
        logPrefix: 'Rechargekit Partner Callback',
      })
    } else {
      console.log(`[Rechargekit Callback] Partner ${partnerId} has no rechargekit_webhook_url — finalized without forward (partner can poll status). request_id=${requestId}`)
    }
  } catch (whErr: any) {
    console.error('[Rechargekit Callback] Partner webhook forward error:', whErr?.message || whErr)
  }

  console.log(`[Rechargekit Callback] Partner txn finalized: ${requestId} → ${finalStatus}`)
  return NextResponse.json({ ok: true, scope: 'partner', status: finalStatus.toLowerCase() })
}

/**
 * POST /api/rechargekit/callback
 * Rechargekit calls this URL when a pending transaction status changes.
 * Expected payload: { partner_request_id, status, orderid, optransid, commission, msg }
 */
export async function POST(request: NextRequest) {
  const authError = verifyRechargekitCaller(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const {
      partner_request_id,
      order_id,
      orderid,
      status,
      optransid,
      commission,
      msg,
      message,
    } = body

    const requestId = partner_request_id || order_id || orderid
    const providerStatus = Number(status)
    const operatorRef = optransid || ''
    const providerMsg = msg || message || ''

    console.log(`[Rechargekit Callback] request_id=${requestId} status=${providerStatus} optransid=${operatorRef}`)

    if (!requestId) {
      return NextResponse.json({ error: 'Missing partner_request_id' }, { status: 400 })
    }

    const supabaseAdmin = getSupabaseAdmin()

    const { data: tx, error: txErr } = await supabaseAdmin
      .from('bbps_transactions')
      .select('id, status, retailer_id, bill_amount, additional_info, scheme_id')
      .eq('agent_transaction_id', requestId)
      .maybeSingle()

    if (txErr || !tx) {
      // Not a retailer transaction — try the partner API ledger before giving up.
      const partnerResp = await handlePartnerRechargekitCallback(
        supabaseAdmin,
        requestId,
        providerStatus,
        orderid || requestId,
        operatorRef,
        providerMsg
      )
      if (partnerResp) return partnerResp

      console.error('[Rechargekit Callback] Transaction not found:', requestId, txErr)
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
    }

    if (tx.status === 'success' || tx.status === 'failed') {
      console.log(`[Rechargekit Callback] Transaction ${requestId} already finalized: ${tx.status}`)
      return NextResponse.json({ ok: true, message: 'Already finalized', status: tx.status })
    }

    const updatedInfo = { ...(tx.additional_info || {}), provider_txn_id: orderid || requestId, operator_reference: operatorRef, callback_status: providerStatus, callback_msg: providerMsg }

    if (providerStatus === 1) {
      // SUCCESS
      await supabaseAdmin.from('bbps_transactions').update({
        status: 'success',
        payment_status: 'success',
        transaction_id: orderid || requestId,
        completed_at: new Date().toISOString(),
        additional_info: updatedInfo,
      }).eq('id', tx.id)

      // Distribute commissions for successful payment
      try {
        const { data: retailerData } = await supabaseAdmin
          .from('retailers')
          .select('distributor_id, master_distributor_id')
          .eq('partner_id', tx.retailer_id)
          .maybeSingle()

        const distributorId = retailerData?.distributor_id || null
        const mdId = retailerData?.master_distributor_id || null

        if (tx.scheme_id) {
          const { data: chargeResult } = await supabaseAdmin.rpc(
            'calculate_bbps_charge_from_scheme',
            { p_scheme_id: tx.scheme_id, p_amount: tx.bill_amount, p_category: 'Credit Card' }
          )
          if (chargeResult?.length > 0) {
            const commSplit = {
              retailer_commission: parseFloat(chargeResult[0].retailer_commission) || 0,
              distributor_commission: parseFloat(chargeResult[0].distributor_commission) || 0,
              md_commission: parseFloat(chargeResult[0].md_commission) || 0,
            }
            const txRef = `RKCC_COMM_${requestId}`
            if (commSplit.retailer_commission > 0) {
              await supabaseAdmin.rpc('add_ledger_entry', {
                p_user_id: tx.retailer_id,
                p_user_role: 'retailer',
                p_wallet_type: 'primary',
                p_fund_category: 'commission',
                p_service_type: 'rechargekit',
                p_tx_type: 'COMMISSION_CREDIT',
                p_credit: commSplit.retailer_commission,
                p_debit: 0,
                p_reference_id: txRef,
                p_transaction_id: tx.id,
                p_status: 'completed',
                p_remarks: `Commission on CC-2 ₹${tx.bill_amount} (callback)`,
              })
            }
            if (commSplit.distributor_commission > 0 && distributorId) {
              await supabaseAdmin.rpc('add_ledger_entry', {
                p_user_id: distributorId,
                p_user_role: 'distributor',
                p_wallet_type: 'primary',
                p_fund_category: 'commission',
                p_service_type: 'rechargekit',
                p_tx_type: 'COMMISSION_CREDIT',
                p_credit: commSplit.distributor_commission,
                p_debit: 0,
                p_reference_id: txRef,
                p_status: 'completed',
                p_remarks: `DT commission on CC-2 ₹${tx.bill_amount} (callback, RT:${tx.retailer_id})`,
              })
            }
            if (commSplit.md_commission > 0 && mdId) {
              await supabaseAdmin.rpc('add_ledger_entry', {
                p_user_id: mdId,
                p_user_role: 'master_distributor',
                p_wallet_type: 'primary',
                p_fund_category: 'commission',
                p_service_type: 'rechargekit',
                p_tx_type: 'COMMISSION_CREDIT',
                p_credit: commSplit.md_commission,
                p_debit: 0,
                p_reference_id: txRef,
                p_status: 'completed',
                p_remarks: `MD commission on CC-2 ₹${tx.bill_amount} (callback, RT:${tx.retailer_id})`,
              })
            }
          }
        }
      } catch (commErr: any) {
        console.error('[Rechargekit Callback] Commission error (non-fatal):', commErr.message)
      }

      console.log(`[Rechargekit Callback] SUCCESS: ${requestId}`)
      return NextResponse.json({ ok: true, status: 'success' })
    }

    if (providerStatus === 3) {
      // FAILED — refund the wallet
      await supabaseAdmin.from('bbps_transactions').update({
        status: 'failed',
        payment_status: 'failed',
        error_message: providerMsg || 'Payment failed (callback)',
        completed_at: new Date().toISOString(),
        additional_info: updatedInfo,
      }).eq('id', tx.id)

      // Mark original debit ledger entry as failed
      await supabaseAdmin.from('wallet_ledger')
        .update({ status: 'failed' })
        .eq('reference_id', requestId)
        .eq('transaction_type', 'RECHARGEKIT_CC_DEBIT')

      // Refund: get original debit amount from ledger
      const { data: debitEntry } = await supabaseAdmin
        .from('wallet_ledger')
        .select('debit, user_role')
        .eq('reference_id', requestId)
        .eq('transaction_type', 'RECHARGEKIT_CC_DEBIT')
        .maybeSingle()

      if (debitEntry && debitEntry.debit > 0) {
        await supabaseAdmin.rpc('add_ledger_entry', {
          p_user_id: tx.retailer_id,
          p_user_role: debitEntry.user_role || 'retailer',
          p_wallet_type: 'primary',
          p_fund_category: 'service',
          p_service_type: 'rechargekit',
          p_tx_type: 'RECHARGEKIT_CC_REFUND',
          p_credit: debitEntry.debit,
          p_debit: 0,
          p_reference_id: `REFUND_${requestId}`,
          p_transaction_id: tx.id,
          p_status: 'completed',
          p_remarks: `Refund ₹${debitEntry.debit} | CC-2 callback failed: ${providerMsg}`,
        })
      }

      console.log(`[Rechargekit Callback] FAILED + REFUNDED: ${requestId}`)
      return NextResponse.json({ ok: true, status: 'failed', refunded: true })
    }

    // Status 2 or other = still pending
    await supabaseAdmin.from('bbps_transactions').update({
      additional_info: updatedInfo,
    }).eq('id', tx.id)

    console.log(`[Rechargekit Callback] Still pending: ${requestId} (status=${providerStatus})`)
    return NextResponse.json({ ok: true, status: 'pending' })
  } catch (error: any) {
    console.error('[Rechargekit Callback] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok', message: 'Rechargekit callback endpoint active' })
}
