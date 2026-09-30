/**
 * Configurable Pay2New / Credit Card transaction limits.
 *
 * Replaces the old hardcoded ₹2,00,000 ceiling with admin-controlled values:
 *  - GLOBAL cap (application flow, retailers & partners in the portal) lives in
 *    portal_settings under `pay2new_app_max_amount` (Admin → Settings → Limits).
 *  - PER-PARTNER cap (Partner API flow) lives in partners.api_max_txn_amount and
 *    overrides the global cap. NULL/0 → fall back to the global value.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const PAY2NEW_MAX_SETTING_KEY = 'pay2new_app_max_amount'

/** Fallback ceiling used when no setting row exists yet. */
export const PAY2NEW_DEFAULT_MAX = 200000

/** Read the global Pay2New/CC max transaction amount from portal_settings. */
export async function getGlobalPay2newMax(supabase: SupabaseClient): Promise<number> {
  try {
    const { data } = await supabase
      .from('portal_settings')
      .select('active_provider')
      .eq('service_key', PAY2NEW_MAX_SETTING_KEY)
      .single()
    const v = data?.active_provider ? parseInt(String(data.active_provider), 10) : PAY2NEW_DEFAULT_MAX
    return Number.isFinite(v) && v > 0 ? v : PAY2NEW_DEFAULT_MAX
  } catch {
    return PAY2NEW_DEFAULT_MAX
  }
}

/**
 * Resolve the effective max transaction amount for a Partner API request:
 * the partner-specific override when set (> 0), else the global cap.
 */
export async function getPartnerApiMax(
  supabase: SupabaseClient,
  partnerApiMax: number | null | undefined
): Promise<number> {
  const perPartner = Number(partnerApiMax)
  if (Number.isFinite(perPartner) && perPartner > 0) return perPartner
  return getGlobalPay2newMax(supabase)
}
