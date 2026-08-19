import { NextRequest, NextResponse } from 'next/server'
import { getPaytmConfig, callPaytmApi, formatTimestamp, isPosAuthorized } from '@/lib/paytm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Paytm POS Abort / Cancel API
 *
 * Paytm's ECR gateway does NOT expose a REST endpoint to abort an in-flight sale
 * (that is a device/SDK-level "Cancel Transaction" command). The server-side way
 * to cancel a transaction is Void (/ecr/void), which reverses a same-day sale.
 *
 * This route wraps Paytm Void: pass the ORIGINAL sale's merchantTransactionId
 * (that is the Order Id Paytm's Void API expects in the body).
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
      endpoint: '/ecr/void',
      body,
    })

    const resultInfo = data?.body?.resultInfo || {}
    const accepted =
      resultInfo.resultStatus === 'A' ||
      resultInfo.resultStatus === 'ACCEPTED_SUCCESS' ||
      resultInfo.resultStatus === 'S' ||
      resultInfo.resultStatus === 'SUCCESS'

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
