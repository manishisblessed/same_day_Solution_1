/**
 * Pay2New Bill Payment
 * POST /apis/v1/billPayment
 */

import { pay2newPost } from './client'
import {
  getPay2NewOutletId,
  getPay2NewServerIp,
  getPay2NewDefaultLatitude,
  getPay2NewDefaultLongitude,
} from './config'
import type { Pay2NewBillPaymentRequest, Pay2NewBillPaymentResponse } from './types'

export interface BillPayParams {
  number: string
  amount: number
  product_code: string
  request_id: string
  bill_fetch_ref: string
  pan_number?: string
  optional1?: string
  optional2?: string
  optional3?: string
  optional4?: string
  customer_number: string
  pincode: string
  latitude?: string
  longitude?: string
  ip?: string
}

export async function pay2newPayBill(params: BillPayParams): Promise<{
  success: boolean
  order_id?: string
  operator_reference?: string
  amount?: number | string
  balance?: string
  error?: string
  raw?: Pay2NewBillPaymentResponse
}> {
  const payload: Pay2NewBillPaymentRequest = {
    number: params.number,
    amount: params.amount,
    product_code: params.product_code,
    request_id: params.request_id,
    bill_fetch_ref: params.bill_fetch_ref,
    pan_number: params.pan_number || '',
    optional1: params.optional1 || '',
    optional2: params.optional2 || '',
    optional3: params.optional3 || '',
    optional4: params.optional4 || '',
    customer_number: params.customer_number,
    pincode: params.pincode,
    latitude: params.latitude || getPay2NewDefaultLatitude(),
    longitude: params.longitude || getPay2NewDefaultLongitude(),
    ip: params.ip || getPay2NewServerIp(),
    outletId: String(getPay2NewOutletId()),
  }

  console.log('[Pay2New] Bill Pay payload:', JSON.stringify({
    ...payload,
    // Diagnostic: expose field presence/lengths without leaking full PAN
    _diag: {
      number_len: String(payload.number ?? '').length,
      amount_type: typeof payload.amount,
      bill_fetch_ref_len: String(payload.bill_fetch_ref ?? '').length,
      pan_present: !!payload.pan_number,
      customer_number_len: String(payload.customer_number ?? '').length,
      pincode: payload.pincode,
      lat: payload.latitude,
      lng: payload.longitude,
      ip: payload.ip,
      outletId: payload.outletId,
    },
  }))

  try {
    const result = await pay2newPost<Pay2NewBillPaymentResponse>('apis/v1/billPayment', payload as any)

    if (!result.ok || !result.data) {
      const errMsg = result.error || result.data?.message || 'Bill payment failed'
      console.error('[Pay2New] Bill Pay failed:', errMsg, '| raw response:', JSON.stringify(result.data ?? result.raw ?? null))
      return { success: false, error: errMsg, raw: result.data as any }
    }

    const resp = result.data
    console.log('[Pay2New] Bill Pay success:', resp.order_id, 'operator_ref:', resp.operator_reference)

    return {
      success: true,
      order_id: resp.order_id,
      operator_reference: resp.operator_reference,
      amount: resp.amount,
      balance: resp.balance,
      raw: resp,
    }
  } catch (e: any) {
    console.error('[Pay2New] Bill Pay error:', e)
    return { success: false, error: e?.message || 'Pay2New bill payment error' }
  }
}
