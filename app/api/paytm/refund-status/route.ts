import { NextRequest, NextResponse } from 'next/server'
import { getPaytmConfig, callPaytmApi, formatTimestamp } from '@/lib/paytm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Paytm POS Refund Status API
 *
 * Checks the status of a previously initiated refund.
 *
 * Body: { merchantTransactionId (refund txn id), tid?, mid? }
 */
export async function POST(request: NextRequest) {
  try {
    const payload = await request.json()
    const { merchantTransactionId, tid, mid } = payload

    if (!merchantTransactionId) {
      return NextResponse.json({ success: false, error: 'merchantTransactionId is required' }, { status: 400 })
    }

    const config = getPaytmConfig()

    const body: Record<string, any> = {
      paytmMid: mid || config.mid,
      paytmTid: tid || config.tid,
      transactionDateTime: formatTimestamp(),
      merchantTransactionId,
    }

    const data = await callPaytmApi({
      endpoint: '/ecr/payment/refund/status',
      body,
    })

    const resultInfo = data?.body?.resultInfo || {}

    return NextResponse.json({
      success: resultInfo.resultStatus === 'S',
      merchantTransactionId,
      resultStatus: resultInfo.resultStatus,
      resultCode: resultInfo.resultCodeId || resultInfo.resultCode,
      resultMsg: resultInfo.resultMsg,
      refundAmount: data?.body?.refundAmount,
      raw: data,
    })
  } catch (error: any) {
    console.error('[Paytm Refund Status] Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
