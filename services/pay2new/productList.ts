/**
 * Pay2New Product List (billers by service_id)
 * POST /apis/v1/productList
 *
 * Credit Card billers are service_id=34
 */

import { pay2newPost } from './client'
import type { Pay2NewProductListResponse, Pay2NewProduct } from './types'

export const PAY2NEW_CC_SERVICE_ID = 34

export async function getPay2NewProductList(serviceId: number): Promise<{
  success: boolean
  products?: Pay2NewProduct[]
  error?: string
}> {
  try {
    const result = await pay2newPost<Pay2NewProductListResponse>('apis/v1/productList', {
      service_id: serviceId,
    })

    if (!result.ok || !result.data) {
      return { success: false, error: result.error || 'Failed to fetch product list' }
    }

    return { success: true, products: result.data.data || [] }
  } catch (e: any) {
    return { success: false, error: e?.message || 'Failed to fetch Pay2New product list' }
  }
}

export async function getPay2NewCreditCardBillers(): Promise<{
  success: boolean
  billers?: Pay2NewProduct[]
  error?: string
}> {
  const result = await getPay2NewProductList(PAY2NEW_CC_SERVICE_ID)
  if (!result.success) return result
  return { success: true, billers: result.products }
}
