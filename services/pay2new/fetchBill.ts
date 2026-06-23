/**
 * Pay2New Bill Fetch
 * POST /apis/offer/v1/billFetch
 */

import { pay2newPost } from './client'
import {
  getPay2NewOutletId,
  getPay2NewServerIp,
  getPay2NewDefaultLatitude,
  getPay2NewDefaultLongitude,
} from './config'
import type { Pay2NewBillFetchRequest, Pay2NewBillFetchResponse } from './types'

export interface BillFetchParams {
  number: string
  product_code: string
  request_id: string
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

export async function pay2newFetchBill(params: BillFetchParams): Promise<{
  success: boolean
  data?: Pay2NewBillFetchResponse['data']
  order_id?: string
  error?: string
  raw?: Pay2NewBillFetchResponse
}> {
  const payload: Pay2NewBillFetchRequest = {
    number: params.number,
    product_code: params.product_code,
    request_id: params.request_id,
    optional1: params.optional1 || '',
    optional2: params.optional2 || '',
    optional3: params.optional3 || '',
    optional4: params.optional4 || '',
    customer_number: params.customer_number,
    pincode: params.pincode,
    latitude: params.latitude || getPay2NewDefaultLatitude(),
    longitude: params.longitude || getPay2NewDefaultLongitude(),
    ip: params.ip || getPay2NewServerIp(),
    outletId: getPay2NewOutletId(),
  }

  console.log('[Pay2New] Bill Fetch request_id:', params.request_id, 'product_code:', params.product_code)

  try {
    const result = await pay2newPost<Pay2NewBillFetchResponse>('apis/offer/v1/billFetch', payload as any)

    if (!result.ok || !result.data) {
      const errMsg = result.error || result.data?.message || 'Bill fetch failed'
      console.error('[Pay2New] Bill Fetch failed:', errMsg)
      return { success: false, error: errMsg, raw: result.data as any }
    }

    const resp = result.data
    console.log('[Pay2New] Bill Fetch success:', resp.order_id)

    return {
      success: true,
      data: resp.data,
      order_id: resp.order_id || undefined,
      raw: resp,
    }
  } catch (e: any) {
    console.error('[Pay2New] Bill Fetch error:', e)
    return { success: false, error: e?.message || 'Pay2New bill fetch error' }
  }
}
