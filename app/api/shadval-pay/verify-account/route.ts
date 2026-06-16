import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { verifyAccount } from '@/services/shadval-pay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * POST /api/shadval-pay/verify-account
 * Verify bank account (penny drop) via SHADVAL PAY.
 *
 * Body: { account_number, ifsc_code, latitude?, longitude? }
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
    const { account_number, ifsc_code, latitude, longitude } = body

    if (!account_number || !ifsc_code) {
      const response = NextResponse.json(
        { success: false, error: 'account_number and ifsc_code are required.' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const ref_num = `SDAV_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`

    const result = await verifyAccount({
      account_number,
      ifsc_code,
      ref_num,
      latitude: latitude || '0.0',
      longitude: longitude || '0.0',
    })

    const verified = result.status === 'SUCCESS' && result.data?.verification_status === true

    const response = NextResponse.json({
      success: verified,
      status: result.status,
      code: result.code,
      message: result.message,
      name_at_bank: result.data?.name_at_bank?.trim() || '',
      verification_status: result.data?.verification_status ?? false,
      order_id: result.data?.order_id,
      ref_num: result.data?.ref_num || ref_num,
      account_number: result.data?.account_number,
      ifsc_code: result.data?.ifsc_code,
    })

    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[ShadvalPay Account Verification] Error:', error)
    const response = NextResponse.json(
      { success: false, error: error.message || 'Account verification failed' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}
