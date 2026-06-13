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
 * GET /api/admin/shadval-pay-balance
 *
 * Returns SHADVAL PAY PRIVATE LIMITED wallet balance for admin dashboard.
 * Admin only endpoint.
 */
export async function GET(request: NextRequest) {
  try {
    const { user: admin, method } = await getCurrentUserWithFallback(request)
    console.log('[ShadvalPay Admin Balance] Auth method:', method, '| User:', admin?.email || 'none')

    if (!admin) {
      const response = NextResponse.json(
        { error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' },
        { status: 401 }
      )
      return addCorsHeaders(request, response)
    }

    if (admin.role !== 'admin') {
      const response = NextResponse.json(
        { error: 'Unauthorized: Admin access required' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    const result = await getBalance()

    const balance = result.status === 'SUCCESS' ? Number(result.data?.balance ?? 0) : 0

    const response = NextResponse.json({
      success: result.status === 'SUCCESS',
      balance,
      available_balance: balance,
      code: result.code,
      error: result.status !== 'SUCCESS' ? result.message : null,
      provider: 'SHADVAL PAY PRIVATE LIMITED',
      service_name: 'Payout (IMPS/NEFT/RTGS)',
      last_checked: new Date().toISOString(),
    })

    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[ShadvalPay Admin Balance] Error:', error)
    const response = NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch SHADVAL PAY balance',
        provider: 'SHADVAL PAY PRIVATE LIMITED',
      },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}
