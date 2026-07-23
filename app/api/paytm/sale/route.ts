import { NextRequest, NextResponse } from 'next/server'
import { getPaytmConfig, callPaytmApi, formatTimestamp, generateMerchantTxnId } from '@/lib/paytm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Paytm POS Wireless Sale API
 *
 * Initiates a payment request on the Paytm EDC terminal.
 * The POS device shows a payment popup; customer pays via card/QR.
 * Poll /api/paytm/status afterward to get the result.
 *
 * Body: { amount (in rupees), tid?, mid?, paymentMode?, merchantReferenceNo?, autoAccept? }
 */
export async function POST(request: NextRequest) {
  try {
    const payload = await request.json()
    const { amount, tid, mid, paymentMode, merchantReferenceNo, autoAccept } = payload

    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
      return NextResponse.json({ success: false, error: 'Valid amount (in rupees) is required' }, { status: 400 })
    }

    const config = getPaytmConfig()
    const paytmMid = mid || config.mid
    const paytmTid = tid || config.tid
    const now = formatTimestamp()
    const amountInPaise = Math.round(Number(amount) * 100).toString()
    const merchantTransactionId = generateMerchantTxnId()

    const body: Record<string, any> = {
      paytmMid,
      paytmTid,
      transactionDateTime: now,
      merchantTransactionId,
      transactionAmount: amountInPaise,
    }

    if (merchantReferenceNo) body.merchantReferenceNo = merchantReferenceNo

    const extendedInfo: Record<string, string> = {}
    extendedInfo.PaymentMode = paymentMode || 'All'
    extendedInfo.callbackUrl = payload.callbackUrl || config.callbackUrl || 'https://api.samedaysolution.in/api/paytm/notification/lagoon'
    if (autoAccept) extendedInfo.autoAccept = 'True'
    body.merchantExtendedInfo = extendedInfo

    const data = await callPaytmApi({
      endpoint: '/ecr/payment/request',
      body,
    })

    const resultInfo = data?.body?.resultInfo || {}
    // resultCode "A" = Accepted, "F" = Failed
    const accepted = resultInfo.resultCode === 'A' || resultInfo.resultStatus === 'ACCEPTED_SUCCESS'

    return NextResponse.json({
      success: accepted,
      merchantTransactionId,
      paytmMid,
      paytmTid,
      amountInPaise,
      amountInRupees: Number(amount),
      resultStatus: resultInfo.resultStatus,
      resultCode: resultInfo.resultCode,
      resultCodeId: resultInfo.resultCodeId,
      resultMsg: resultInfo.resultMsg,
      raw: data,
    })
  } catch (error: any) {
    console.error('[Paytm Sale] Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
