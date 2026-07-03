import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import {
  getPay2NewCreditCardBillers,
  getPay2NewProductList,
  PAY2NEW_CC_SERVICE_ID,
} from '@/services/pay2new'

export const dynamic = 'force-dynamic'

// Billers that don't support Cash payment mode — Pay2New can't process them.
// These are hidden from the Credit Card tab until BBPS fallback is fully stable.
const PAY2NEW_CC_BLOCKED_NAMES = new Set([
  'yes bank credit card',
  'rbl bank credit card',
  'kotak mahindra bank credit card',
  'bank of maharashtra credit card',
  'bob credit card',
  'dbs bank credit card',
  'hsbc credit card',
  'hdfc bank pixel credit card',
  'hdfc credit card',
  'saraswat co-operative bank ltd',
])

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

    let billers = (result as any).billers || (result as any).products || []

    if (serviceId === PAY2NEW_CC_SERVICE_ID) {
      billers = billers.filter((b: any) => !PAY2NEW_CC_BLOCKED_NAMES.has((b.product_name || '').toLowerCase()))
    }

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
