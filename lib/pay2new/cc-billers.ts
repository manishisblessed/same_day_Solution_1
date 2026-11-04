/**
 * Pay2New CC Billers — DB-driven allowlist helpers.
 *
 * The `pay2new_cc_billers` table is the single source of truth for which
 * credit-card banks are visible to users. Admin seeds + toggles via
 * GET/POST /api/admin/pay2new-banks.
 *
 * Fall-back contract: if the table is empty (not yet seeded by admin),
 * the caller receives `null` and should fall back to the legacy hardcoded
 * blocklist so nothing breaks on first deploy.
 */

import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export interface CcBillerRow {
  product_code: string
  product_name: string
  service_id: string
  enabled: boolean
  updated_by: string | null
  updated_at: string | null
}

/**
 * Returns the set of enabled product_codes.
 * Returns `null` when the table has no rows yet (admin hasn't seeded).
 */
export async function getEnabledCcBillerCodes(): Promise<Set<string> | null> {
  try {
    const supabase = getSupabaseAdmin()

    // Count total rows — distinguishes "table empty" from "all disabled".
    const { count, error: countErr } = await supabase
      .from('pay2new_cc_billers')
      .select('*', { count: 'exact', head: true })

    if (countErr || !count) return null // table empty → fall back to old blocklist

    const { data, error } = await supabase
      .from('pay2new_cc_billers')
      .select('product_code')
      .eq('enabled', true)

    if (error) return null
    return new Set((data || []).map((r: any) => r.product_code))
  } catch {
    return null
  }
}

/**
 * Returns ALL billers from the DB (enabled + disabled).
 * Used by the admin management page.
 */
export async function getAllCcBillers(): Promise<CcBillerRow[]> {
  const supabase = getSupabaseAdmin()
  const { data, error } = await supabase
    .from('pay2new_cc_billers')
    .select('product_code, product_name, service_id, enabled, updated_by, updated_at')
    .order('product_name', { ascending: true })

  if (error) throw new Error(error.message)
  return (data || []) as CcBillerRow[]
}
