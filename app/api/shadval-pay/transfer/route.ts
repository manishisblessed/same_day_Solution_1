import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { initiateBankTransfer } from '@/services/shadval-pay'
import type { ShadvalTransferRequest } from '@/services/shadval-pay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * POST /api/shadval-pay/transfer
 * Initiate bank transfer via SHADVAL PAY.
 *
 * Body: {
 *   amount, mode, account_number, ifsc, beneficiary_name,
 *   contact_name, contact_email, contact_mobile,
 *   reference_id, latitude, longitude, narration
 * }
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
    const {
      amount,
      mode = 'IMPS',
      account_number,
      ifsc,
      beneficiary_name,
      contact_name,
      contact_email,
      contact_mobile,
      reference_id,
      latitude = '28.6139',
      longitude = '77.2090',
      narration = 'Bank Transfer',
    } = body

    // Validate required fields
    if (!amount || !account_number || !ifsc || !beneficiary_name || !reference_id) {
      const response = NextResponse.json(
        { success: false, error: 'Missing required fields: amount, account_number, ifsc, beneficiary_name, reference_id' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    if (amount <= 0) {
      const response = NextResponse.json(
        { success: false, error: 'Amount must be greater than 0' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const validModes = ['IMPS', 'NEFT', 'RTGS']
    if (!validModes.includes(mode)) {
      const response = NextResponse.json(
        { success: false, error: 'Invalid transfer mode. Must be IMPS, NEFT, or RTGS.' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const transferRequest: ShadvalTransferRequest = {
      amount: parseFloat(amount),
      mode,
      fund_account: {
        name: beneficiary_name,
        ifsc,
        account_number,
      },
      contact_details: {
        name: contact_name || beneficiary_name,
        email: contact_email || '',
        mobile: contact_mobile || '',
      },
      reference_id,
      latitude: String(latitude),
      longitude: String(longitude),
      narration,
    }

    console.log('[ShadvalPay Transfer] Initiating:', {
      ref: reference_id,
      amount,
      mode,
      account: account_number.substring(0, 4) + '****',
      user: user?.id,
    })

    const result = await initiateBankTransfer(transferRequest)

    if (result.status !== 'SUCCESS') {
      console.warn('[ShadvalPay Transfer] Failed:', { code: result.code, message: result.message })
      const response = NextResponse.json(
        {
          success: false,
          error: result.message || 'Transfer failed',
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
    console.error('[ShadvalPay Transfer Route] Error:', error)
    const response = NextResponse.json(
      { success: false, error: error.message || 'Transfer failed' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}
