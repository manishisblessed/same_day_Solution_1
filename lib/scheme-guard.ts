/**
 * Centralized guard for scheme (pricing) enforcement.
 *
 * FINANCIAL SAFETY: A user must have a pricing scheme resolved before any
 * charge-based transaction (BBPS, Pay2New, Rechargekit, Payout, Settlement-2)
 * is allowed. Without a scheme, charges resolve to ₹0 and the transaction would
 * effectively be FREE — a direct revenue loss. All such routes must block the
 * transaction with SCHEME_NOT_ASSIGNED instead of falling back to a free/₹0 charge.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export const SCHEME_SLAB_REQUIRED_MESSAGE =
  'The scheme with this slab is not assigned. Please connect with the support team.'

export const SCHEME_NOT_ASSIGNED = {
  success: false,
  error: SCHEME_SLAB_REQUIRED_MESSAGE,
  code: 'SCHEME_NOT_ASSIGNED',
} as const

export const SCHEME_NOT_ASSIGNED_STATUS = 403

/**
 * Returned when a scheme IS assigned but has no pricing slab covering the
 * requested transaction (amount / mode / category). Without a covering slab the
 * charge would resolve to ₹0 (a free transaction) — so the request must be
 * refused, exactly like an unassigned scheme.
 */
export const SCHEME_NO_VALID_SLAB = {
  success: false,
  error: SCHEME_SLAB_REQUIRED_MESSAGE,
  code: 'SCHEME_NO_VALID_SLAB',
} as const

const isWildcardCategory = (c: unknown): boolean => {
  const sc = (c == null ? '' : String(c)).trim().toLowerCase()
  return sc === '' || sc === 'all' || sc === 'all categories'
}

/**
 * True when the given scheme has an active BBPS/Pay2New/RechargeKit slab that
 * covers `amount` for `category` (exact category match or a wildcard slab).
 */
export async function hasCoveringBbpsSlab(
  supabase: SupabaseClient,
  schemeId: string,
  amount: number,
  category: string | null
): Promise<boolean> {
  const { data, error } = await supabase
    .from('scheme_bbps_commissions')
    .select('category')
    .eq('scheme_id', schemeId)
    .eq('status', 'active')
    .lte('min_amount', amount)
    .gte('max_amount', amount)
  if (error) {
    console.error('[scheme-guard] hasCoveringBbpsSlab error:', error.message)
    return false
  }
  return (data || []).some((s: any) => isWildcardCategory(s.category) || (category != null && s.category === category))
}

/**
 * True when the given scheme has an active Shadval settlement slab covering
 * `amount` for `transferMode` (IMPS / RTGS).
 */
export async function hasCoveringShadvalSlab(
  supabase: SupabaseClient,
  schemeId: string,
  amount: number,
  transferMode: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('scheme_shadval_settlement_charges')
    .select('id')
    .eq('scheme_id', schemeId)
    .eq('status', 'active')
    .eq('transfer_mode', transferMode)
    .lte('min_amount', amount)
    .gte('max_amount', amount)
    .limit(1)
  if (error) {
    console.error('[scheme-guard] hasCoveringShadvalSlab error:', error.message)
    return false
  }
  return (data || []).length > 0
}

/**
 * True when the given scheme has an active payout slab covering `amount` for
 * `transferMode` (IMPS / NEFT / RTGS).
 */
export async function hasCoveringPayoutSlab(
  supabase: SupabaseClient,
  schemeId: string,
  amount: number,
  transferMode: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('scheme_payout_charges')
    .select('transfer_mode')
    .eq('scheme_id', schemeId)
    .eq('status', 'active')
    .lte('min_amount', amount)
    .gte('max_amount', amount)
  if (error) {
    console.error('[scheme-guard] hasCoveringPayoutSlab error:', error.message)
    return false
  }
  return (data || []).some((s: any) => String(s.transfer_mode).toUpperCase() === String(transferMode).toUpperCase())
}
