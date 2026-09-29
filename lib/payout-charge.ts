import type { SupabaseClient } from '@supabase/supabase-js'

export interface PayoutChargeResolution {
  baseCharge: number
  schemeId: string | null
  schemeName: string | null
}

const calcCharge = (amount: number, value: number, type: string) =>
  type === 'percentage' ? Math.round((amount * value) / 100 * 100) / 100 : value

/**
 * Resolve the base payout charge for a partner.
 *
 * Mirrors `resolveShadvalCharge`: `resolve_scheme_for_user` only returns the
 * single highest-priority scheme mapped to the partner, which is often a
 * BBPS/"all"-scope scheme with no payout slab. When that yields nothing we look
 * at EVERY scheme the partner is mapped to and pick one with a matching payout
 * slab. Lookups stay scoped to the partner's own mappings so a partner can never
 * pick up another scheme's pricing.
 */
export async function resolvePartnerPayoutCharge(
  supabase: SupabaseClient,
  partnerId: string,
  amount: number,
  mode: string
): Promise<PayoutChargeResolution> {
  let baseCharge = 0
  let schemeId: string | null = null
  let schemeName: string | null = null

  // 1. Primary: RPC resolves the partner's top-priority scheme, then price it.
  try {
    const { data: schemeResult, error: schemeError } = await (supabase as any).rpc('resolve_scheme_for_user', {
      p_user_id: partnerId,
      p_user_role: 'partner',
      p_service_type: 'payout',
      p_distributor_id: null,
      p_md_id: null,
    })

    if (schemeError) {
      console.error('[Payout Charge] Scheme RPC error:', schemeError)
    } else if (schemeResult && schemeResult.length > 0) {
      schemeId = schemeResult[0].scheme_id
      schemeName = schemeResult[0].scheme_name

      const { data: chargeResult, error: chargeError } = await (supabase as any).rpc(
        'calculate_payout_charge_from_scheme',
        { p_scheme_id: schemeId, p_amount: amount, p_transfer_mode: mode }
      )
      if (chargeError) {
        console.error('[Payout Charge] Charge calc error:', chargeError)
      } else if (chargeResult && chargeResult.length > 0) {
        baseCharge = parseFloat(chargeResult[0].retailer_charge) || 0
      }
    }
  } catch (e) {
    console.error('[Payout Charge] Scheme resolution error:', e)
  }

  // 2. Top-priority scheme has no payout slab: search every scheme the partner is
  //    mapped to for a matching slab.
  if (baseCharge === 0) {
    try {
      const { data: mappings } = await supabase
        .from('scheme_mappings')
        .select('scheme_id, service_type, status')
        .eq('entity_id', partnerId)
        .eq('entity_role', 'partner')
        .eq('status', 'active')

      const schemeIds = (mappings || [])
        .filter((m: any) => !m.service_type || m.service_type === 'all' || m.service_type === 'payout')
        .map((m: any) => m.scheme_id)

      if (schemeIds.length > 0) {
        const { data: slabs } = await supabase
          .from('scheme_payout_charges')
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
          const rtPc = parseFloat(s.rt_purchase_charge) || 0
          const rawRc = parseFloat(s.retailer_charge) || 0
          const effCharge = rtPc > 0 ? rtPc : rawRc
          const effType = rtPc > 0 ? (s.rt_purchase_charge_type || 'flat') : (s.retailer_charge_type || 'flat')
          baseCharge = calcCharge(amount, effCharge, effType)
          schemeId = s.scheme_id
        }
      }
    } catch (e) {
      console.error('[Payout Charge] Mapping-scoped charge query error:', e)
    }
  }

  return { baseCharge, schemeId, schemeName }
}

/**
 * True when the partner has any covering payout slab (across mapped schemes) for
 * this amount + mode. Used as the financial-safety gate before a transfer.
 */
export async function partnerHasCoveringPayoutSlab(
  supabase: SupabaseClient,
  partnerId: string,
  amount: number,
  mode: string
): Promise<boolean> {
  try {
    const { data: mappings } = await supabase
      .from('scheme_mappings')
      .select('scheme_id, service_type, status')
      .eq('entity_id', partnerId)
      .eq('entity_role', 'partner')
      .eq('status', 'active')

    const schemeIds = (mappings || [])
      .filter((m: any) => !m.service_type || m.service_type === 'all' || m.service_type === 'payout')
      .map((m: any) => m.scheme_id)

    if (schemeIds.length === 0) return false

    const { data: slabs } = await supabase
      .from('scheme_payout_charges')
      .select('id')
      .in('scheme_id', schemeIds)
      .eq('status', 'active')
      .eq('transfer_mode', mode)
      .lte('min_amount', amount)
      .gte('max_amount', amount)
      .limit(1)

    return !!(slabs && slabs.length > 0)
  } catch (e) {
    console.warn('[Payout Charge] Slab check failed:', e)
    return false
  }
}
