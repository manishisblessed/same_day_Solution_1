import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { checkKnteerStatus } from '@/services/knteer-payout'
import { refundKnteerPayout } from '@/lib/knteer/refund'
import { bookPartnerRevenue } from '@/lib/commission/partner-revenue'
import { sendKnteerTransferCallback } from '@/lib/knteer-payout-callback'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

function toIST(iso: string | null | undefined): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true })
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

/**
 * GET /api/partner/payout/status?transactionId=<uuid>
 * GET /api/partner/payout/status?partnerTransId=<your-ref>
 * GET /api/partner/payout/status?list=true&limit=20
 *
 * Check the status of a payout transaction initiated via POST /api/partner/payout/transfer.
 * For PENDING transactions, also fetches live status from Knteer and updates the DB.
 *
 * Requires: x-api-key, x-signature, x-timestamp headers.
 * Feature gate: Settlement / Payout must be enabled for this partner by admin.
 */
export async function GET(request: NextRequest) {
  try {
    // ── HMAC Authentication ────────────────────────────────────────────────
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

    // ── Feature gate ───────────────────────────────────────────────────────
    const payoutAccess = partnerCanUseApi(partner, 'payout')
    if (!payoutAccess.allowed) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: payoutAccess.message } },
        { status: 403 }
      )
    }

    const supabase = getSupabase()
    const { searchParams } = new URL(request.url)
    const transactionId = searchParams.get('transactionId')      // our UUID
    const partnerTransId = searchParams.get('partnerTransId')    // partner's own ref
    const listMode = searchParams.get('list') === 'true'
    const limitParam = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50)

    // ── List mode ──────────────────────────────────────────────────────────
    if (listMode) {
      const { data: txns } = await supabase
        .from('knteer_payout_transactions')
        .select('*')
        .eq('retailer_id', partner.id)
        .eq('user_role', 'partner')
        .order('created_at', { ascending: false })
        .limit(limitParam)

      const transactions = (txns || []).map((t: Record<string, any>) => ({
        transaction_id: t.id,
        partner_trans_id: t.partner_trans_id,
        knteer_trans_id: t.knteer_trans_id || null,
        utr: t.utr || null,
        status: t.status,
        amount: t.amount,
        charges: t.charges,
        total_debited: t.total_debit,
        payment_mode: t.payment_mode,
        account_number: (t.account_number as string || '').replace(/\d(?=\d{4})/g, '*'),
        account_holder_name: t.account_holder_name,
        bank_name: t.bank_name,
        remarks: t.remarks || null,
        created_at: t.created_at,
        created_at_ist: toIST(t.created_at),
        completed_at: t.completed_at || null,
        completed_at_ist: toIST(t.completed_at),
      }))

      return NextResponse.json({ success: true, transactions, count: transactions.length })
    }

    // ── Single transaction status ──────────────────────────────────────────
    if (!transactionId && !partnerTransId) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'transactionId or partnerTransId is required' } },
        { status: 400 }
      )
    }

    let query = supabase.from('knteer_payout_transactions').select('*').eq('retailer_id', partner.id)
    if (transactionId) query = query.eq('id', transactionId)
    else if (partnerTransId) query = query.eq('partner_trans_id', partnerTransId)

    const { data: tx, error: txErr } = await query.maybeSingle()

    if (txErr || !tx) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Transaction not found' } },
        { status: 404 }
      )
    }

    // ── Live status refresh for PENDING transactions ───────────────────────
    if (tx.status === 'PENDING' && tx.partner_trans_id) {
      try {
        const liveStatus = await checkKnteerStatus(tx.partner_trans_id)

        if (liveStatus.success && liveStatus.status && liveStatus.status !== 'pending') {
          const newStatus = liveStatus.status === 'success' ? 'SUCCESS' : 'FAILED'
          const updatePayload: Record<string, any> = {
            status: newStatus,
            status_id: liveStatus.status_id || null,
            knteer_trans_id: liveStatus.knteer_trans_id || tx.knteer_trans_id || null,
            utr: liveStatus.utr || null,
            status_message: liveStatus.status === 'success'
              ? `SUCCESS — UTR ${liveStatus.utr}`
              : 'Transfer failed',
            updated_at: new Date().toISOString(),
          }
          if (newStatus === 'SUCCESS' || newStatus === 'FAILED') {
            updatePayload.completed_at = new Date().toISOString()
          }

          await supabase.from('knteer_payout_transactions').update(updatePayload).eq('id', tx.id)

          // Auto-refund on failure (only if wallet was debited and not yet refunded)
          if (newStatus === 'FAILED' && tx.wallet_debited && !liveStatus.provider_refunded) {
            const refundAmount = tx.actual_wallet_debit || tx.total_debit
            refundKnteerPayout(supabase, {
              ...tx,
              user_role: 'partner',
              actual_wallet_debit: refundAmount,
              partner_trans_id: tx.partner_trans_id,
            }, { skipProviderCheck: true }).catch((e) =>
              console.error('[Partner Payout Status] Auto-refund failed:', e)
            )
          }

          // Book revenue on status-check success
          if (newStatus === 'SUCCESS' && tx.charges > 0) {
            bookPartnerRevenue({
              supabase,
              service: 'payout',
              partnerId: partner.id,
              refKey: tx.partner_trans_id,
              baseCharge: tx.charges,
              amount: Number(tx.amount),
              mode: tx.payment_mode,
              transactionUuid: tx.id,
              remarksSuffix: `on ₹${tx.amount} partner payout`,
            }).catch((e) => console.error('[Partner Payout Status] Revenue booking failed:', e))
          }

          // Reflect updates for response
          tx.status = newStatus
          tx.utr = liveStatus.utr || null
          tx.knteer_trans_id = liveStatus.knteer_trans_id || tx.knteer_trans_id

          // Fire webhook callback on status change (non-blocking)
          sendKnteerTransferCallback(partner.id, tx).catch(() => {})
        }
      } catch {
        /* keep existing status — non-fatal */
      }
    }

    return NextResponse.json({
      success: true,
      transaction: {
        transaction_id: tx.id,
        partner_trans_id: tx.partner_trans_id,
        knteer_trans_id: tx.knteer_trans_id || null,
        utr: tx.utr || null,
        status: tx.status,
        amount: tx.amount,
        charges: tx.charges,
        total_debited: tx.total_debit,
        payment_mode: tx.payment_mode,
        account_number: (tx.account_number as string).replace(/\d(?=\d{4})/g, '*'),
        account_holder_name: tx.account_holder_name,
        bank_name: tx.bank_name,
        ifsc_code: tx.ifsc_code,
        remarks: tx.remarks || null,
        created_at: tx.created_at,
        created_at_ist: toIST(tx.created_at),
        completed_at: tx.completed_at || null,
        completed_at_ist: toIST(tx.completed_at),
      },
    })
  } catch (error: any) {
    console.error('[Partner Payout Status] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
