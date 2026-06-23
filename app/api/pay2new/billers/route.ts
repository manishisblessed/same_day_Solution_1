import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import {
  getPay2NewCreditCardBillers,
  getPay2NewProductList,
  PAY2NEW_CC_SERVICE_ID,
} from '@/services/pay2new'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)

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
