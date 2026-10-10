import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { authorizeSubPartner, normalizeMasterPartner } from '@/lib/partner-access'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { pay2newRecharge, settlePay2New } from '@/services/pay2new'
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { toUserSafeError } from '@/lib/provider-error'
import { createClient } from '@supabase/supabase-js'

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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const { user } = await getCurrentUserWithFallback(request)
    normalizeMasterPartner(user)

    if (!user) {
      const response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      return addCorsHeaders(request, response)
    }

    const access = authorizeSubPartner(user, ['bbps-2', 'credit-card'])
    if (!access.ok) return access.response

    if (!['retailer', 'partner'].includes(user.role) || !user.partner_id) {
      const response = NextResponse.json(
        { success: false, error: 'Access denied' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    const rl = rateLimit(request, { ...RATE_LIMITS.bbpsPay, identifier: user.partner_id })
    if (rl.limited) return addCorsHeaders(request, rl.response!)

    const { number, amount, product_code, optional1, optional2, optional3, optional4, customer_number, pincode } = body

    if (!number || !amount || !product_code) {
      const response = NextResponse.json(
        { success: false, error: 'Missing required fields: number, amount, product_code' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const amountNum = Number(amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      const response = NextResponse.json(
        { success: false, error: 'Amount must be greater than 0' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const supabaseAdmin = getSupabaseAdmin()

    const { data: walletBalance, error: balErr } = await (supabaseAdmin as any).rpc('get_wallet_balance', {
      p_retailer_id: user.partner_id,
    })
    if (balErr) {
      const response = NextResponse.json({ success: false, error: 'Failed to check wallet balance' }, { status: 500 })
      return addCorsHeaders(request, response)
    }
    if ((walletBalance || 0) < amountNum) {
      const response = NextResponse.json(
        { success: false, error: 'Insufficient wallet balance', wallet_balance: walletBalance || 0, required_amount: amountNum },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const request_id = `SDS${Date.now()}`

    const { error: debitErr } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
      p_user_id: user.partner_id,
      p_user_role: user.role,
      p_wallet_type: 'primary',
      p_fund_category: 'service',
      p_service_type: 'pay2new',
      p_tx_type: 'PAY2NEW_DEBIT',
      p_credit: 0,
      p_debit: amountNum,
      p_reference_id: request_id,
      p_status: 'completed',
      p_remarks: `Pay2New recharge ₹${amountNum} (${product_code}) - ${number}`,
    })
    if (debitErr) {
      const response = NextResponse.json({ success: false, error: 'Failed to debit wallet' }, { status: 500 })
      return addCorsHeaders(request, response)
    }

    const refund = async (reason: string) => {
      const { error: refundErr } = await (supabaseAdmin as any).rpc('add_ledger_entry', {
        p_user_id: user.partner_id, p_user_role: user.role, p_wallet_type: 'primary',
        p_fund_category: 'service', p_service_type: 'pay2new', p_tx_type: 'PAY2NEW_REFUND',
        p_credit: amountNum, p_debit: 0,
        p_reference_id: `REFUND_${request_id}`, p_status: 'completed',
        p_remarks: `Pay2New recharge refund ₹${amountNum} — ${reason}`,
      })
      if (refundErr) console.error('[Pay2New Recharge] CRITICAL refund failed:', refundErr)
    }

    const finalizeSuccess = (
      orderId: string | undefined,
      operatorReference: string | undefined,
      amount: number | string | undefined,
      balance: string | undefined
    ) => {
      const response = NextResponse.json({
        success: true,
        order_id: orderId,
        operator_reference: operatorReference,
        amount: amount ?? amountNum,
        balance,
        request_id,
      })
      return addCorsHeaders(request, response)
    }

    const finalizeFailed = async (reason: string) => {
      await refund(reason)
      const response = NextResponse.json(
        { success: false, error: reason, request_id },
        { status: 200 }
      )
      return addCorsHeaders(request, response)
    }

    // UNKNOWN → NO refund. Leave the debit; the recharge is being confirmed. The
    // user must not be refunded on a timeout the operator may have fulfilled.
    const finalizePending = () => {
      const response = NextResponse.json(
        {
          success: false,
          pending: true,
          status: 'PENDING',
          error: 'Your recharge is being confirmed with the operator. Please check the transaction status in a few minutes before trying again.',
          request_id,
        },
        { status: 200 }
      )
      return addCorsHeaders(request, response)
    }

    let result: Awaited<ReturnType<typeof pay2newRecharge>> | null = null
    let threw = false
    try {
      result = await pay2newRecharge({
        number,
        amount: amountNum,
        product_code: String(product_code),
        request_id,
        optional1: optional1 || '',
        optional2: optional2 || '',
        optional3: optional3 || '',
        optional4: optional4 || '',
        customer_number: customer_number || number,
        pincode: pincode || '414002',
      })
    } catch (provErr: any) {
      threw = true
      console.error('[Pay2New Recharge] provider call threw:', provErr?.message)
    }

    if (!threw && result?.success) {
      return finalizeSuccess(result.order_id, result.operator_reference, result.amount, result.balance)
    }

    // Definitive operator decline → refund immediately.
    if (!threw && result && !result.success && !result.ambiguous) {
      return await finalizeFailed(result.error || 'Recharge failed')
    }

    // Ambiguous (timeout/network) or thrown → confirm before refunding.
    const settled = await settlePay2New(request_id, { attempts: 2, spacingMs: 2500 })
    if (settled.outcome === 'SUCCESS') {
      return finalizeSuccess(
        settled.orderId,
        settled.operatorReference,
        settled.amount,
        undefined
      )
    }
    if (settled.outcome === 'FAILED') {
      return await finalizeFailed('Recharge failed')
    }
    console.warn(`[Pay2New Recharge] UNKNOWN outcome left PENDING for recon: request_id=${request_id} user=${user.partner_id}`)
    return finalizePending()
  } catch (error: any) {
    console.error('[Pay2New Recharge] Error:', error)
    const response = NextResponse.json(
      { success: false, error: toUserSafeError(error?.message, 'Recharge failed') },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}
