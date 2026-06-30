import { NextRequest, NextResponse } from 'next/server'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { pay2newFetchBill } from '@/services/pay2new'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function POST(request: NextRequest) {
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
    const access = partnerCanUseApi(partner, 'bbps2')
    if (!access.allowed) {
      return NextResponse.json(
        { success: false, error: { code: 'FORBIDDEN', message: access.message } },
        { status: 403 }
      )
    }

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } },
        { status: 400 }
      )
    }

    const { number, product_code, customer_number, optional1, optional2, optional3, optional4, pincode } = body

    if (!number || !product_code || !customer_number) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'number, product_code, and customer_number are required' } },
        { status: 400 }
      )
    }

    const request_id = `SDS${Date.now()}`

    const result = await pay2newFetchBill({
      number,
      product_code: String(product_code),
      request_id,
      optional1: optional1 || '',
      optional2: optional2 || '',
      optional3: optional3 || '',
      optional4: optional4 || '',
      customer_number,
      pincode: pincode || '414002',
    })

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: { code: 'FETCH_BILL_ERROR', message: result.error || 'Bill fetch failed' }, request_id },
        { status: 200 }
      )
    }

    return NextResponse.json({
      success: true,
      data: result.data,
      order_id: result.order_id,
      request_id,
    })
  } catch (error: any) {
    console.error('[Partner Pay2New Bill Fetch] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: error.message || 'Bill fetch failed' } },
      { status: 500 }
    )
  }
}
