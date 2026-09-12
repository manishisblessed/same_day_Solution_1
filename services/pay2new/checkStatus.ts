/**
 * Pay2New Transaction Status Check
 * POST /apis/v1/transactionStatus
 */

import { pay2newPost } from './client'

export interface Pay2NewStatusOrder {
  number?: string
  amount?: number | string
  status?: string // "1" = success
  order_id?: string
  request_id?: string
  message?: string // e.g. "Transaction Successful"
  operator_reference?: string
  customer_number?: string
  closing_balance?: string
}

export interface Pay2NewStatusResponse {
  status: number // outer: 1 = found, 2 = not found
  message: string
  order?: Pay2NewStatusOrder
}

export interface CheckStatusParams {
  /** Our client transaction id (the SDS... value stored as ledger reference_id). */
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
    // Pay2New's transactionStatus API keys on `client_txn_id` (our request_id).
    // Sending `request_id` is rejected with "Invalid Parameters".
    const result = await pay2newPost<Pay2NewStatusResponse>('apis/v1/transactionStatus', {
      client_txn_id: params.request_id,
    })

    if (!result.ok || !result.data) {
      const errMsg = result.error || result.data?.message || 'Status check failed'
      // A definitive "no such transaction" from the provider means the payment
      // was never registered/charged -> treat as FAILED so callers can safely
      // resolve a stuck debit (rather than leaving it PENDING forever).
      if (/no\s*transaction\s*found/i.test(errMsg)) {
        return { success: true, status: 'FAILED', error: errMsg, raw: result.data as any }
      }
      console.error('[Pay2New] Check Status failed:', errMsg)
      return { success: false, error: errMsg, raw: result.data as any }
    }

    // Real Pay2New shape nests the details under `order`:
    // { status:1, message:"Transaction Found!", order:{ status:"1",
    //   message:"Transaction Successful", order_id, operator_reference, ... } }
    const resp = result.data
    const order = resp.order
    if (!order) {
      // Provider acknowledged (status:1) but returned no order block — unknown
      // state; report PENDING so callers wait rather than refund.
      return { success: true, status: 'PENDING', raw: resp }
    }

    const orderStatus = String(order.status ?? '').trim()
    const orderMsg = String(order.message ?? '').toLowerCase()

    let normalizedStatus: 'SUCCESS' | 'FAILED' | 'PENDING' | 'REFUNDED' = 'PENDING'
    if (orderStatus === '1' || /success|successful/.test(orderMsg)) {
      normalizedStatus = 'SUCCESS'
    } else if (/refund|revers/.test(orderMsg)) {
      normalizedStatus = 'REFUNDED'
    } else if (/fail|failure|reject|declin|cancel/.test(orderMsg)) {
      normalizedStatus = 'FAILED'
    }
    // Any other/unrecognized order state stays PENDING (safe: never refunds).

    return {
      success: true,
      status: normalizedStatus,
      order_id: order.order_id,
      operator_reference: order.operator_reference,
      amount: order.amount,
      raw: resp,
    }
  } catch (e: any) {
    console.error('[Pay2New] Check Status error:', e)
    return { success: false, error: e?.message || 'Pay2New status check error' }
  }
}
