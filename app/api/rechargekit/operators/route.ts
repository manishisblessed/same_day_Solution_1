import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getRechargekitCcOperators, isCreditCard2Enabled } from '@/services/rechargekit'

export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * GET /api/rechargekit/operators
 * Credit Card operators (operator_category=11)
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)

    if (!user) {
      const response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      return addCorsHeaders(request, response)
    }

    if (!['retailer', 'partner'].includes(user.role)) {
      const response = NextResponse.json({ success: false, error: 'Access denied' }, { status: 403 })
      return addCorsHeaders(request, response)
    }

    if (!(await isCreditCard2Enabled(user))) {
      const response = NextResponse.json(
        { success: false, error: 'Credit Card-2 service is not enabled for your account' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    const result = await getRechargekitCcOperators()

    if (!result.success) {
      const response = NextResponse.json(
        { success: false, error: result.error || 'Failed to fetch operators' },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    const response = NextResponse.json({
      success: true,
      operators: result.operators || [],
      count: (result.operators || []).length,
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[Rechargekit Operators] Error:', error)
    const response = NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch operators' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}
