import { NextRequest, NextResponse } from 'next/server'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { getPay2NewCreditCardBillers, getPay2NewProductList, PAY2NEW_CC_SERVICE_ID } from '@/services/pay2new'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(request: NextRequest) {
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

    const serviceIdParam = request.nextUrl.searchParams.get('service_id')
    const serviceId = serviceIdParam ? parseInt(serviceIdParam, 10) : PAY2NEW_CC_SERVICE_ID

    if (Number.isNaN(serviceId) || serviceId <= 0) {
      return NextResponse.json(
        { success: false, error: { code: 'BAD_REQUEST', message: 'Invalid service_id' } },
        { status: 400 }
      )
    }

    const result =
      serviceId === PAY2NEW_CC_SERVICE_ID
        ? await getPay2NewCreditCardBillers()
        : await getPay2NewProductList(serviceId)

    const billers = (result as any).billers || (result as any).products || []

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: { code: 'PROVIDER_ERROR', message: result.error || 'Failed to fetch billers' } },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      service_id: serviceId,
      billers,
      count: billers.length,
    })
  } catch (error: any) {
    console.error('[Partner Pay2New Billers] Error:', error)
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch billers' } },
      { status: 500 }
    )
  }
}
