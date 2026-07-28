import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { checkTransactionStatus } from '@/services/shadval-pay'
import { createClient } from '@supabase/supabase-js'
import { reverseServiceCommission } from '@/lib/commission/distribute-service-commission'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
)

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * POST /api/settlement-2/status
 * Check status of a settlement transaction.
 * If a PENDING transaction has moved to FAILED at the provider, atomically
 * refund the *exact* amount that was debited from the retailer's wallet and
 * reverse any commission/revenue entries that were posted optimistically.
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || !['retailer', 'partner'].includes(user.role)) {
      const response = NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 })
      return addCorsHeaders(request, response)
    }

    const body = await request.json()
    const { reference_id } = body

    if (!reference_id) {
      const response = NextResponse.json({ success: false, error: 'reference_id is required' }, { status: 400 })
      return addCorsHeaders(request, response)
    }

    const { data: txRecord } = await supabaseAdmin
      .from('shadval_settlement')
      .select('id, retailer_id, status, amount, charges, total_debit, actual_wallet_debit, reference_id, revenue_ledger_id, distributor_commission, md_commission, company_earning, scheme_id')
      .eq('reference_id', reference_id)
      .eq('retailer_id', user.partner_id)
      .maybeSingle()

    if (!txRecord) {
      const response = NextResponse.json({ success: false, error: 'Transaction not found' }, { status: 404 })
      return addCorsHeaders(request, response)
    }

    const apiResult = await checkTransactionStatus({ reference_id })

    if (apiResult.status === 'SUCCESS' && apiResult.data) {
      const txnStatusLower = apiResult.data.txn_status?.toLowerCase() || ''
      const newStatus = (txnStatusLower.includes('success') && !txnStatusLower.includes('refund'))
        ? 'SUCCESS'
        : (txnStatusLower.includes('fail') || txnStatusLower.includes('refund'))
        ? 'FAILED'
        : 'PENDING'

      const wasPending = txRecord.status === 'PENDING'
      const nowFailed = newStatus === 'FAILED'

      // Atomically claim the PENDING→FAILED transition to prevent double-refund
      if (wasPending && nowFailed) {
        const { data: claimed } = await supabaseAdmin
          .from('shadval_settlement')
          .update({
            status: 'FAILED',
            utr: apiResult.data.utr || undefined,
            order_id: apiResult.data.order_id || undefined,
            status_message: `${apiResult.data.status_message || apiResult.data.txn_status} [Wallet refunded]`,
            provider_timestamp: apiResult.data.timestamp,
          })
          .eq('id', txRecord.id)
          .eq('status', 'PENDING')
          .select('id')

        if (claimed && claimed.length > 0) {
          // Refund exactly what was debited — prefer actual_wallet_debit, fallback to total_debit
          const refundAmount = parseFloat(String(txRecord.actual_wallet_debit || txRecord.total_debit || 0))
            || (parseFloat(String(txRecord.amount)) + parseFloat(String(txRecord.charges || 0)))

          if (refundAmount > 0) {
            const { error: refundErr } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
              p_user_id: txRecord.retailer_id,
              p_user_role: user.role,
              p_wallet_type: 'primary',
              p_fund_category: 'service',
              p_service_type: 'shadval_settlement',
              p_tx_type: 'SETTLEMENT2_REFUND',
              p_credit: refundAmount,
              p_debit: 0,
              p_reference_id: `REFUND_${txRecord.reference_id}`,
              p_transaction_id: txRecord.id,
              p_status: 'completed',
              p_remarks: `Settlement-2 refund ₹${refundAmount.toFixed(2)} — provider status: ${apiResult.data.txn_status || 'FAILED'}`,
            })
            if (refundErr) console.error('[Settlement-2 Status] CRITICAL refund failed:', refundErr)
            else console.log(`[Settlement-2 Status] Refunded ₹${refundAmount} to ${txRecord.retailer_id} for ${reference_id}`)
          }

          // Reverse commission/revenue if charges were involved (DT + company; no MD)
          const chargesNum = parseFloat(String(txRecord.charges || 0))
          if (chargesNum > 0) {
            await reverseServiceCommission({
              supabase: supabaseAdmin,
              service: 'shadval_settlement',
              refPrefix: 'SHADVAL',
              refKey: txRecord.reference_id,
              transactionUuid: txRecord.id,
            })
          }
        }
      } else {
        // Normal status update (not PENDING→FAILED, or already handled)
        await supabaseAdmin
          .from('shadval_settlement')
          .update({
            status: newStatus,
            utr: apiResult.data.utr || undefined,
            order_id: apiResult.data.order_id || undefined,
            status_message: apiResult.data.status_message || apiResult.data.txn_status,
            provider_timestamp: apiResult.data.timestamp,
          })
          .eq('id', txRecord.id)
      }

      const response = NextResponse.json({
        success: true,
        data: apiResult.data,
        refunded: wasPending && nowFailed ? true : undefined,
      })
      return addCorsHeaders(request, response)
    }

    const response = NextResponse.json({
      success: false,
      error: apiResult.message || 'Status check failed',
      code: apiResult.code,
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[Settlement-2 Status] Error:', error)
    const response = NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return addCorsHeaders(request, response)
  }
}
