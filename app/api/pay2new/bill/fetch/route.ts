import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { pay2newFetchBill } from '@/services/pay2new'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase environment variables not configured')
  return createClient(url, key)
}

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    let user = await getCurrentUserFromRequest(request)
    if (!user && body.user_id) {
      const supabase = getSupabaseClient()
      const { data: retailer } = await supabase
        .from('retailers')
        .select('partner_id, name, email')
        .eq('partner_id', body.user_id)
        .maybeSingle()
      if (retailer) {
        user = { id: body.user_id, email: retailer.email || '', role: 'retailer' } as any
      }
    }

    if (!user) {
      const response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      return addCorsHeaders(request, response)
    }

    const { number, product_code, optional1, optional2, optional3, optional4, customer_number, pincode } = body

    if (!number || !product_code || !customer_number) {
      const response = NextResponse.json(
        { success: false, error: 'Missing required fields: number, product_code, customer_number' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
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
      const response = NextResponse.json(
        { success: false, error: result.error, request_id },
        { status: 200 }
      )
      return addCorsHeaders(request, response)
    }

    const response = NextResponse.json({
      success: true,
      data: result.data,
      order_id: result.order_id,
      request_id,
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[Pay2New Bill Fetch] Error:', error)
    const response = NextResponse.json(
      { success: false, error: error.message || 'Bill fetch failed' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}
