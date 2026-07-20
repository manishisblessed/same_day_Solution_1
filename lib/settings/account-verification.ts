import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const ACCOUNT_VERIFICATION_SETTING_KEY = 'account_verification'

const CACHE_TTL_MS = 15_000
let cached: { value: boolean; at: number } | null = null

/**
 * Whether account (penny-drop) verification is currently enabled.
 * Backed by portal_settings.enabled for service_key='account_verification'.
 * Defaults to ENABLED when the row is missing or on any read error, so a
 * transient DB issue never silently blocks the feature.
 * Result is cached briefly to avoid a DB hit on every verification request.
 */
export async function isAccountVerificationEnabled(): Promise<boolean> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value
  }

  try {
    const supabase = getSupabaseAdmin()
    const { data } = await supabase
      .from('portal_settings')
      .select('enabled')
      .eq('service_key', ACCOUNT_VERIFICATION_SETTING_KEY)
      .maybeSingle()

    const value = data ? data.enabled !== false : true
    cached = { value, at: Date.now() }
    return value
  } catch {
    return true
  }
}

/** Invalidate the in-memory cache after an admin toggles the setting. */
export function clearAccountVerificationCache(): void {
  cached = null
}

export const ACCOUNT_VERIFICATION_DISABLED_MESSAGE =
  'Account verification is temporarily unavailable. Please try again later. No charge has been applied.'
