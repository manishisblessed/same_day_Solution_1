/**
 * Chagans BBPS merchant wallet balance
 * Tries configured path then known Chagans wallet route candidates.
 */

import { chagansRequest, type ChagansRequestResult } from './chagansClient'
import { generateReqId, logBBPSApiCall, logBBPSApiError } from './helpers'
import { getChagansMerchantId } from './config'

export const CHAGANS_WALLET_PATH_CANDIDATES = [
  'bbps/getWalletBalance',
  'bbps/getMerchantWalletBalance',
  'bbps/getMerchantBalance',
  'bbps/walletBalance',
  'bbps/getBalance',
  'bbps/merchantWalletBalance',
  'bbps/checkWalletBalance',
  'bbps/wallet/getBalance',
  'bbps/fetchWalletBalance',
  'bbps/getPartnerWalletBalance',
] as const

let cachedWalletPath: { path: string; method: 'POST' | 'GET' } | null = null

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

function walletPathCandidates(): string[] {
  const configured = process.env.BBPS_CHAGANS_WALLET_PATH?.trim()
  const paths = configured ? [configured, ...CHAGANS_WALLET_PATH_CANDIDATES] : [...CHAGANS_WALLET_PATH_CANDIDATES]
  return [...new Set(paths.map((p) => p.replace(/^\//, '')))]
}

function parseWalletResponse(
  cg: ChagansRequestResult<Record<string, unknown>>
): { success: true; balance: number; lien: number } | { success: false; error: string; routeNotFound?: boolean } {
  if (!cg.ok) {
    return {
      success: false,
      error: cg.error || 'Failed to fetch Chagans wallet balance',
      routeNotFound: cg.routeNotFound,
    }
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
    return { success: false, error: err }
  }

  const parsed = extractChagansBalance(payload)
  if (!parsed) {
    return {
      success: false,
      error: 'Chagans wallet response did not include a balance amount',
    }
  }

  return { success: true, balance: parsed.balance, lien: parsed.lien }
}

export async function probeChagansWalletPaths(): Promise<
  Array<{
    path: string
    method: 'POST' | 'GET'
    status: number
    ok: boolean
    routeNotFound?: boolean
    error?: string
    balance?: number
  }>
> {
  const merchantId = getChagansMerchantId()
  const body: Record<string, unknown> = {}
  if (merchantId) body.merchantId = merchantId

  const results: Array<{
    path: string
    method: 'POST' | 'GET'
    status: number
    ok: boolean
    routeNotFound?: boolean
    error?: string
    balance?: number
  }> = []

  for (const path of walletPathCandidates()) {
    for (const method of ['POST', 'GET'] as const) {
      const cg = await chagansRequest<Record<string, unknown>>(path, { method, body })
      const parsed = parseWalletResponse(cg)
      results.push({
        path,
        method,
        status: cg.status,
        ok: parsed.success,
        routeNotFound: cg.routeNotFound,
        error: parsed.success ? undefined : parsed.error,
        balance: parsed.success ? parsed.balance : undefined,
      })
      if (parsed.success) return results
    }
  }

  return results
}

export async function getChagansWalletBalance(): Promise<{
  success: boolean
  balance?: number
  lien?: number
  error?: string
  routeNotFound?: boolean
}> {
  const reqId = generateReqId()
  const merchantId = getChagansMerchantId()
  const body: Record<string, unknown> = {}
  if (merchantId) body.merchantId = merchantId

  const failures: string[] = []
  let sawRouteNotFound = false

  const attempts: Array<{ path: string; method: 'POST' | 'GET' }> = []
  if (cachedWalletPath) attempts.push(cachedWalletPath)
  for (const path of walletPathCandidates()) {
    attempts.push({ path, method: 'POST' })
  }

  const seen = new Set<string>()
  const uniqueAttempts = attempts.filter(({ path, method }) => {
    const key = `${method}:${path}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  try {
    for (const { path, method } of uniqueAttempts) {
      const cg = await chagansRequest<Record<string, unknown>>(path, { method, body })
      const parsed = parseWalletResponse(cg)

      if (parsed.success) {
        cachedWalletPath = { path, method }
        logBBPSApiCall(
          'getChagansWalletBalance',
          reqId,
          `${method} ${path}`,
          cg.status,
          'SUCCESS'
        )
        return { success: true, balance: parsed.balance, lien: parsed.lien }
      }

      if (cg.routeNotFound) {
        sawRouteNotFound = true
        continue
      }

      failures.push(`${method} ${path}: ${parsed.error}`)
    }

    const err = sawRouteNotFound
      ? 'Chagans wallet balance API is not available on the configured host. Ask Chagans support for the correct merchant wallet balance endpoint and set BBPS_CHAGANS_WALLET_PATH on EC2.'
      : failures[failures.length - 1] || 'Failed to fetch Chagans wallet balance'

    logBBPSApiError('getChagansWalletBalance', reqId, err)
    return { success: false, error: err, routeNotFound: sawRouteNotFound }
  } catch (e: any) {
    logBBPSApiError('getChagansWalletBalance', reqId, e)
    return { success: false, error: e?.message || 'Failed to fetch Chagans wallet balance' }
  }
}
