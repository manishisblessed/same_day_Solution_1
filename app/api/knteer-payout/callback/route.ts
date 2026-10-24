/**
 * POST /api/knteer-payout/callback
 *
 * Inbound webhook from Knteer Solution. Called when a transaction status changes.
 *
 * Expected payload (based on do-transaction response shape):
 * {
 *   StatusId: number,        // 3=PENDING  4=SUCCESS  5=FAILED  6=FAILED+REFUNDED
 *   partnerTransId: string,
 *   transId: string,
 *   amount: number,
 *   utr: string,
 *   mobile: string,
 *   accountNumber: string,
 *   ifsc: string,
 *   beneficiaryName: string
 * }
 *
 * MUST return HTTP 200 immediately — always ack first, process async-safe.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as crypto from 'crypto'
import {
  mapStatusId, verifyKnteerJwt,
  getKnteerCallbackSecret, isKnteerCallbackAuthEnforced,
} from '@/services/knteer-payout'
import { refundKnteerPayout } from '@/lib/knteer/refund'
import { distributeServiceCommission } from '@/lib/commission/distribute-service-commission'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

/** Constant-time compare for the optional shared-secret header. */
function secretMatches(provided: string, expected: string): boolean {
  if (!provided || !expected) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/**
 * Authenticate the inbound Knteer callback. Accepts EITHER a valid HS256 Bearer
 * JWT (same partner secret used for outbound calls) OR a configured static
 * shared secret header. Rejects everything else when enforcement is on.
 */
function authenticateCallback(request: NextRequest): { ok: boolean; reason?: string } {
  if (!isKnteerCallbackAuthEnforced()) return { ok: true, reason: 'enforcement_disabled' }

  // 1) Static shared secret (x-callback-token / x-webhook-secret), if configured.
  const callbackSecret = getKnteerCallbackSecret()
  if (callbackSecret) {
    const provided =
      request.headers.get('x-callback-token') ||
      request.headers.get('x-webhook-secret') ||
      request.nextUrl.searchParams.get('token') ||
      ''
    if (secretMatches(provided, callbackSecret)) return { ok: true }
  }

  // 2) Bearer JWT signed with the Knteer partner secret.
  const authHeader = request.headers.get('authorization') || ''
  if (authHeader.startsWith('Bearer ')) {
    const res = verifyKnteerJwt(authHeader.slice(7).trim())
    if (res.valid) return { ok: true }
    return { ok: false, reason: `jwt_${res.reason}` }
  }

  return { ok: false, reason: 'no_credentials' }
}

export async function POST(request: NextRequest) {
  // ── Authenticate the webhook BEFORE any processing ───────────────────────────
  const auth = authenticateCallback(request)
  if (!auth.ok) {
    console.warn('[Knteer Callback] Rejected unauthenticated callback:', auth.reason)
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 })
  }

  let rawBody = ''
  try {
    rawBody = await request.text()
    const payload = JSON.parse(rawBody)

    const { StatusId, partnerTransId, transId, amount, utr, mobile } = payload

    console.log('[Knteer Callback] Received:', { StatusId, partnerTransId, transId, utr })

    // ── Basic validation ─────────────────────────────────────────────────────
    if (!partnerTransId || StatusId === undefined) {
      console.warn('[Knteer Callback] Missing fields:', { partnerTransId, StatusId })
      return NextResponse.json({ success: false, error: 'partnerTransId and StatusId required' }, { status: 400 })
    }

    // ── Look up transaction ───────────────────────────────────────────────────
    const { data: tx, error: txErr } = await supabaseAdmin
      .from('knteer_payout_transactions')
      .select('id, retailer_id, user_role, partner_trans_id, amount, charges, actual_wallet_debit, status, scheme_id, distributor_id, md_id, distributor_commission, md_commission, company_earning')
      .eq('partner_trans_id', partnerTransId)
      .maybeSingle()

    if (txErr || !tx) {
      console.error('[Knteer Callback] Transaction not found:', { partnerTransId, error: txErr?.message })
      // Always return 200 so Knteer doesn't retry indefinitely
      return NextResponse.json({ success: true, message: 'acknowledged' })
    }

    // Already in a terminal state — idempotent ACK
    if (tx.status === 'SUCCESS' || tx.status === 'FAILED') {
      console.log('[Knteer Callback] Already terminal, skipping:', { txId: tx.id, status: tx.status })
      return NextResponse.json({ success: true, message: 'already processed' })
    }

    const mappedStatus = mapStatusId(Number(StatusId))
    const isSuccess = mappedStatus === 'success' && !!utr
    const isFailed = mappedStatus === 'failed' // StatusId 5 or 6
    const providerAlreadyRefunded = Number(StatusId) === 6

    // ── Only process terminal states from callback ────────────────────────────
    // StatusId 3 (PENDING) from callback = no-op; wait for another callback or cron
    if (!isSuccess && !isFailed) {
      console.log('[Knteer Callback] StatusId is PENDING — no action:', { partnerTransId, StatusId })
      return NextResponse.json({ success: true, message: 'pending — no action' })
    }

    const newStatus = isSuccess ? 'SUCCESS' : 'FAILED'

    // ── Atomic claim — prevent double-processing (callback + cron race) ───────
    const { data: claimed } = await supabaseAdmin
      .from('knteer_payout_transactions')
      .update({
        status: newStatus,
        status_id: Number(StatusId),
        knteer_trans_id: transId || null,
        utr: utr || null,
        status_message: isSuccess
          ? `SUCCESS via callback — UTR ${utr}`
          : providerAlreadyRefunded
            ? 'FAILED via callback — provider already refunded'
            : 'FAILED via callback',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', tx.id)
      .eq('status', 'PENDING')   // only claim from PENDING — prevents double-credit/refund
      .select('id')

    if (!claimed || claimed.length === 0) {
      console.log('[Knteer Callback] Race lost — another process already claimed:', { txId: tx.id })
      return NextResponse.json({ success: true, message: 'already claimed' })
    }

    // ── Process terminal outcome ───────────────────────────────────────────────
    if (isFailed) {
      // StatusId 6 → Knteer already refunded their side; still refund our wallet
      const refund = await refundKnteerPayout(
        supabaseAdmin,
        { ...tx, user_role: tx.user_role || 'retailer', partner_trans_id: partnerTransId },
        { skipProviderCheck: true }  // callback IS the confirmation — skip re-check
      )
      if (refund.critical) {
        console.error('[Knteer Callback] CRITICAL refund failed:', { txId: tx.id, error: refund.error })
        // Update status_message to flag for manual review
        await supabaseAdmin
          .from('knteer_payout_transactions')
          .update({ status_message: `FAILED [CRITICAL: REFUND_FAILED — manual review required] (${refund.error})` })
          .eq('id', tx.id)
      } else if (!refund.alreadyRefunded) {
        console.log('[Knteer Callback] Wallet refunded:', { txId: tx.id, providerAlreadyRefunded })
      }
    }

    if (isSuccess) {
      // Book commission revenue (idempotent — skipped if already done)
      const charges = parseFloat(String(tx.charges || 0))
      if (charges > 0) {
        await distributeServiceCommission({
          supabase: supabaseAdmin,
          service: 'knteer_payout',
          refPrefix: 'KNTEER',
          refKey: partnerTransId,
          transactionUuid: tx.id,
          totalCharge: charges,
          retailer: { id: tx.retailer_id, role: tx.user_role || 'retailer', commission: 0 },
          distributor: { id: tx.distributor_id || null, commission: parseFloat(String(tx.distributor_commission || 0)) },
          masterDistributor: { id: (tx as any).md_id || null },
          remarksSuffix: `on ₹${tx.amount} knteer payout`,
          auditWriteback: {
            table: 'knteer_payout_transactions',
            txnId: tx.id,
            retailerCol: 'retailer_commission_earned',
            distributorCol: 'distributor_commission',
            mdCol: 'md_commission',
            companyCol: 'company_earning',
          },
        }).catch(e => console.error('[Knteer Callback] Commission booking failed:', e))
      }
    }

    console.log('[Knteer Callback] Processed:', { txId: tx.id, oldStatus: 'PENDING', newStatus, utr, StatusId })
    return NextResponse.json({ success: true, message: 'processed' })
  } catch (err: any) {
    console.error('[Knteer Callback] Unhandled error:', err.message, { rawBody: rawBody.substring(0, 500) })
    // Return 200 so Knteer doesn't retry on our processing errors
    return NextResponse.json({ success: true, message: 'acknowledged with error' })
  }
}
