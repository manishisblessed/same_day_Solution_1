/**
 * Knteer Solution — Wallet Balance
 * GET /wallet/balance
 */

import { knteerClient } from './client'
import { KnteerBalanceResponse } from './types'
import { isKnteerMockMode } from './config'

export async function getKnteerBalance(): Promise<{
  success: boolean
  usable_balance?: number
  collection_balance?: number
  error?: string
}> {
  if (isKnteerMockMode()) {
    return { success: true, usable_balance: 50000, collection_balance: 0 }
  }

  const res = await knteerClient.request<KnteerBalanceResponse>({
    method: 'POST',
    endpoint: '/Wallet/Balance',
  })

  if (!res.success || !res.data) {
    return { success: false, error: res.error || 'Failed to fetch balance' }
  }

  const d = res.data
  if (!d.status) {
    return { success: false, error: d.message || 'Balance fetch failed' }
  }

  return {
    success: true,
    usable_balance: d.UsableWallet ?? d.Balance ?? 0,
    collection_balance: d.CollectionWallet ?? 0,
  }
}
