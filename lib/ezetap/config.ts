/**
 * Ezetap POS Bridge (Razorpay HDFC) — credential resolution.
 *
 * Environment:
 * - EZETAP_API_BASE_URL — default https://demo.ezetap.com (use production URL when live)
 * - EZETAP_MERCHANT_CREDENTIALS_JSON — JSON map: { "newscenaric": { "username": "...", "appKey": "..." }, ... }
 * - EZETAP_USERNAME + EZETAP_APP_KEY — fallback when JSON is not set (paired with EZETAP_DEFAULT_MERCHANT_SLUG)
 * - EZETAP_DEFAULT_MERCHANT_SLUG — default slug for fallback pair (default: newscenaric)
 */

export const EZETAP_MERCHANT_SLUGS = [
  'ashvam',
  'teachway',
  'newscenaric',
  'lagoon',
] as const

export type EzetapMerchantSlug = (typeof EZETAP_MERCHANT_SLUGS)[number]

export type EzetapCredentials = {
  username: string
  appKey: string
}

function parseCredentialsJson(): Record<string, EzetapCredentials> {
  const raw = process.env.EZETAP_MERCHANT_CREDENTIALS_JSON?.trim()
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, { username?: string; appKey?: string }>
    const out: Record<string, EzetapCredentials> = {}
    for (const [slug, v] of Object.entries(parsed)) {
      const u = String(v?.username || '').trim()
      const k = String(v?.appKey || '').trim()
      if (u && k) out[slug.toLowerCase()] = { username: u, appKey: k }
    }
    return out
  } catch {
    return {}
  }
}

let _cachedJson: Record<string, EzetapCredentials> | null = null

function credentialsMap(): Record<string, EzetapCredentials> {
  if (_cachedJson === null) _cachedJson = parseCredentialsJson()
  return _cachedJson
}

export function getEzetapApiBaseUrl(): string {
  const u = process.env.EZETAP_API_BASE_URL?.trim()
  return u || 'https://demo.ezetap.com'
}

export function listConfiguredEzetapSlugs(): string[] {
  const map = credentialsMap()
  const fromJson = Object.keys(map).sort()
  if (fromJson.length > 0) return fromJson

  const fallbackUser = process.env.EZETAP_USERNAME?.trim()
  const fallbackKey = process.env.EZETAP_APP_KEY?.trim()
  const defSlug =
    process.env.EZETAP_DEFAULT_MERCHANT_SLUG?.trim().toLowerCase() || 'newscenaric'
  if (fallbackUser && fallbackKey) return [defSlug]
  return []
}

export function getEzetapCredentials(slug: string): EzetapCredentials {
  const normalized = slug.toLowerCase().trim()
  const map = credentialsMap()
  const fromMap = map[normalized]
  if (fromMap) return fromMap

  const fallbackUser = process.env.EZETAP_USERNAME?.trim()
  const fallbackKey = process.env.EZETAP_APP_KEY?.trim()
  const defSlug =
    process.env.EZETAP_DEFAULT_MERCHANT_SLUG?.trim().toLowerCase() || 'newscenaric'
  if (normalized === defSlug && fallbackUser && fallbackKey) {
    return { username: fallbackUser, appKey: fallbackKey }
  }

  throw new Error(
    `Ezetap credentials not configured for merchant_slug "${slug}". Set EZETAP_MERCHANT_CREDENTIALS_JSON or EZETAP_USERNAME + EZETAP_APP_KEY for the default slug.`
  )
}

export function isEzetapSlugConfigured(slug: string): boolean {
  try {
    getEzetapCredentials(slug)
    return true
  } catch {
    return false
  }
}
