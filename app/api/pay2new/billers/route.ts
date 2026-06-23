import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserFromRequest } from '@/lib/auth-server-request'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import {
  getPay2NewCreditCardBillers,
  getPay2NewProductList,
  PAY2NEW_CC_SERVICE_ID,
} from '@/services/pay2new'
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

export async function GET(request: NextRequest) {
  try {
    let user = await getCurrentUserFromRequest(request)
    if (!user) {
      const userId = request.nextUrl.searchParams.get('user_id')
      if (userId) {
        const supabase = getSupabaseClient()
        const { data: retailer } = await supabase
          .from('retailers')
          .select('partner_id, name, email')
          .eq('partner_id', userId)
          .maybeSingle()
        if (retailer) {
          user = { id: userId, email: retailer.email || '', role: 'retailer' } as any
        }
      }
    }

    if (!user) {
      const response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      return addCorsHeaders(request, response)
    }

    const serviceIdParam = request.nextUrl.searchParams.get('service_id')
    const serviceId = serviceIdParam ? parseInt(serviceIdParam, 10) : PAY2NEW_CC_SERVICE_ID

    if (Number.isNaN(serviceId) || serviceId <= 0) {
      const response = NextResponse.json(
        { success: false, error: 'Invalid service_id' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const result =
      serviceId === PAY2NEW_CC_SERVICE_ID
        ? await getPay2NewCreditCardBillers()
        : await getPay2NewProductList(serviceId)

    const billers = (result as any).billers || (result as any).products || []

    if (!result.success) {
      const response = NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    const response = NextResponse.json({
      success: true,
      service_id: serviceId,
      billers,
      count: billers.length,
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[Pay2New Billers] Error:', error)
    const response = NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch billers' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}
