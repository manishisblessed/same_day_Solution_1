/**
 * Chagans BBPS categories: live /bbps/getCategory with in-memory cache,
 * plus static fallback for mapping UI names → categoryKey for /bbps/getBiller.
 */

import { chagansPost } from './chagansClient'
import { getBBPSProvider, isMockMode } from './config'

export const CHAGANS_CATEGORY_BY_CODE: Record<string, string> = {
  C00: 'Mobile Prepaid',
  C01: 'Mobile Postpaid',
  C02: 'Landline Postpaid',
  C03: 'DTH',
  C04: 'Electricity',
  C05: 'Broadband Postpaid',
  C06: 'Cable TV',
  C07: 'Gas',
  C08: 'Water',
  C09: 'Education Fee',
  C10: 'Fastag',
  C11: 'Insurance',
  C12: 'Donation',
  C13: 'Loan Repayment',
  C15: 'Credit Card',
  C17: 'Housing Society',
  C18: 'Subscription',
  C19: 'Municipal Taxes',
  C20: 'eChallan',
  C21: 'Municipal Services',
  C22: 'Clubs and Associations',
  C23: 'National Pension System',
  C24: 'EV Recharge',
  C25: 'Rental',
  C26: 'Fleet Card Recharge',
  C27: 'NCMC Recharge',
}

/** UI / internal names that differ from Chagans labels */
const DISPLAY_NAME_ALIASES: Record<string, string> = {
  'Education Fees': 'C09',
  NPS: 'C23',
  'LPG Gas': 'C07',
  Gas: 'C07',
  'Prepaid meter': 'C04',
}

const CACHE_MS = 10 * 60 * 1000

type CategoryCache = {
  names: string[]
  nameToKey: Record<string, string>
  at: number
}

let chagansCategoryCache: CategoryCache | null = null

function buildStaticNameToKey(): Record<string, string> {
  const m: Record<string, string> = {}
  for (const [code, name] of Object.entries(CHAGANS_CATEGORY_BY_CODE)) {
    m[name] = code
    m[name.toLowerCase()] = code
  }
  for (const [alias, code] of Object.entries(DISPLAY_NAME_ALIASES)) {
    m[alias] = code
    m[alias.toLowerCase()] = code
  }
  return m
}

/**
 * Refresh category name ↔ code from Chagans (or static fallback on failure).
 * Call before resolving a UI category name to categoryKey when using Chagans.
 */
export async function ensureChagansCategoryCache(): Promise<void> {
  if (getBBPSProvider() !== 'chagans' || isMockMode()) return
  if (chagansCategoryCache && Date.now() - chagansCategoryCache.at < CACHE_MS) return

  const res = await chagansPost<{ success?: boolean; data?: Record<string, string> }>('bbps/getCategory', {})

  if (!res.ok || res.data?.success === false || !res.data?.data || typeof res.data.data !== 'object') {
    console.warn('[Chagans] getCategory failed, using static map:', res.error)
    const nameToKey = buildStaticNameToKey()
    chagansCategoryCache = {
      names: Object.values(CHAGANS_CATEGORY_BY_CODE).sort((a, b) => a.localeCompare(b)),
      nameToKey,
      at: Date.now(),
    }
    return
  }

  const forward = res.data.data
  const nameToKey: Record<string, string> = { ...buildStaticNameToKey() }
  for (const [code, name] of Object.entries(forward)) {
    const label = String(name).trim()
    if (!label) continue
    nameToKey[label] = code
    nameToKey[label.toLowerCase()] = code
  }

  const names = [...new Set(Object.values(forward).map((n) => String(n).trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  )

  chagansCategoryCache = {
    names:
      names.length > 0
        ? names
        : Object.values(CHAGANS_CATEGORY_BY_CODE).sort((a, b) => a.localeCompare(b)),
    nameToKey,
    at: Date.now(),
  }
}

/** Sorted display names for UI (from live API when possible). */
export async function getChagansCategoryDisplayNames(): Promise<string[]> {
  await ensureChagansCategoryCache()
  if (chagansCategoryCache?.names?.length) return [...chagansCategoryCache.names]
  return Object.values(CHAGANS_CATEGORY_BY_CODE).sort((a, b) => a.localeCompare(b))
}

export function displayCategoryToChagansKey(displayName: string): string | null {
  const raw = displayName.trim()
  if (!raw) return null

  if (chagansCategoryCache && Date.now() - chagansCategoryCache.at < CACHE_MS + 120_000) {
    const hit = chagansCategoryCache.nameToKey[raw] || chagansCategoryCache.nameToKey[raw.toLowerCase()]
    if (hit) return hit
  }

  if (DISPLAY_NAME_ALIASES[raw]) return DISPLAY_NAME_ALIASES[raw]
  for (const [code, name] of Object.entries(CHAGANS_CATEGORY_BY_CODE)) {
    if (name.toLowerCase() === raw.toLowerCase()) return code
  }
  return null
}
