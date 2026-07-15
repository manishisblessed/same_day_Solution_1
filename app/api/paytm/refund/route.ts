import { NextRequest, NextResponse } from 'next/server'
import { getPaytmConfig, callPaytmApi, formatTimestamp, generateMerchantTxnId } from '@/lib/paytm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Paytm POS Refund API
 *
 * Initiates a refund for a completed sale transaction.
 *
 * Body: { originalMerchantTransactionId, refundAmount (in rupees), tid?, mid? }
 */
export async function POST(request: NextRequest) {
  try {
    const payload = await request.json()
    const { originalMerchantTransactionId, refundAmount, tid, mid } = payload

    if (!originalMerchantTransactionId) {
      return NextResponse.json({ success: false, error: 'originalMerchantTransactionId is required' }, { status: 400 })
    }
    if (!refundAmount || isNaN(Number(refundAmount)) || Number(refundAmount) <= 0) {
      return NextResponse.json({ success: false, error: 'Valid refundAmount (in rupees) is required' }, { status: 400 })
    }

    const config = getPaytmConfig()
    const now = formatTimestamp()
    const merchantTransactionId = generateMerchantTxnId('RFD')
    const amountInPaise = Math.round(Number(refundAmount) * 100).toString()

    const body: Record<string, any> = {
      paytmMid: mid || config.mid,
      paytmTid: tid || config.tid,
      transactionDateTime: now,
      merchantTransactionId,
      originalMerchantTransactionId,
      refundAmount: amountInPaise,
    }

    const data = await callPaytmApi({
      endpoint: '/ecr/payment/refund',
      body,
    })

    const resultInfo = data?.body?.resultInfo || {}

    return NextResponse.json({
      success: resultInfo.resultStatus === 'A',
      merchantTransactionId,
      originalMerchantTransactionId,
      refundAmountInPaise: amountInPaise,
      refundAmountInRupees: Number(refundAmount),
      resultStatus: resultInfo.resultStatus,
      resultCode: resultInfo.resultCodeId || resultInfo.resultCode,
      resultMsg: resultInfo.resultMsg,
      raw: data,
    })
  } catch (error: any) {
    console.error('[Paytm Refund] Error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
