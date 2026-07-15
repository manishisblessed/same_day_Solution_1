import { NextRequest, NextResponse } from 'next/server'
import { getPaytmConfig, callPaytmApi, formatTimestamp } from '@/lib/paytm'

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

    const resultInfo = data?.body?.resultInfo || {}
    const resultCode = resultInfo.resultCodeId || resultInfo.resultCode
    const resultStatus = resultInfo.resultStatus
    const isFinal = resultStatus === 'S' || resultStatus === 'F'

    return NextResponse.json({
      success: resultStatus === 'S',
      isFinal,
      merchantTransactionId,
      resultStatus,
      resultCode,
      resultMsg: resultInfo.resultMsg,
      transactionId: data?.body?.paytmTxnId || data?.body?.transactionId,
      amount: data?.body?.transactionAmount,
      paymentMode: data?.body?.paymentMode,
      rrn: data?.body?.rrn || data?.body?.bankReferenceNo,
      cardNumber: data?.body?.maskedCardNumber,
      cardType: data?.body?.cardType,
      bankName: data?.body?.bankName,
      authCode: data?.body?.authCode,
      raw: data,
    })
  } catch (error: any) {
    console.error('[Paytm Status] Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
