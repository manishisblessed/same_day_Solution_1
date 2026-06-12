import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { checkTransactionStatus } from '@/services/shadval-pay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * POST /api/shadval-pay/status
 * Check transaction status via SHADVAL PAY.
 *
 * Body: { reference_id: string }
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    const userRole = user?.role as string | undefined
    const isRetailer = userRole === 'retailer'
    const isAdmin = userRole === 'admin' || userRole === 'super_admin'

    if (!isRetailer && !isAdmin) {
      const response = NextResponse.json(
        { success: false, error: 'Access denied.' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    const body = await request.json()
    const { reference_id } = body

    if (!reference_id) {
      const response = NextResponse.json(
        { success: false, error: 'reference_id is required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    console.log('[ShadvalPay Status] Checking:', { ref: reference_id, user: user?.id })

    const result = await checkTransactionStatus({ reference_id })

    if (result.status !== 'SUCCESS') {
      const response = NextResponse.json(
        {
          success: false,
          error: result.message || 'Status check failed',
          code: result.code,
        },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const response = NextResponse.json({
      success: true,
      message: result.message,
      data: result.data,
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[ShadvalPay Status Route] Error:', error)
    const response = NextResponse.json(
      { success: false, error: error.message || 'Status check failed' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}
