/**
 * Chagans BBPS merchant wallet balance
 * POST /bbps/getWalletBalance (override via BBPS_CHAGANS_WALLET_PATH)
 */

import { chagansPost } from './chagansClient'
import { generateReqId, logBBPSApiCall, logBBPSApiError } from './helpers'
import { getChagansMerchantId } from './config'

function parseAmount(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const n = parseFloat(String(value).replace(/[,\s₹]/g, ''))
  return Number.isFinite(n) ? n : null
}

function extractChagansBalance(payload: Record<string, unknown>): {
  balance: number
  lien: number
} | null {
  const data = (payload.data as Record<string, unknown>) || payload

  const available =
    parseAmount(data.availableBalance) ??
    parseAmount(data.available_balance) ??
    parseAmount(data.available)

  const total =
    parseAmount(data.balance) ??
    parseAmount(data.walletBalance) ??
    parseAmount(data.wallet_balance) ??
    parseAmount(data.totalBalance)

  const lien =
    parseAmount(data.lien) ??
    parseAmount(data.lienAmount) ??
    parseAmount(data.lien_amount) ??
    0

  if (available !== null) {
    const totalBal = total ?? available + (lien || 0)
    return { balance: totalBal, lien: lien || 0 }
  }

  if (total !== null) {
    return { balance: total, lien: lien || 0 }
  }

  return null
}

export async function getChagansWalletBalance(): Promise<{
  success: boolean
  balance?: number
  lien?: number
  error?: string
}> {
  const reqId = generateReqId()
  const merchantId = getChagansMerchantId()
  const path =
    process.env.BBPS_CHAGANS_WALLET_PATH?.trim() || 'bbps/getWalletBalance'

  const body: Record<string, unknown> = {}
  if (merchantId) body.merchantId = merchantId

  try {
    const cg = await chagansPost<Record<string, unknown>>(path, body)

    if (!cg.ok) {
      const err =
        cg.error ||
        (typeof cg.data === 'object' && cg.data
          ? String((cg.data as any).message || (cg.data as any).error?.message || '')
          : '') ||
        'Failed to fetch Chagans wallet balance'
      logBBPSApiError('getChagansWalletBalance', reqId, err)
      return { success: false, error: err }
    }

    const payload = (cg.data || {}) as Record<string, unknown>
    if (payload.success === false) {
      const errField = payload.error
      const err =
        String(payload.message) ||
        (typeof errField === 'object' && errField && (errField as any).message
          ? String((errField as any).message)
          : '') ||
        (typeof errField === 'string' ? errField : '') ||
        'Chagans balance request failed'
      logBBPSApiError('getChagansWalletBalance', reqId, err)
      return { success: false, error: err }
    }

    const parsed = extractChagansBalance(payload)
    if (!parsed) {
      logBBPSApiError('getChagansWalletBalance', reqId, 'No balance field in Chagans response')
      return {
        success: false,
        error: 'Chagans wallet response did not include a balance amount',
      }
    }

    logBBPSApiCall('getChagansWalletBalance', reqId, undefined, cg.status, 'SUCCESS')
    return { success: true, balance: parsed.balance, lien: parsed.lien }
  } catch (e: any) {
    logBBPSApiError('getChagansWalletBalance', reqId, e)
    return { success: false, error: e?.message || 'Failed to fetch Chagans wallet balance' }
  }
}
