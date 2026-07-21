import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { createClient } from '@supabase/supabase-js'
import { getRechargekitBaseUrl, getRechargekitApiToken } from '@/services/rechargekit/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * GET /api/rechargekit/status?request_id=RKCC...
 * Checks status of a pending Rechargekit CC payment.
 * Calls Rechargekit's /recharge/statusCheck API and updates our DB.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user || !user.partner_id) {
      const response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      return addCorsHeaders(request, response)
    }

    const requestId = request.nextUrl.searchParams.get('request_id')
    if (!requestId) {
      const response = NextResponse.json({ error: 'request_id is required' }, { status: 400 })
      return addCorsHeaders(request, response)
    }

    const supabaseAdmin = getSupabaseAdmin()

    // Verify this transaction belongs to the user
    const { data: tx, error: txErr } = await supabaseAdmin
      .from('bbps_transactions')
      .select('id, status, retailer_id, bill_amount, additional_info')
      .eq('agent_transaction_id', requestId)
      .eq('retailer_id', user.partner_id)
      .maybeSingle()

    if (txErr || !tx) {
      const response = NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
      return addCorsHeaders(request, response)
    }

    if (tx.status === 'success' || tx.status === 'failed') {
      const response = NextResponse.json({
        success: true,
        status: tx.status,
        message: tx.status === 'success' ? 'Payment successful' : 'Payment failed',
        request_id: requestId,
        additional_info: tx.additional_info,
      })
      return addCorsHeaders(request, response)
    }

    // Call Rechargekit status check API
    const base = getRechargekitBaseUrl().replace(/\/$/, '')
    const token = getRechargekitApiToken()
    const statusUrl = `${base}/recharge/statusCheck?partner_request_id=${encodeURIComponent(requestId)}`

    const res = await fetch(statusUrl, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    })
    const data = await res.json()

    console.log(`[Rechargekit Status] request_id=${requestId} response:`, JSON.stringify(data))

    const providerStatus = Number(data.status)
    const updatedInfo = {
      ...(tx.additional_info || {}),
      last_status_check: new Date().toISOString(),
      provider_status: providerStatus,
      provider_orderid: data.orderid,
      provider_optransid: data.optransid,
    }

    if (providerStatus === 1) {
      // Success — update transaction
      await supabaseAdmin.from('bbps_transactions').update({
        status: 'success',
        payment_status: 'success',
        transaction_id: data.orderid || requestId,
        completed_at: new Date().toISOString(),
        additional_info: updatedInfo,
      }).eq('id', tx.id)

      const response = NextResponse.json({
        success: true,
        status: 'success',
        message: 'Payment successful',
        order_id: data.orderid,
        operator_reference: data.optransid,
        request_id: requestId,
      })
      return addCorsHeaders(request, response)
    }

    if (providerStatus === 3) {
      // Failed — refund
      await supabaseAdmin.from('bbps_transactions').update({
        status: 'failed',
        payment_status: 'failed',
        error_message: data.msg || 'Payment failed',
        completed_at: new Date().toISOString(),
        additional_info: updatedInfo,
      }).eq('id', tx.id)

      // Refund wallet
      const { data: debitEntry } = await supabaseAdmin
        .from('wallet_ledger')
        .select('debit, user_role')
        .eq('reference_id', requestId)
        .eq('transaction_type', 'RECHARGEKIT_CC_DEBIT')
        .maybeSingle()

      if (debitEntry && debitEntry.debit > 0) {
        await supabaseAdmin.rpc('add_ledger_entry', {
          p_user_id: user.partner_id,
          p_user_role: debitEntry.user_role || user.role,
          p_wallet_type: 'primary',
          p_fund_category: 'service',
          p_service_type: 'rechargekit',
          p_tx_type: 'RECHARGEKIT_CC_REFUND',
          p_credit: debitEntry.debit,
          p_debit: 0,
          p_reference_id: `REFUND_${requestId}`,
          p_transaction_id: tx.id,
          p_status: 'completed',
          p_remarks: `Refund ₹${debitEntry.debit} | CC-2 status check: ${data.msg || 'failed'}`,
        })
      }

      const response = NextResponse.json({
        success: true,
        status: 'failed',
        message: data.msg || 'Payment failed — wallet refunded',
        refunded: true,
        request_id: requestId,
      })
      return addCorsHeaders(request, response)
    }

    // Still pending
    await supabaseAdmin.from('bbps_transactions').update({
      additional_info: updatedInfo,
    }).eq('id', tx.id)

    const response = NextResponse.json({
      success: true,
      status: 'pending',
      message: data.msg || 'Payment is still pending',
      request_id: requestId,
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[Rechargekit Status] Error:', error)
    const response = NextResponse.json({ error: error.message || 'Failed to check status' }, { status: 500 })
    return addCorsHeaders(request, response)
  }
}
