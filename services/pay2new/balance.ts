/**
 * Pay2New wallet balance
 * GET /apis/v1/balance
 */

import { pay2newGet } from './client'
import type { Pay2NewBalanceResponse } from './types'

export async function getPay2NewBalance(): Promise<{
  success: boolean
  balance?: number
  error?: string
}> {
  try {
    const result = await pay2newGet<Pay2NewBalanceResponse>('apis/v1/balance')

    if (!result.ok || !result.data) {
      return { success: false, error: result.error || 'Failed to fetch Pay2New balance' }
    }

    const raw = result.data.balance
    const balance = parseFloat(String(raw).replace(/[,\s₹]/g, ''))
    if (!Number.isFinite(balance)) {
      return { success: false, error: 'Invalid balance value from Pay2New' }
    }

    return { success: true, balance }
  } catch (e: any) {
    return { success: false, error: e?.message || 'Failed to fetch Pay2New balance' }
  }
}
