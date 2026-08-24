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
 * POST /api/api-payment/status
 *
 * Retailer/Partner-facing status enquiry for an API Payment sale. Poll every
 * ~5s after initiating until `isFinal` is true.
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

    const data = await callPaytmApi({ endpoint: '/ecr/V2/payment/status', body })

    const b = data?.body || {}
    const resultInfo = b.resultInfo || {}
    const resultStatus = resultInfo.resultStatus
    const rStatusUp = (resultStatus || '').toString().toUpperCase()
    const rCodeId = (resultInfo.resultCodeId || '').toString()
    const isSuccess =
      rStatusUp === 'SUCCESS' || rStatusUp === 'TXN_SUCCESS' || rStatusUp === 'S' || rCodeId === '0000'
    const isFailure =
      !isSuccess &&
      (rStatusUp === 'FAILURE' || rStatusUp === 'FAIL' || rStatusUp === 'F' || rStatusUp.includes('FAIL'))
    const isFinal = isSuccess || isFailure

    const response = NextResponse.json({
      success: isSuccess,
      isFinal,
      merchantTransactionId,
      resultStatus,
      resultCode: resultInfo.resultCodeId || resultInfo.resultCode,
      resultMsg: resultInfo.resultMsg,
      transactionId: b.acquirementId || b.paytmTxnId || b.transactionId,
      amount: b.transactionAmount,
      paymentMode: b.payMethod || b.paymentMode,
      rrn: b.retrievalReferenceNo || b.rrn || b.bankReferenceNo,
      cardNumber: b.issuerMaskCardNo || b.lastFourDigitsCard || b.maskedCardNumber,
      cardType: b.cardType,
      cardScheme: b.cardScheme,
      bankName: b.issuingBankName || b.acquiringBank || b.bankName,
      authCode: b.authCode,
    })
    return addCorsHeaders(request, response)
  } catch (error: any) {
    console.error('[API Payment Status] Error:', error)
    const response = NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch status' },
      { status: 500 }
    )
    return addCorsHeaders(request, response)
  }
}
