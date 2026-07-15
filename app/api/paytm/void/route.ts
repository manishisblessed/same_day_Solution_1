import { NextRequest, NextResponse } from 'next/server'
import { getPaytmConfig, callPaytmApi, formatTimestamp, generateMerchantTxnId } from '@/lib/paytm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Paytm POS Void API
 *
 * Cancels/voids a completed sale transaction on the EDC terminal.
 *
 * Body: { originalMerchantTransactionId, tid?, mid? }
 */
export async function POST(request: NextRequest) {
  try {
    const payload = await request.json()
    const { originalMerchantTransactionId, tid, mid } = payload

    if (!originalMerchantTransactionId) {
      return NextResponse.json({ success: false, error: 'originalMerchantTransactionId is required' }, { status: 400 })
    }

    const config = getPaytmConfig()
    const now = formatTimestamp()
    const merchantTransactionId = generateMerchantTxnId('VOID')

    const body: Record<string, any> = {
      paytmMid: mid || config.mid,
      paytmTid: tid || config.tid,
      transactionDateTime: now,
      merchantTransactionId,
      originalMerchantTransactionId,
    }

    const data = await callPaytmApi({
      endpoint: '/ecr/payment/void',
      body,
    })

    const resultInfo = data?.body?.resultInfo || {}

    return NextResponse.json({
      success: resultInfo.resultStatus === 'A',
      merchantTransactionId,
      originalMerchantTransactionId,
      resultStatus: resultInfo.resultStatus,
      resultCode: resultInfo.resultCodeId || resultInfo.resultCode,
      resultMsg: resultInfo.resultMsg,
      raw: data,
    })
  } catch (error: any) {
    console.error('[Paytm Void] Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
