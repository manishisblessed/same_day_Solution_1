import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { authorizeSubPartner } from '@/lib/partner-access'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { isApiPaymentEnabled } from '@/lib/api-payment/access'
import { getPaytmConfig, callPaytmApi, formatTimestamp } from '@/lib/paytm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * POST /api/api-payment/abort
 *
 * Cancels an API Payment sale. Paytm has no server-side "abort in-flight" endpoint,
 * so this maps to Void (/ecr/void), which reverses a same-day sale by its
 * merchantTransactionId. Gated by the per-user "API Payment" service flag.
 *
 * Body: { merchantTransactionId }
 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)

    if (!user || !user.partner_id) {
      const response = NextResponse.json(
        { success: false, error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' },
        { status: 401 }
      )
      return addCorsHeaders(request, response)
    }

    const access = authorizeSubPartner(user, 'api-payment')
    if (!access.ok) return access.response

    if (!['retailer', 'partner'].includes(user.role)) {
      const response = NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
      return addCorsHeaders(request, response)
    }

    if (!(await isApiPaymentEnabled(user))) {
      const response = NextResponse.json(
        { success: false, error: 'API Payment is not enabled for your account.' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    const { merchantTransactionId } = await request.json()

    if (!merchantTransactionId) {
      const response = NextResponse.json(
        { success: false, error: 'merchantTransactionId is required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const config = getPaytmConfig()

    const body: Record<string, any> = {
      paytmMid: config.mid,
      paytmTid: config.tid,
      transactionDateTime: formatTimestamp(),
      merchantTransactionId,
    }

    const data = await callPaytmApi({ endpoint: '/ecr/void', body })

    const resultInfo = data?.body?.resultInfo || {}
    const accepted =
      resultInfo.resultStatus === 'A' ||
      resultInfo.resultStatus === 'ACCEPTED_SUCCESS' ||
      resultInfo.resultStatus === 'S' ||
      resultInfo.resultStatus === 'SUCCESS'

    const response = NextResponse.json({
      success: accepted,
      merchantTransactionId,
      resultStatus: resultInfo.resultStatus,
      resultCode: resultInfo.resultCodeId || resultInfo.resultCode,
      resultMsg: resultInfo.resultMsg,
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[API Payment Abort] Error:', error)
    const response = NextResponse.json(
      { success: false, error: error.message || 'Failed to abort' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}
