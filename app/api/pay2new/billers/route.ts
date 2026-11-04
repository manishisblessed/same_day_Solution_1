import { NextRequest, NextResponse } from 'next/server'
import { toUserSafeError } from '@/lib/provider-error'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { authorizeSubPartner } from '@/lib/partner-access'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import {
  getPay2NewCreditCardBillers,
  getPay2NewProductList,
  PAY2NEW_CC_SERVICE_ID,
} from '@/services/pay2new'
import { getEnabledCcBillerCodes } from '@/lib/pay2new/cc-billers'

export const dynamic = 'force-dynamic'

// Legacy fallback blocklist — used ONLY when the pay2new_cc_billers table has
// not yet been seeded by admin. Once admin clicks "Refresh from Pay2New" on the
// Pay2New Banks page, the DB-driven allowlist takes over and this list is ignored.
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

    const access = authorizeSubPartner(user, ['bbps-2', 'credit-card'])
    if (!access.ok) return access.response

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
      // DB-driven allowlist: only enabled banks are shown.
      // Falls back to legacy blocklist when the table has not been seeded yet.
      const enabledCodes = await getEnabledCcBillerCodes()
      if (enabledCodes !== null) {
        billers = billers.filter((b: any) => enabledCodes.has(b.product_code))
      } else {
        billers = billers.filter((b: any) => !LEGACY_CC_BLOCKED_NAMES.has((b.product_name || '').toLowerCase()))
      }
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
      { success: false, error: toUserSafeError(error?.message, 'Failed to fetch billers') },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}
