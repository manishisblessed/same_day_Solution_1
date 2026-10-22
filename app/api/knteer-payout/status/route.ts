import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { authorizeSubPartner, normalizeMasterPartner } from '@/lib/partner-access'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { checkKnteerStatus } from '@/services/knteer-payout'
import { createClient } from '@supabase/supabase-js'
import { refundKnteerPayout } from '@/lib/knteer/refund'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export async function OPTIONS(request: NextRequest) {
  const res = handleCorsPreflight(request)
  return res || new NextResponse(null, { status: 204 })
}

/**
 * GET /api/knteer-payout/status
 *  ?transactionId=<uuid>     — single transaction lookup + live re-check
 *  ?partnerTransId=<ref>     — same
 *  ?list=true                — recent 20 transactions for the authenticated user
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    normalizeMasterPartner(user)

    if (!user?.partner_id) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 }))
    }
    const access = authorizeSubPartner(user, 'payout')
    if (!access.ok) return access.response

    const { searchParams } = new URL(request.url)
    const listMode = searchParams.get('list') === 'true'

    // ── List mode ─────────────────────────────────────────────────────────────
    if (listMode) {
      const { data: transactions, error: listErr } = await supabaseAdmin
        .from('knteer_payout_transactions')
        .select('*')
        .eq('retailer_id', user.partner_id)
        .order('created_at', { ascending: false })
        .limit(20)

      if (listErr) {
        console.error('[Knteer Status] List error:', listErr)
        return addCorsHeaders(request, NextResponse.json({ success: true, transactions: [] }))
      }

      // Map to the shape the UI component expects (mirrors payout_transactions naming)
      const mapped = (transactions || []).map((tx: any) => ({
        id: tx.id,
        client_ref_id: tx.partner_trans_id,
        provider_txn_id: tx.knteer_trans_id,
        rrn: tx.utr,
        status: (tx.status || 'PENDING').toUpperCase(),
        amount: tx.amount,
        charges: tx.charges,
        total_amount: tx.total_debit,
        account_number: tx.account_number,
        account_holder_name: tx.account_holder_name,
        bank_name: tx.bank_name,
        transfer_mode: tx.payment_mode,
        failure_reason: tx.failure_reason || tx.status_message,
        created_at: tx.created_at,
        completed_at: tx.completed_at,
      }))

      return addCorsHeaders(request, NextResponse.json({ success: true, transactions: mapped }))
    }

    const txId = searchParams.get('transactionId')
    const partnerTransId = searchParams.get('partnerTransId')

    if (!txId && !partnerTransId) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'transactionId or partnerTransId required' }, { status: 400 }))
    }

    let query = supabaseAdmin.from('knteer_payout_transactions').select('*')
    if (txId) query = query.eq('id', txId)
    else query = query.eq('partner_trans_id', partnerTransId!)
    query = query.eq('retailer_id', user.partner_id)

    const { data: tx, error } = await query.maybeSingle()
    if (error || !tx) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: 'Transaction not found' }, { status: 404 }))
    }

    // If still pending — re-check Knteer
    if (tx.status === 'PENDING' && tx.partner_trans_id) {
      const providerResult = await checkKnteerStatus(tx.partner_trans_id)

      if (providerResult.success && providerResult.status && providerResult.status !== 'pending') {
        const isSuccess = providerResult.status === 'success' && !!providerResult.utr
        const newStatus = isSuccess ? 'SUCCESS' : 'FAILED'

        const { data: claimed } = await supabaseAdmin
          .from('knteer_payout_transactions')
          .update({
            status: newStatus,
            utr: providerResult.utr || null,
            knteer_trans_id: providerResult.knteer_trans_id || tx.knteer_trans_id || null,
            status_id: providerResult.status_id || null,
            status_message: isSuccess ? `SUCCESS — UTR ${providerResult.utr}` : 'FAILED at provider',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', tx.id)
          .eq('status', 'PENDING')
          .select('id')

        if (claimed && claimed.length > 0) {
          if (!isSuccess) {
            await refundKnteerPayout(supabaseAdmin, { ...tx, user_role: tx.user_role || 'retailer' })
          }
          tx.status = newStatus
          tx.utr = providerResult.utr || tx.utr
        }
      }
    }

    return addCorsHeaders(request, NextResponse.json({
      success: true,
      transaction: {
        id: tx.id,
        // Named to be compatible with PayoutTransfer UI component
        client_ref_id: tx.partner_trans_id,
        provider_txn_id: tx.knteer_trans_id,
        rrn: tx.utr,
        status: (tx.status || 'PENDING').toUpperCase(),
        amount: tx.amount,
        charges: tx.charges,
        total_amount: tx.total_debit,
        transfer_mode: tx.payment_mode,
        account_number: tx.account_number?.replace(/\d(?=\d{4})/g, '*'),
        account_holder_name: tx.account_holder_name,
        bank_name: tx.bank_name,
        failure_reason: tx.failure_reason || tx.status_message,
        created_at: tx.created_at,
        completed_at: tx.completed_at,
        // Knteer-specific extras
        partner_trans_id: tx.partner_trans_id,
        knteer_trans_id: tx.knteer_trans_id,
        utr: tx.utr,
      },
    }))
  } catch (err: any) {
    console.error('[Knteer Status Route] Error:', err)
    return addCorsHeaders(request, NextResponse.json({ success: false, error: err.message }, { status: 500 }))
  }
}
