import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { authorizeSubPartner } from '@/lib/partner-access'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { isApiPaymentEnabled } from '@/lib/api-payment/access'
import { getPaytmConfig, callPaytmApi, formatTimestamp, generateMerchantTxnId } from '@/lib/paytm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

/**
 * POST /api/api-payment/sale
 *
 * Retailer/Partner-facing wrapper around the Paytm ECR Sale API. Authenticated by
 * the dashboard session (NOT the POS admin secret) and gated by the per-user
 * "API Payment" service flag. Initiates a card sale on the EDC terminal; the S2S
 * callback records the transaction and the UI polls /api/api-payment/status.
 *
 * Body: { amount (rupees), paymentMode?: 'Card' | 'QR' | 'All', merchantReferenceNo? }
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
      const response = NextResponse.json(
        { success: false, error: 'Forbidden: only retailers and partners can use API Payment' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    if (!(await isApiPaymentEnabled(user))) {
      const response = NextResponse.json(
        { success: false, error: 'API Payment is not enabled for your account. Please contact support.' },
        { status: 403 }
      )
      return addCorsHeaders(request, response)
    }

    const rl = rateLimit(request, { ...RATE_LIMITS.bbpsPay, identifier: user.partner_id })
    if (rl.limited) return addCorsHeaders(request, rl.response!)

    const payload = await request.json()
    const { amount, paymentMode } = payload

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      const response = NextResponse.json(
        { success: false, error: 'Valid amount (in rupees) is required' },
        { status: 400 }
      )
      return addCorsHeaders(request, response)
    }

    const config = getPaytmConfig()
    const paytmMid = config.mid
    const paytmTid = config.tid
    const now = formatTimestamp()
    const amountInPaise = Math.round(Number(amount) * 100).toString()
    const merchantTransactionId = generateMerchantTxnId('SDSAP')
    const mode = paymentMode || 'Card'

    const body: Record<string, any> = {
      paytmMid,
      paytmTid,
      transactionDateTime: now,
      merchantTransactionId,
      transactionAmount: amountInPaise,
      merchantReferenceNo: `${user.role}:${user.partner_id}`,
      paymentMode: mode,
    }

    body.callbackUrl =
      config.callbackUrl || 'https://api.samedaysolution.in/api/paytm/notification/lagoon'
    body.merchantExtendedInfo = { paymentMode: mode }

    const data = await callPaytmApi({ endpoint: '/ecr/payment/request', body })

    const resultInfo = data?.body?.resultInfo || {}
    const accepted = resultInfo.resultCode === 'A' || resultInfo.resultStatus === 'ACCEPTED_SUCCESS'

    const response = NextResponse.json({
      success: accepted,
      merchantTransactionId,
      amountInPaise,
      amountInRupees: Number(amount),
      paymentMode: mode,
      resultStatus: resultInfo.resultStatus,
      resultCode: resultInfo.resultCode,
      resultMsg: resultInfo.resultMsg,
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[API Payment Sale] Error:', error)
    const response = NextResponse.json(
      { success: false, error: error.message || 'Failed to initiate sale' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}
