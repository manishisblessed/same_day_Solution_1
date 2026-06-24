import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { pay2newRecharge } from '@/services/pay2new'
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit'
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

    if (!user) {
      const response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      return addCorsHeaders(request, response)
    }

    if (user.role !== 'retailer' || !user.partner_id) {
      const response = NextResponse.json(
        { success: false, error: 'Only retailers can use this service' },
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
      p_user_role: 'retailer',
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
      await (supabaseAdmin as any).rpc('add_ledger_entry', {
        p_user_id: user.partner_id, p_user_role: 'retailer', p_wallet_type: 'primary',
        p_fund_category: 'service', p_service_type: 'pay2new', p_tx_type: 'PAY2NEW_REFUND',
        p_credit: amountNum, p_debit: 0,
        p_reference_id: `REFUND_${request_id}`, p_status: 'completed',
        p_remarks: `Pay2New recharge refund ₹${amountNum} — ${reason}`,
      }).catch((e: any) => console.error('[Pay2New Recharge] CRITICAL refund failed:', e))
    }

    let result
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
      await refund('provider error')
      const response = NextResponse.json(
        { success: false, error: provErr?.message || 'Recharge failed', request_id },
        { status: 200 }
      )
      return addCorsHeaders(request, response)
    }

    if (!result.success) {
      await refund(result.error || 'recharge failed')
      const response = NextResponse.json(
        { success: false, error: result.error, request_id },
        { status: 200 }
      )
      return addCorsHeaders(request, response)
    }

    const response = NextResponse.json({
      success: true,
      order_id: result.order_id,
      operator_reference: result.operator_reference,
      amount: result.amount,
      balance: result.balance,
      request_id,
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[Pay2New Recharge] Error:', error)
    const response = NextResponse.json(
      { success: false, error: error.message || 'Recharge failed' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}
