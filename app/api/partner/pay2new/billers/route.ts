import { NextRequest, NextResponse } from 'next/server'
import { authenticatePartner, PartnerAuthError, partnerCanUseApi } from '@/lib/partner-auth'
import { getPay2NewCreditCardBillers, getPay2NewProductList, PAY2NEW_CC_SERVICE_ID } from '@/services/pay2new'
import { getEnabledCcBillerCodes } from '@/lib/pay2new/cc-billers'

// Legacy fallback — mirrors app/api/pay2new/billers/route.ts
const LEGACY_CC_BLOCKED_NAMES = new Set([
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

    let billers = (result as any).billers || (result as any).products || []

    // Apply DB-driven allowlist for CC billers (same logic as the retailer endpoint)
    if (serviceId === PAY2NEW_CC_SERVICE_ID) {
      const enabledCodes = await getEnabledCcBillerCodes()
      if (enabledCodes !== null) {
        billers = billers.filter((b: any) => enabledCodes.has(b.product_code))
      } else {
        billers = billers.filter((b: any) => !LEGACY_CC_BLOCKED_NAMES.has((b.product_name || '').toLowerCase()))
      }
    }

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
