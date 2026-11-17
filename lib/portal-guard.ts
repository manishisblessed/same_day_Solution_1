import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

let _cachedMasterSwitch: { value: boolean; fetchedAt: number } | null = null
const CACHE_TTL_MS = 5_000 // 5s cache to avoid hammering DB on every request

/**
 * Returns true if the portal master switch is ON.
 * Caches for 5s to keep latency low on hot paths.
 */
export async function isPortalOnline(): Promise<boolean> {
  const now = Date.now()
  if (_cachedMasterSwitch && now - _cachedMasterSwitch.fetchedAt < CACHE_TTL_MS) {
    return _cachedMasterSwitch.value
  }

  try {
    const supabase = getSupabaseAdmin()
    const { data } = await supabase
      .from('portal_settings')
      .select('enabled')
      .eq('service_key', '__master__')
      .maybeSingle()

    const isOn = data ? data.enabled !== false : true // default ON if no row
    _cachedMasterSwitch = { value: isOn, fetchedAt: now }
    return isOn
  } catch (err) {
    console.error('[portal-guard] Failed to check master switch:', err)
    // Fail-open: if we can't read the setting, allow traffic
    return true
  }
}

/**
 * Returns true if a specific service is enabled in portal_settings.
 * Also checks the master switch — if master is OFF, everything is OFF.
 */
export async function isServiceEnabled(serviceKey: string): Promise<boolean> {
  const masterOn = await isPortalOnline()
  if (!masterOn) return false

  try {
    const supabase = getSupabaseAdmin()
    const { data } = await supabase
      .from('portal_settings')
      .select('enabled')
      .eq('service_key', serviceKey)
      .maybeSingle()

    return data ? data.enabled !== false : true // default ON if no row
  } catch (err) {
    console.error(`[portal-guard] Failed to check service ${serviceKey}:`, err)
    return true
  }
}

/** Standard JSON error body when portal is offline */
export const PORTAL_OFFLINE_RESPONSE = {
  success: false,
  error: 'Portal is currently offline for maintenance. Please try again later.',
  code: 'PORTAL_OFFLINE',
} as const

/** Standard JSON error body when a specific service is disabled */
export function serviceDisabledResponse(serviceKey: string) {
  return {
    success: false,
    error: `This service is currently disabled by the administrator. Please try again later.`,
    code: 'SERVICE_DISABLED',
    service: serviceKey,
  } as const
}

/**
 * Clears the cached master switch value.
 * Call this after toggling the master switch so the change takes effect immediately.
 */
export function invalidatePortalCache() {
  _cachedMasterSwitch = null
}
