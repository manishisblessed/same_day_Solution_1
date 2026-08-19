import { NextRequest, NextResponse } from 'next/server'
import { getPaytmConfig, callPaytmApi, formatTimestamp, isPosAuthorized } from '@/lib/paytm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Paytm POS Status Enquiry API
 *
 * Polls the status of a previously initiated Sale transaction.
 * Call this 10 seconds after Sale API, retry every 10 seconds until final status.
 *
 * Body: { merchantTransactionId, transactionDateTime?, tid?, mid?, event? }
 * event = "VOID" to query void transactions
 */
export async function POST(request: NextRequest) {
  try {
    if (!isPosAuthorized(request)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }
    const payload = await request.json()
    const { merchantTransactionId, transactionDateTime, tid, mid, event } = payload

    if (!merchantTransactionId) {
      return NextResponse.json({ success: false, error: 'merchantTransactionId is required' }, { status: 400 })
    }

    const config = getPaytmConfig()

    const body: Record<string, any> = {
      paytmMid: mid || config.mid,
      paytmTid: tid || config.tid,
      transactionDateTime: transactionDateTime || formatTimestamp(),
      merchantTransactionId,
    }

    if (event) body.event = event

    const data = await callPaytmApi({
      endpoint: '/ecr/V2/payment/status',
      body,
    })

    const b = data?.body || {}
    const resultInfo = b.resultInfo || {}
    const resultCode = resultInfo.resultCodeId || resultInfo.resultCode
    const resultStatus = resultInfo.resultStatus

    // Paytm V2 status resultInfo carries the PAYMENT outcome.
    // Success => resultStatus "SUCCESS"/"TXN_SUCCESS"/"S" or resultCodeId "0000".
    const rStatusUp = (resultStatus || '').toString().toUpperCase()
    const rCodeId = (resultInfo.resultCodeId || '').toString()
    const isSuccess =
      rStatusUp === 'SUCCESS' || rStatusUp === 'TXN_SUCCESS' || rStatusUp === 'S' || rCodeId === '0000'
    const isFailure =
      !isSuccess &&
      (rStatusUp === 'FAILURE' || rStatusUp === 'FAIL' || rStatusUp === 'F' || rStatusUp.includes('FAIL'))
    const isFinal = isSuccess || isFailure

    return NextResponse.json({
      success: isSuccess,
      isFinal,
      merchantTransactionId,
      resultStatus,
      resultCode,
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
      raw: data,
    })
  } catch (error: any) {
    console.error('[Paytm Status] Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
