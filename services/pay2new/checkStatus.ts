/**
 * Pay2New Transaction Status Check
 * POST /apis/v1/transactionStatus
 */

import { pay2newPost } from './client'

export interface Pay2NewStatusResponse {
  status: number
  message: string
  order_id?: string
  request_id?: string
  operator_reference?: string
  transaction_status?: string // SUCCESS, FAILED, PENDING
  amount?: number | string
}

export interface CheckStatusParams {
  request_id: string
}

export async function pay2newCheckStatus(params: CheckStatusParams): Promise<{
  success: boolean
  status?: 'SUCCESS' | 'FAILED' | 'PENDING' | 'REFUNDED'
  order_id?: string
  operator_reference?: string
  amount?: number | string
  error?: string
  raw?: Pay2NewStatusResponse
}> {
  console.log('[Pay2New] Check Status request_id:', params.request_id)

  try {
    const result = await pay2newPost<Pay2NewStatusResponse>('apis/v1/transactionStatus', {
      request_id: params.request_id,
    })

    if (!result.ok || !result.data) {
      const errMsg = result.error || result.data?.message || 'Status check failed'
      console.error('[Pay2New] Check Status failed:', errMsg)
      return { success: false, error: errMsg, raw: result.data as any }
    }

    const resp = result.data
    const txStatus = (resp.transaction_status || '').toUpperCase()

    let normalizedStatus: 'SUCCESS' | 'FAILED' | 'PENDING' | 'REFUNDED' = 'PENDING'
    if (txStatus === 'SUCCESS' || txStatus === 'COMPLETED') {
      normalizedStatus = 'SUCCESS'
    } else if (txStatus === 'FAILED' || txStatus === 'FAILURE' || txStatus === 'REJECTED') {
      normalizedStatus = 'FAILED'
    } else if (txStatus === 'REFUNDED' || txStatus === 'REVERSED') {
      normalizedStatus = 'REFUNDED'
    }

    return {
      success: true,
      status: normalizedStatus,
      order_id: resp.order_id,
      operator_reference: resp.operator_reference,
      amount: resp.amount,
      raw: resp,
    }
  } catch (e: any) {
    console.error('[Pay2New] Check Status error:', e)
    return { success: false, error: e?.message || 'Pay2New status check error' }
  }
}
