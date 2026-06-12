import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getBalance } from '@/services/shadval-pay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * GET /api/shadval-pay/balance
 * Returns SHADVAL PAY wallet balance.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    const userRole = user?.role as string | undefined
    const isAdmin = userRole === 'admin' || userRole === 'super_admin'
    const isRetailer = userRole === 'retailer'

    if (!isAdmin && !isRetailer) {
      const response = NextResponse.json(
        { success: false, error: 'Access denied.' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    const result = await getBalance()

    if (result.status !== 'SUCCESS') {
      const response = NextResponse.json(
        {
          success: false,
          error: result.message || 'Failed to fetch balance',
          code: result.code,
          payout_available: false,
        },
        { status: 500 }
      )
      return addCorsHeaders(request, response)
    }

    const balance = parseFloat(result.data?.balance || '0')

    if (!isAdmin) {
      const response = NextResponse.json({
        success: true,
        payout_available: balance > 100,
        provider: 'SHADVAL PAY',
      })
      return addCorsHeaders(request, response)
    }

    const response = NextResponse.json({
      success: true,
      balance,
      payout_available: balance > 100,
      provider: 'SHADVAL PAY',
      last_checked: new Date().toISOString(),
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[ShadvalPay Balance Route] Error:', error)
    const response = NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch balance', payout_available: false },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}
