import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * GST handling for scheme-based charges.
 *
 * GST is applied ONLY when the matched scheme slab has `gst_inclusive = true`
 * (i.e. the parent user configured the slab "with GST"). Slabs with
 * `gst_inclusive = false` are charged at the base rate with no GST.
 */
export const GST_PERCENT = 18

export interface GstResult {
  gstAmount: number
  totalCharge: number
  gstPercent: number
}

/**
 * Compute GST on a base charge based on whether the slab is GST-inclusive.
 * When gstInclusive is false, no GST is added and the total equals the base.
 */
export function computeGst(baseCharge: number, gstInclusive: boolean): GstResult {
  if (!gstInclusive) {
    return { gstAmount: 0, totalCharge: Math.round(baseCharge * 100) / 100, gstPercent: 0 }
  }
  const gstAmount = Math.round((baseCharge * GST_PERCENT) / 100 * 100) / 100
  const totalCharge = Math.round((baseCharge + gstAmount) * 100) / 100
  return { gstAmount, totalCharge, gstPercent: GST_PERCENT }
}

/**
 * Read the `gst_inclusive` flag of the BBPS slab that applies to the given
 * scheme + amount + category. Returns false when no slab matches.
 */
export async function getBbpsSlabGstInclusive(
  supabase: SupabaseClient,
  schemeId: string,
  amount: number,
  category: string
): Promise<boolean> {
  try {
    const { data: slabs } = await (supabase as any)
      .from('scheme_bbps_commissions')
      .select('category, gst_inclusive')
      .eq('scheme_id', schemeId)
      .eq('status', 'active')
      .lte('min_amount', amount)
      .gte('max_amount', amount)
      .order('min_amount', { ascending: false })

    if (!slabs?.length) return false
    const best = slabs.find((s: any) => {
      const sc = s.category
      return !sc || sc === '' || sc.toLowerCase() === 'all' || sc.toLowerCase() === 'all categories' || sc === category
    }) || slabs[0]
    return !!best?.gst_inclusive
  } catch (e) {
    console.warn('[scheme-gst] BBPS gst_inclusive lookup failed:', e)
    return false
  }
}

/**
 * Read the `gst_inclusive` flag of the Shadval (Settlement-2) slab that applies
 * to the given scheme(s) + amount + transfer mode. Returns false when none match.
 */
export async function getShadvalSlabGstInclusive(
  supabase: SupabaseClient,
  schemeIds: string | string[],
  amount: number,
  mode: string
): Promise<boolean> {
  try {
    const ids = Array.isArray(schemeIds) ? schemeIds : [schemeIds]
    if (ids.length === 0) return false
    const { data: slabs } = await (supabase as any)
      .from('scheme_shadval_settlement_charges')
      .select('gst_inclusive')
      .in('scheme_id', ids)
      .eq('status', 'active')
      .eq('transfer_mode', mode)
      .lte('min_amount', amount)
      .gte('max_amount', amount)
      .order('min_amount', { ascending: false })
      .limit(1)

    if (!slabs?.length) return false
    return !!slabs[0]?.gst_inclusive
  } catch (e) {
    console.warn('[scheme-gst] Shadval gst_inclusive lookup failed:', e)
    return false
  }
}
