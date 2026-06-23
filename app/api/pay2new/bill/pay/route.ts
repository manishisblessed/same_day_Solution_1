import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { pay2newPayBill } from '@/services/pay2new'

export const dynamic = 'force-dynamic'

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

    const { number, amount, product_code, bill_fetch_ref, optional1, optional2, optional3, optional4, customer_number, pincode } = body

    if (!number || !amount || !product_code || !bill_fetch_ref || !customer_number) {
      const response = NextResponse.json(
        { success: false, error: 'Missing required fields: number, amount, product_code, bill_fetch_ref, customer_number' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    if (amount <= 0) {
      const response = NextResponse.json(
        { success: false, error: 'Amount must be greater than 0' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const request_id = `SDS${Date.now()}`

    const result = await pay2newPayBill({
      number,
      amount: Number(amount),
      product_code: String(product_code),
      request_id,
      bill_fetch_ref,
      optional1: optional1 || '',
      optional2: optional2 || '',
      optional3: optional3 || '',
      optional4: optional4 || '',
      customer_number,
      pincode: pincode || '414002',
    })

    if (!result.success) {
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
    console.error('[Pay2New Bill Pay] Error:', error)
    const response = NextResponse.json(
      { success: false, error: error.message || 'Bill payment failed' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}
