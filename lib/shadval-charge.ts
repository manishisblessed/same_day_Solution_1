import type { SupabaseClient } from '@supabase/supabase-js'

export interface ShadvalChargeResolution {
  baseCharge: number
  schemeId: string | null
  schemeName: string | null
}

const calcCharge = (amount: number, value: number, type: string) =>
  type === 'percentage' ? Math.round((amount * value) / 100 * 100) / 100 : value

/**
 * Resolve the base Settlement-2 (Shadval) charge for a partner.
 *
 * `resolve_scheme_for_user` only returns the single highest-priority scheme
 * mapped to the partner, which is often a BBPS/"all"-scope scheme that has no
 * settlement slab. So when that scheme yields nothing, we look at EVERY scheme
 * the partner is actually mapped to and pick the one that has a matching slab.
 * Lookups stay scoped to the partner's own mappings so a partner can never pick
 * up another scheme's pricing.
 */
export async function resolveShadvalCharge(
  supabase: SupabaseClient,
  partnerId: string,
  amount: number,
  mode: string
): Promise<ShadvalChargeResolution> {
  let baseCharge = 0
  let schemeId: string | null = null
  let schemeName: string | null = null

  // 1. Primary: RPC resolves the partner's top-priority scheme, then price it.
  try {
    const { data: schemeResult, error: schemeError } = await (supabase as any).rpc('resolve_scheme_for_user', {
      p_user_id: partnerId,
      p_user_role: 'partner',
      p_service_type: 'shadval_settlement',
      p_distributor_id: null,
      p_md_id: null,
    })

    if (schemeError) {
      console.error('[Shadval Charge] Scheme RPC error:', schemeError)
    } else if (schemeResult && schemeResult.length > 0) {
      schemeId = schemeResult[0].scheme_id
      schemeName = schemeResult[0].scheme_name

      const { data: chargeResult, error: chargeError } = await (supabase as any).rpc(
        'calculate_shadval_settlement_charge_from_scheme',
        { p_scheme_id: schemeId, p_amount: amount, p_transfer_mode: mode }
      )
      if (chargeError) {
        console.error('[Shadval Charge] Charge calc error:', chargeError)
      } else if (chargeResult && chargeResult.length > 0) {
        baseCharge = parseFloat(chargeResult[0].retailer_charge) || 0
      }
    }
  } catch (e) {
    console.error('[Shadval Charge] Scheme resolution error:', e)
  }

  // 2. The top-priority scheme has no settlement slab (e.g. it's a BBPS scheme).
  //    Search across ALL schemes the partner is mapped to for a matching slab.
  if (baseCharge === 0) {
    try {
      const { data: mappings } = await supabase
        .from('scheme_mappings')
        .select('scheme_id, service_type, status')
        .eq('entity_id', partnerId)
        .eq('entity_role', 'partner')
        .eq('status', 'active')

      const schemeIds = (mappings || [])
        .filter((m: any) => !m.service_type || m.service_type === 'all' || m.service_type === 'shadval_settlement')
        .map((m: any) => m.scheme_id)

      if (schemeIds.length > 0) {
        const { data: slabs } = await supabase
          .from('scheme_shadval_settlement_charges')
          .select('*')
          .in('scheme_id', schemeIds)
          .eq('status', 'active')
          .eq('transfer_mode', mode)
          .lte('min_amount', amount)
          .gte('max_amount', amount)
          .order('min_amount', { ascending: false })
          .limit(1)

        if (slabs && slabs.length > 0) {
          const s = slabs[0] as any
          baseCharge = calcCharge(amount, parseFloat(s.retailer_charge) || 0, s.retailer_charge_type)
          schemeId = s.scheme_id
        }
      }
    } catch (e) {
      console.error('[Shadval Charge] Mapping-scoped charge query error:', e)
    }
  }

  return { baseCharge, schemeId, schemeName }
}

/**
 * Slab limits across every scheme the partner is mapped to, for a given mode.
 * Returns null when no slabs are configured (i.e. limits should not be enforced).
 */
export async function getShadvalSlabLimits(
  supabase: SupabaseClient,
  partnerId: string,
  mode: string
): Promise<{ min: number; max: number; rows: Array<{ min_amount: any; max_amount: any }> } | null> {
  try {
    const { data: mappings } = await supabase
      .from('scheme_mappings')
      .select('scheme_id, service_type, status')
      .eq('entity_id', partnerId)
      .eq('entity_role', 'partner')
      .eq('status', 'active')

    const schemeIds = (mappings || [])
      .filter((m: any) => !m.service_type || m.service_type === 'all' || m.service_type === 'shadval_settlement')
      .map((m: any) => m.scheme_id)

    if (schemeIds.length === 0) return null

    const { data: slabRows } = await supabase
      .from('scheme_shadval_settlement_charges')
      .select('min_amount, max_amount')
      .in('scheme_id', schemeIds)
      .eq('status', 'active')
      .eq('transfer_mode', mode)

    if (!slabRows || slabRows.length === 0) return null

    const min = Math.min(...slabRows.map((s: any) => parseFloat(String(s.min_amount))))
    const max = Math.max(...slabRows.map((s: any) => parseFloat(String(s.max_amount))))
    return { min, max, rows: slabRows }
  } catch (e) {
    console.warn('[Shadval Charge] Slab limit lookup failed:', e)
    return null
  }
}
