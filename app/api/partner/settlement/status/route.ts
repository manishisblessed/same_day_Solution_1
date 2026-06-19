import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { checkTransactionStatus } from '@/services/shadval-pay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

/**
 * GET /api/partner/settlement/status?reference_id=xxx
 * GET /api/partner/settlement/status?list=true
 * Check settlement transaction status or list recent transactions
 */
export async function GET(request: NextRequest) {
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

    const supabase = getSupabase()
    const { searchParams } = new URL(request.url)
    const referenceId = searchParams.get('reference_id')
    const listMode = searchParams.get('list') === 'true'

    // List mode: return recent transactions
    if (listMode) {
      const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50)
      const { data: txns } = await supabase
        .from('shadval_settlement')
        .select('id, reference_id, order_id, utr, amount, charges, total_debit, mode, status, status_message, account_number, ifsc_code, account_holder_name, created_at, provider_timestamp')
        .eq('retailer_id', partner.id)
        .order('created_at', { ascending: false })
        .limit(limit)

      return NextResponse.json({
        success: true,
        transactions: (txns || []).map((t) => ({
          id: t.id,
          reference_id: t.reference_id,
          order_id: t.order_id,
          utr: t.utr,
          amount: t.amount,
          charges: t.charges,
          total_debited: t.total_debit,
          mode: t.mode,
          status: t.status,
          status_message: t.status_message,
          account_number: t.account_number,
          ifsc_code: t.ifsc_code,
          account_holder_name: t.account_holder_name,
          created_at: t.created_at,
          provider_timestamp: t.provider_timestamp,
        })),
      })
    }

    // Single transaction status
    if (!referenceId) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'reference_id is required (or use list=true)' } },
        { status: 400 }
      )
    }

    const { data: tx } = await supabase
      .from('shadval_settlement')
      .select('*')
      .eq('reference_id', referenceId)
      .eq('retailer_id', partner.id)
      .maybeSingle()

    if (!tx) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Transaction not found' } },
        { status: 404 }
      )
    }

    // If PENDING, check with provider for live status
    if (tx.status === 'PENDING') {
      try {
        const apiResult = await checkTransactionStatus({ reference_id: referenceId })
        if (apiResult.status === 'SUCCESS' && apiResult.data) {
          const txnStatusLower = apiResult.data.txn_status?.toLowerCase() || ''
          const newStatus = (txnStatusLower.includes('success') && !txnStatusLower.includes('refund'))
            ? 'SUCCESS'
            : (txnStatusLower.includes('fail') || txnStatusLower.includes('refund'))
              ? 'FAILED'
              : 'PENDING'

          await supabase
            .from('shadval_settlement')
            .update({
              status: newStatus,
              utr: apiResult.data.utr || tx.utr,
              order_id: apiResult.data.order_id || tx.order_id,
              status_message: apiResult.data.status_message || apiResult.data.txn_status,
              provider_timestamp: apiResult.data.timestamp,
            })
            .eq('id', tx.id)

          // Refund on failure
          if (newStatus === 'FAILED') {
            const totalRefund = tx.amount + (tx.charges || 0)
            try {
              await supabase.rpc('refund_partner_wallet', {
                p_partner_id: partner.id,
                p_amount: totalRefund,
                p_payout_transaction_id: tx.id,
                p_description: `Settlement failed - Auto refund: ${apiResult.data.txn_status}`,
                p_reference_id: `REFUND_${referenceId}`,
              })
            } catch {}
          }

          tx.status = newStatus
          tx.utr = apiResult.data.utr || tx.utr
          tx.status_message = apiResult.data.status_message || apiResult.data.txn_status
        }
      } catch { /* keep existing status */ }
    }

    return NextResponse.json({
      success: true,
      transaction: {
        id: tx.id,
        reference_id: tx.reference_id,
        order_id: tx.order_id,
        utr: tx.utr,
        amount: tx.amount,
        charges: tx.charges,
        total_debited: tx.total_debit,
        mode: tx.mode,
        status: tx.status,
        status_message: tx.status_message,
        account_number: tx.account_number,
        ifsc_code: tx.ifsc_code,
        account_holder_name: tx.account_holder_name,
        created_at: tx.created_at,
        provider_timestamp: tx.provider_timestamp,
      },
    })
  } catch (error: any) {
    console.error('[Partner Settlement Status] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 }
    )
  }
}
