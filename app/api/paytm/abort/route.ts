import { NextRequest, NextResponse } from 'next/server'
import { getPaytmConfig, callPaytmApi, formatTimestamp, isPosAuthorized } from '@/lib/paytm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Paytm POS Abort API
 *
 * Cancels an in-progress / pending Sale request on the EDC terminal (e.g. when the
 * customer walks away or the terminal is stuck showing a payment popup). Use the
 * SAME merchantTransactionId that was sent in the Sale request. This is distinct
 * from Void (which cancels an already-completed sale).
 *
 * Body: { merchantTransactionId, transactionDateTime?, tid?, mid? }
 */
export async function POST(request: NextRequest) {
  try {
    if (!isPosAuthorized(request)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }
    const payload = await request.json()
    const { merchantTransactionId, transactionDateTime, tid, mid } = payload

    if (!merchantTransactionId) {
      return NextResponse.json(
        { success: false, error: 'merchantTransactionId is required' },
        { status: 400 }
      )
    }

    const config = getPaytmConfig()

    const body: Record<string, any> = {
      paytmMid: mid || config.mid,
      paytmTid: tid || config.tid,
      transactionDateTime: transactionDateTime || formatTimestamp(),
      merchantTransactionId,
    }

    const data = await callPaytmApi({
      endpoint: '/ecr/payment/abort',
      body,
    })

    const resultInfo = data?.body?.resultInfo || {}
    // "A"/ACCEPTED_SUCCESS = abort accepted by terminal
    const accepted = resultInfo.resultStatus === 'A' || resultInfo.resultStatus === 'ACCEPTED_SUCCESS'

    return NextResponse.json({
      success: accepted,
      merchantTransactionId,
      resultStatus: resultInfo.resultStatus,
      resultCode: resultInfo.resultCodeId || resultInfo.resultCode,
      resultMsg: resultInfo.resultMsg,
      raw: data,
    })
  } catch (error: any) {
    console.error('[Paytm Abort] Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
