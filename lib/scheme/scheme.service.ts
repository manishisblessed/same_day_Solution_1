/**
 * Comprehensive Scheme Management Service
 * 
 * Handles: CRUD for schemes, BBPS commissions, Payout charges, MDR rates, Mappings
 * Resolves: Which scheme applies to a given user for a given service
 * Calculates: Charges/commissions based on resolved scheme
 */

import { createClient } from '@supabase/supabase-js';
import { getSupabaseUrl, getSupabaseServiceKey } from '@/lib/env';
import { findApprovedBrandRate } from '@/lib/brand/mdr';
import { resolveServiceVendorRate, toAbsolute, exGstValue, type ServiceKind, type RateType } from '@/lib/service-vendor/rates';
import { resolveCompanyFloor, type FloorServiceKind } from '@/lib/service-vendor/floor';

/** Representative amount for slab-level (percent/flat) floor checks. */
function repAmountFor(min_amount?: number, max_amount?: number): number {
  if (max_amount != null && max_amount > 0 && max_amount < 999999999) return max_amount;
  if (min_amount != null && min_amount > 0) return min_amount;
  return 1000;
}

const chargeTypeToRate = (t?: string): RateType => (String(t).toLowerCase() === 'percentage' ? 'PERCENT' : 'FLAT');
const rateTypeToCharge = (t: RateType): string => (t === 'PERCENT' ? 'percentage' : 'flat');

/**
 * Resolve the authoritative service vendor cost + minimum for a BBPS/PAYOUT
 * slab and apply it: enforces the customer charge is not below the central
 * minimum (and platform floor), and derives the company cost basis
 * (company_charge/_type) from the EX-GST vendor cost so revenue =
 * customer charge − vendor cost. Returns an error string, or a patch to merge.
 * Returns {} (no-op) when no central rate exists (back-compat).
 */
async function applyServiceVendorFloor(params: {
  serviceKind: ServiceKind;
  scopeKey: string | null;
  category: string | null;
  retailer_charge: number;
  retailer_charge_type: string;
  md_purchase_charge?: number;
  md_purchase_charge_type?: string;
  dt_purchase_charge?: number;
  rt_purchase_charge?: number;
  min_amount?: number;
  max_amount?: number;
}): Promise<{ error?: string; patch?: Record<string, any> }> {
  try {
    const rep = repAmountFor(params.min_amount, params.max_amount);
    const resolved = await resolveServiceVendorRate({
      serviceKind: params.serviceKind,
      scopeKey: params.scopeKey,
      category: params.category,
      amount: rep,
    });

    const retailerAbs = toAbsolute(Number(params.retailer_charge) || 0, chargeTypeToRate(params.retailer_charge_type), rep);

    // Platform floor (optional, lowest guardrail).
    const floorAbs = await resolveCompanyFloor({
      serviceKind: params.serviceKind as FloorServiceKind,
      scopeKey: params.scopeKey,
      amount: rep,
    });
    if (floorAbs > 0 && retailerAbs - floorAbs < -1e-9) {
      return { error: `Customer charge (₹${retailerAbs.toFixed(2)} at ₹${rep}) is below the platform floor (₹${floorAbs.toFixed(2)}) for ${params.serviceKind}.` };
    }

    if (!resolved) return {}; // no central vendor card → keep supplied values

    // For the charge-based model (md_purchase_charge is set), retailer_charge is
    // not set by the admin — it flows from the hierarchy. Skip the retailer-level
    // check; the md_purchase_charge check below enforces the company's floor.
    // Also treat DT/RT-created slabs (dt_purchase_charge or rt_purchase_charge set) as charge-based.
    const isChargeModel = (params.md_purchase_charge != null && Number(params.md_purchase_charge) > 0)
      || (params.dt_purchase_charge != null && Number(params.dt_purchase_charge) > 0)
      || (params.rt_purchase_charge != null && Number(params.rt_purchase_charge) > 0);

    if (!isChargeModel && resolved.minCharge > 0 && retailerAbs - resolved.minCharge < -1e-9) {
      return { error: `Customer charge (₹${retailerAbs.toFixed(2)} at ₹${rep}) is below the ${params.serviceKind} minimum (₹${resolved.minCharge.toFixed(2)}). Raise it so the company never books a loss.` };
    }

    // Hierarchy floor: schemes cascade admin→MD→DT→RT, each level re-pricing for
    // its child. The company's realized tier is md_purchase_charge (company
    // margin = md_purchase_charge − vendor cost). Enforcing md_purchase_charge ≥
    // the central MINIMUM guarantees the company's margin is locked in BEFORE the
    // downline stacks its own margins on top; the monotonic cascade
    // (md ≤ dt ≤ rt ≤ customer) then carries the floor through every tier.
    // Falls back to the ex-GST vendor cost when no explicit minimum is set.
    if (params.md_purchase_charge != null && Number(params.md_purchase_charge) > 0) {
      const mdAbs = toAbsolute(Number(params.md_purchase_charge), chargeTypeToRate(params.md_purchase_charge_type), rep);
      const companyTierFloor = resolved.minCharge > 0 ? resolved.minCharge : resolved.vendorCostExGst;
      if (mdAbs - companyTierFloor < -1e-9) {
        const label = resolved.minCharge > 0 ? 'minimum' : 'ex-GST vendor cost';
        return { error: `MD purchase charge (₹${mdAbs.toFixed(2)} at ₹${rep}) is below the ${params.serviceKind} ${label} (₹${companyTierFloor.toFixed(2)}). The company's guaranteed margin would be lost before it cascades through the hierarchy.` };
      }
    }

    // Derive the company cost basis from the ex-GST vendor cost. The charge
    // model books company revenue = md_purchase_charge − company_charge, so
    // company_charge must equal the ex-GST vendor cost.
    const exGstVendorRaw = exGstValue(resolved.vendor_rate, resolved.gst_inclusive);
    return {
      patch: {
        company_charge: Number(exGstVendorRaw.toFixed(4)),
        company_charge_type: rateTypeToCharge(resolved.vendor_rate_type),
        vendor_rate: Number(resolved.vendor_rate.toFixed(4)),
        company_mdr_rate: Number(exGstVendorRaw.toFixed(4)),
        gst_inclusive: resolved.gst_inclusive,
      },
    };
  } catch (e) {
    console.error('[applyServiceVendorFloor] failed:', (e as any)?.message);
    return {}; // non-fatal
  }
}
import type {
  Scheme,
  SchemeBBPSCommission,
  SchemePayoutCharge,
  SchemeMDRRate,
  SchemeMapping,
  ResolvedScheme,
  ChargeBreakdown,
  CreateSchemeInput,
  CreateBBPSCommissionInput,
  CreatePayoutChargeInput,
  CreateMDRRateInput,
  CreateSchemeMappingInput,
  CreateAEPSCommissionInput,
  CreateAEPSSettlementChargeInput,
  CreateShadvalSettlementChargeInput,
  SchemeAEPSCommission,
  SchemeAEPSSettlementCharge,
  SchemeShadvalSettlementCharge,
  ServiceScope,
} from '@/types/scheme.types';

// ============================================================================
// HELPER: Get admin Supabase client
// ============================================================================

let _supabaseClient: ReturnType<typeof createClient> | null = null;

function getSupabase() {
  if (_supabaseClient) return _supabaseClient;
  _supabaseClient = createClient(getSupabaseUrl(), getSupabaseServiceKey());
  return _supabaseClient;
}

// ============================================================================
// SCHEME CRUD
// ============================================================================

export async function getSchemes(filters?: {
  scheme_type?: string;
  service_scope?: string;
  status?: string;
  created_by_id?: string;
}): Promise<{ data: Scheme[]; error: string | null }> {
  const supabase = getSupabase();
  let query = supabase.from('schemes').select('*').order('priority', { ascending: true });

  if (filters?.scheme_type) query = query.eq('scheme_type', filters.scheme_type);
  if (filters?.service_scope) query = query.eq('service_scope', filters.service_scope);
  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.created_by_id) query = query.eq('created_by_id', filters.created_by_id);

  const { data, error } = await query;
  return { data: data || [], error: error?.message || null };
}

export async function getSchemeById(id: string): Promise<{ data: Scheme | null; error: string | null }> {
  const supabase = getSupabase();
  
  // Get scheme with all related config
  const { data: scheme, error } = await supabase
    .from('schemes')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !scheme) return { data: null, error: error?.message || 'Scheme not found' };

  // Fetch related configs in parallel
  const [bbps, payout, mdr, aeps, aepsSettle, shadvalSettle, mappings] = await Promise.all([
    supabase.from('scheme_bbps_commissions').select('*').eq('scheme_id', id).order('min_amount'),
    supabase.from('scheme_payout_charges').select('*').eq('scheme_id', id).order('transfer_mode'),
    supabase.from('scheme_mdr_rates').select('*').eq('scheme_id', id).order('mode'),
    supabase.from('scheme_aeps_commissions').select('*').eq('scheme_id', id).order('transaction_type').order('min_amount'),
    supabase.from('scheme_aeps_settlement_charges').select('*').eq('scheme_id', id).order('min_amount'),
    supabase.from('scheme_shadval_settlement_charges').select('*').eq('scheme_id', id).order('transfer_mode').order('min_amount'),
    supabase.from('scheme_mappings').select('*').eq('scheme_id', id).eq('status', 'active'),
  ]);

  return {
    data: {
      ...scheme,
      bbps_commissions: bbps.data || [],
      payout_charges: payout.data || [],
      mdr_rates: mdr.data || [],
      aeps_commissions: aeps.data || [],
      aeps_settlement_charges: aepsSettle.data || [],
      shadval_settlement_charges: shadvalSettle.data || [],
      mappings: mappings.data || [],
      mapping_count: mappings.data?.length || 0,
    },
    error: null,
  };
}

export async function createScheme(
  input: CreateSchemeInput,
  createdById?: string,
  createdByRole?: string
): Promise<{ data: Scheme | null; error: string | null }> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('schemes')
    .insert({
      name: input.name,
      description: input.description || null,
      scheme_type: input.scheme_type,
      service_scope: input.service_scope,
      priority: input.priority || (input.scheme_type === 'global' ? 1000 : input.scheme_type === 'golden' ? 500 : 100),
      effective_from: input.effective_from || new Date().toISOString(),
      effective_to: input.effective_to || null,
      metadata: input.metadata || null,
      is_partner_plan: input.is_partner_plan ?? false,
      created_by_id: createdById || null,
      created_by_role: createdByRole || null,
      status: 'active',
    })
    .select()
    .single();

  return { data: data || null, error: error?.message || null };
}

export async function updateScheme(
  id: string,
  updates: Partial<CreateSchemeInput> & { status?: string }
): Promise<{ success: boolean; error: string | null }> {
  const supabase = getSupabase();
  const { error } = await supabase.from('schemes').update(updates).eq('id', id);
  return { success: !error, error: error?.message || null };
}

export async function deleteScheme(id: string): Promise<{ success: boolean; error: string | null }> {
  const supabase = getSupabase();
  // Cascade delete handles related records
  const { error } = await supabase.from('schemes').delete().eq('id', id);
  return { success: !error, error: error?.message || null };
}

// ============================================================================
// BBPS COMMISSION CRUD
// ============================================================================

export async function getBBPSCommissions(schemeId: string): Promise<SchemeBBPSCommission[]> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('scheme_bbps_commissions')
    .select('*')
    .eq('scheme_id', schemeId)
    .order('min_amount');
  return data || [];
}

export async function upsertBBPSCommission(
  input: CreateBBPSCommissionInput
): Promise<{ data: SchemeBBPSCommission | null; error: string | null }> {
  const supabase = getSupabase();

  // Authoritative central vendor cost + minimum (BBPS). Enforces the floor and
  // derives the company cost basis (ex-GST) so revenue = charge − vendor cost.
  const floor = await applyServiceVendorFloor({
    serviceKind: 'BBPS',
    scopeKey: input.bbps_type || 'bbps_1',
    category: input.category || null,
    retailer_charge: input.retailer_charge,
    retailer_charge_type: input.retailer_charge_type,
    md_purchase_charge: input.md_purchase_charge,
    md_purchase_charge_type: input.md_purchase_charge_type,
    dt_purchase_charge: input.dt_purchase_charge,
    rt_purchase_charge: input.rt_purchase_charge,
    min_amount: input.min_amount,
    max_amount: input.max_amount,
  });
  if (floor.error) return { data: null, error: floor.error };
  const fp = floor.patch || {};

  const { data, error } = await supabase
    .from('scheme_bbps_commissions')
    .upsert({
      ...((input as any).id ? { id: (input as any).id } : {}),
      scheme_id: input.scheme_id,
      bbps_type: input.bbps_type || 'bbps_1',
      category: input.category || null,
      min_amount: input.min_amount,
      max_amount: input.max_amount,
      retailer_charge: input.retailer_charge,
      retailer_charge_type: input.retailer_charge_type,
      retailer_commission: input.retailer_commission || 0,
      retailer_commission_type: input.retailer_commission_type || 'flat',
      distributor_commission: input.distributor_commission || 0,
      distributor_commission_type: input.distributor_commission_type || 'flat',
      md_commission: input.md_commission || 0,
      md_commission_type: input.md_commission_type || 'flat',
      company_charge: fp.company_charge ?? input.company_charge ?? 0,
      company_charge_type: fp.company_charge_type ?? input.company_charge_type ?? 'flat',
      md_purchase_charge: input.md_purchase_charge || 0,
      md_purchase_charge_type: input.md_purchase_charge_type || 'flat',
      dt_purchase_charge: input.dt_purchase_charge || 0,
      dt_purchase_charge_type: input.dt_purchase_charge_type || 'flat',
      rt_purchase_charge: input.rt_purchase_charge || 0,
      rt_purchase_charge_type: input.rt_purchase_charge_type || 'flat',
      gst_inclusive: fp.gst_inclusive ?? input.gst_inclusive ?? false,
      vendor_rate: fp.vendor_rate ?? input.vendor_rate ?? 0,
      company_mdr_rate: fp.company_mdr_rate ?? input.company_mdr_rate ?? 0,
      status: 'active',
    })
    .select()
    .single();
  return { data: data || null, error: error?.message || null };
}

export async function deleteBBPSCommission(id: string): Promise<{ success: boolean }> {
  const supabase = getSupabase();
  const { error } = await supabase.from('scheme_bbps_commissions').delete().eq('id', id);
  return { success: !error };
}

// ============================================================================
// PAYOUT CHARGE CRUD
// ============================================================================

export async function getPayoutCharges(schemeId: string): Promise<SchemePayoutCharge[]> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('scheme_payout_charges')
    .select('*')
    .eq('scheme_id', schemeId)
    .order('transfer_mode');
  return data || [];
}

export async function upsertPayoutCharge(
  input: CreatePayoutChargeInput
): Promise<{ data: SchemePayoutCharge | null; error: string | null }> {
  const supabase = getSupabase();

  // Authoritative central vendor cost + minimum (Account Transfer / Payout).
  const floor = await applyServiceVendorFloor({
    serviceKind: 'PAYOUT',
    scopeKey: input.transfer_mode || '*',
    category: null,
    retailer_charge: input.retailer_charge,
    retailer_charge_type: input.retailer_charge_type,
    md_purchase_charge: input.md_purchase_charge,
    md_purchase_charge_type: input.md_purchase_charge_type,
    dt_purchase_charge: input.dt_purchase_charge,
    rt_purchase_charge: input.rt_purchase_charge,
    min_amount: input.min_amount,
    max_amount: input.max_amount,
  });
  if (floor.error) return { data: null, error: floor.error };
  const fp = floor.patch || {};

  const { data, error } = await supabase
    .from('scheme_payout_charges')
    .upsert({
      ...((input as any).id ? { id: (input as any).id } : {}),
      scheme_id: input.scheme_id,
      transfer_mode: input.transfer_mode,
      min_amount: input.min_amount || 0,
      max_amount: input.max_amount || 999999999,
      retailer_charge: input.retailer_charge,
      retailer_charge_type: input.retailer_charge_type,
      retailer_commission: input.retailer_commission || 0,
      retailer_commission_type: input.retailer_commission_type || 'flat',
      distributor_commission: input.distributor_commission || 0,
      distributor_commission_type: input.distributor_commission_type || 'flat',
      md_commission: input.md_commission || 0,
      md_commission_type: input.md_commission_type || 'flat',
      company_charge: fp.company_charge ?? input.company_charge ?? 0,
      company_charge_type: fp.company_charge_type ?? input.company_charge_type ?? 'flat',
      md_purchase_charge: input.md_purchase_charge || 0,
      md_purchase_charge_type: input.md_purchase_charge_type || 'flat',
      dt_purchase_charge: input.dt_purchase_charge || 0,
      dt_purchase_charge_type: input.dt_purchase_charge_type || 'flat',
      rt_purchase_charge: input.rt_purchase_charge || 0,
      rt_purchase_charge_type: input.rt_purchase_charge_type || 'flat',
      gst_inclusive: fp.gst_inclusive ?? input.gst_inclusive ?? false,
      vendor_rate: fp.vendor_rate ?? input.vendor_rate ?? 0,
      company_mdr_rate: fp.company_mdr_rate ?? input.company_mdr_rate ?? 0,
      status: 'active',
    })
    .select()
    .single();
  return { data: data || null, error: error?.message || null };
}

export async function deletePayoutCharge(id: string): Promise<{ success: boolean }> {
  const supabase = getSupabase();
  const { error } = await supabase.from('scheme_payout_charges').delete().eq('id', id);
  return { success: !error };
}

// ============================================================================
// MDR RATE CRUD
// ============================================================================

export async function getMDRRates(schemeId: string): Promise<SchemeMDRRate[]> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('scheme_mdr_rates')
    .select('*')
    .eq('scheme_id', schemeId)
    .order('mode');
  return data || [];
}

export async function upsertMDRRate(
  input: CreateMDRRateInput
): Promise<{ data: SchemeMDRRate | null; error: string | null }> {
  const supabase = getSupabase();

  // Brand rate card is the AUTHORITATIVE vendor cost + minimum floor. When the
  // slab is pinned to a brand (merchant_slug), resolve the brand's approved
  // rate and (a) enforce the scheme retailer MDR is not priced below the brand
  // minimum, and (b) lock vendor_rate / company_mdr_rate to the brand's cost so
  // per-transaction revenue (retailer_mdr − vendor cost) is exact. Falls back to
  // the supplied values when the brand has no matching rate (back-compat).
  let vendor_rate = input.vendor_rate ?? 0;
  let company_mdr_rate = input.company_mdr_rate ?? 0;
  if (input.merchant_slug) {
    try {
      const brandRate = await findApprovedBrandRate({
        merchantSlug: input.merchant_slug,
        amount: 1000, // nominal; brand resolution relaxes the band for slabs
        mode: input.mode,
        card_type: input.card_type ?? null,
        brand_type: input.brand_type ?? null,
        card_classification: input.card_classification ?? null,
      });
      if (brandRate) {
        const gstInc = !!(brandRate as any).gst_inclusive;
        const vendorT1 = Number(brandRate.mdr_value);
        const minT1 = Number(brandRate.min_mdr_value) > 0 ? Number(brandRate.min_mdr_value) : vendorT1;
        const minT0 = Number(brandRate.min_mdr_value_t0) > 0 ? Number(brandRate.min_mdr_value_t0) : minT1;

        const EPS = 1e-9;
        // Hierarchy floor. Schemes cascade admin→MD→DT→RT; the company's realized
        // tier is md_mdr (settlement books company_earning = md_mdr − company_cost).
        // Enforcing the brand MINIMUM at the company tier guarantees the company
        // margin is locked in first; the monotonic cascade (retailer ≥ distributor
        // ≥ md ≥ company_cost) then carries the floor up through every tier.
        //   - Cascade plan (md_mdr set): floor binds md_mdr.
        //   - Unified/partner plan (md_mdr = 0): company realizes the whole
        //     retailer_mdr, so the floor binds retailer_mdr.
        const isUnified = input.partner_mdr != null || !(Number(input.md_mdr_t1) > 0);
        if (isUnified) {
          if (Number(input.retailer_mdr_t1) - minT1 < -EPS) {
            return {
              data: null,
              error: `Retailer MDR T+1 (${Number(input.retailer_mdr_t1).toFixed(2)}%) is below the brand minimum (${minT1.toFixed(2)}%) for "${input.merchant_slug}". Raise it so the company never books a loss.`,
            };
          }
          if (Number(input.retailer_mdr_t0) - minT0 < -EPS) {
            return {
              data: null,
              error: `Retailer MDR T+0 (${Number(input.retailer_mdr_t0).toFixed(2)}%) is below the brand minimum (${minT0.toFixed(2)}%) for "${input.merchant_slug}".`,
            };
          }
        } else {
          if (Number(input.md_mdr_t1) - minT1 < -EPS) {
            return {
              data: null,
              error: `MD MDR T+1 (${Number(input.md_mdr_t1).toFixed(2)}%) is below the brand minimum (${minT1.toFixed(2)}%) for "${input.merchant_slug}". The company's guaranteed margin would be lost before it cascades through the hierarchy.`,
            };
          }
          const mdT0 = Number(input.md_mdr_t0) > 0 ? Number(input.md_mdr_t0) : Number(input.md_mdr_t1);
          if (mdT0 - minT0 < -EPS) {
            return {
              data: null,
              error: `MD MDR T+0 (${mdT0.toFixed(2)}%) is below the brand minimum (${minT0.toFixed(2)}%) for "${input.merchant_slug}".`,
            };
          }
        }

        // Lock the vendor cost to the brand card. `company_mdr_rate` is the
        // company COST consumed by settlement (company_earning = md_mdr −
        // company_mdr_rate), so it MUST hold the ex-GST vendor cost — NOT the
        // margin. GST on vendor cost is an input credit, so the real cost is
        // ex-GST (value/1.18 when the brand rate was entered GST-inclusive).
        vendor_rate = vendorT1; // gross vendor cost as entered (audit/display)
        company_mdr_rate = gstInc ? vendorT1 / 1.18 : vendorT1; // ex-GST cost used for revenue
      }
    } catch (e) {
      // Non-fatal: if brand resolution fails, keep the supplied vendor values.
      console.error('[upsertMDRRate] brand rate resolution failed:', (e as any)?.message);
    }
  }

  const { data, error } = await supabase
    .from('scheme_mdr_rates')
    .upsert({
      ...((input as any).id ? { id: (input as any).id } : {}),
      scheme_id: input.scheme_id,
      mode: input.mode,
      card_type: input.card_type || null,
      brand_type: input.brand_type || null,
      card_classification: input.card_classification || null,
      merchant_slug: input.merchant_slug || null,
      retailer_mdr_t1: input.retailer_mdr_t1,
      retailer_mdr_t0: input.retailer_mdr_t0,
      distributor_mdr_t1: input.distributor_mdr_t1,
      distributor_mdr_t0: input.distributor_mdr_t0,
      md_mdr_t1: input.md_mdr_t1 || 0,
      md_mdr_t0: input.md_mdr_t0 || 0,
      partner_mdr: input.partner_mdr ?? null,
      gst_inclusive: input.gst_inclusive ?? false,
      vendor_rate,
      company_mdr_rate,
      master_commission_percent: input.master_commission_percent ?? null,
      master_commission_tds_percent: input.master_commission_tds_percent ?? null,
      status: 'active',
    })
    .select()
    .single();
  return { data: data || null, error: error?.message || null };
}

export async function deleteMDRRate(id: string): Promise<{ success: boolean }> {
  const supabase = getSupabase();
  const { error } = await supabase.from('scheme_mdr_rates').delete().eq('id', id);
  return { success: !error };
}

// ============================================================================
// AEPS COMMISSION CRUD
// ============================================================================

export async function getAEPSCommissions(schemeId: string): Promise<SchemeAEPSCommission[]> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('scheme_aeps_commissions')
    .select('*')
    .eq('scheme_id', schemeId)
    .order('transaction_type')
    .order('min_amount');
  return data || [];
}

/**
 * Resolve a flat/percentage value against a representative amount.
 * For percentage, value is % of amount. For flat, value is absolute.
 */
function resolveValue(value: number, type: string, amount: number): number {
  if (type === 'percentage') return Math.round((amount * value) / 100 * 100) / 100;
  return value;
}

/**
 * Cascade guardrail: company + MD + DT + RT must not exceed the partner pool
 * (base_commission). Validated at the slab's representative amount (max_amount,
 * falling back to a nominal ₹1000 when the range is open-ended).
 *
 * Returns an error string if invalid, otherwise null.
 */
export function validateAEPSCascade(input: CreateAEPSCommissionInput): string | null {
  const repAmount = (input.max_amount && input.max_amount < 999999999)
    ? input.max_amount
    : (input.min_amount && input.min_amount > 0 ? input.min_amount : 1000);

  const base = resolveValue(input.base_commission, input.base_commission_type || 'percentage', repAmount);
  const company = resolveValue(input.company_earning || 0, input.company_earning_type || 'flat', repAmount);
  const md = resolveValue(input.md_commission || 0, input.md_commission_type || 'flat', repAmount);
  const dt = resolveValue(input.distributor_commission || 0, input.distributor_commission_type || 'flat', repAmount);
  const rt = resolveValue(input.retailer_commission || 0, input.retailer_commission_type || 'flat', repAmount);

  const distributed = Math.round((company + md + dt + rt) * 100) / 100;
  const pool = Math.round(base * 100) / 100;

  // Allow a tiny rounding tolerance
  if (distributed > pool + 0.01) {
    return `Distribution (Company ₹${company} + MD ₹${md} + DT ₹${dt} + RT ₹${rt} = ₹${distributed}) exceeds partner pool ₹${pool} at ₹${repAmount}.`;
  }

  if ((input.tds_percentage || 0) < 0 || (input.tds_percentage || 0) > 100) {
    return 'TDS percentage must be between 0 and 100.';
  }

  return null;
}

export async function upsertAEPSCommission(
  input: CreateAEPSCommissionInput
): Promise<{ data: SchemeAEPSCommission | null; error: string | null }> {
  const validationError = validateAEPSCascade(input);
  if (validationError) {
    return { data: null, error: validationError };
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('scheme_aeps_commissions')
    .upsert({
      scheme_id: input.scheme_id,
      transaction_type: input.transaction_type,
      min_amount: input.min_amount ?? 0,
      max_amount: input.max_amount ?? 999999999,
      base_commission: input.base_commission,
      base_commission_type: input.base_commission_type || 'percentage',
      company_earning: input.company_earning || 0,
      company_earning_type: input.company_earning_type || 'flat',
      md_commission: input.md_commission || 0,
      md_commission_type: input.md_commission_type || 'flat',
      distributor_commission: input.distributor_commission || 0,
      distributor_commission_type: input.distributor_commission_type || 'flat',
      retailer_commission: input.retailer_commission || 0,
      retailer_commission_type: input.retailer_commission_type || 'flat',
      tds_percentage: input.tds_percentage || 0,
      md_purchase_charge: input.md_purchase_charge || 0,
      md_purchase_charge_type: input.md_purchase_charge_type || 'flat',
      dt_purchase_charge: input.dt_purchase_charge || 0,
      dt_purchase_charge_type: input.dt_purchase_charge_type || 'flat',
      rt_purchase_charge: input.rt_purchase_charge || 0,
      rt_purchase_charge_type: input.rt_purchase_charge_type || 'flat',
      gst_inclusive: input.gst_inclusive ?? false,
      vendor_rate: input.vendor_rate ?? 0,
      company_mdr_rate: input.company_mdr_rate ?? 0,
      status: 'active',
    }, { onConflict: 'scheme_id,transaction_type,min_amount,max_amount' })
    .select()
    .single();
  return { data: data || null, error: error?.message || null };
}

export async function deleteAEPSCommission(id: string): Promise<{ success: boolean }> {
  const supabase = getSupabase();
  const { error } = await supabase.from('scheme_aeps_commissions').delete().eq('id', id);
  return { success: !error };
}

// ============================================================================
// SCHEME MAPPING CRUD
// ============================================================================

export async function getSchemeMappings(filters?: {
  scheme_id?: string;
  entity_id?: string;
  entity_role?: string;
  status?: string;
}): Promise<SchemeMapping[]> {
  const supabase = getSupabase();
  let query = supabase
    .from('scheme_mappings')
    .select('*, schemes(name, scheme_type, service_scope, status)')
    .order('priority', { ascending: true });

  if (filters?.scheme_id) query = query.eq('scheme_id', filters.scheme_id);
  if (filters?.entity_id) query = query.eq('entity_id', filters.entity_id);
  if (filters?.entity_role) query = query.eq('entity_role', filters.entity_role);
  if (filters?.status) query = query.eq('status', filters.status);

  const { data } = await query;
  return (data || []).map((m: any) => ({
    ...m,
    scheme: m.schemes || undefined,
  }));
}

export async function createSchemeMapping(
  input: CreateSchemeMappingInput,
  assignedById?: string,
  assignedByRole?: string
): Promise<{ data: SchemeMapping | null; error: string | null }> {
  const supabase = getSupabase();

  // Deactivate ALL existing active mappings for this entity (regardless of service_type)
  await supabase
    .from('scheme_mappings')
    .update({ status: 'inactive' })
    .eq('entity_id', input.entity_id)
    .eq('entity_role', input.entity_role)
    .eq('status', 'active');

  const { data, error } = await supabase
    .from('scheme_mappings')
    .insert({
      scheme_id: input.scheme_id,
      entity_id: input.entity_id,
      entity_role: input.entity_role,
      service_type: input.service_type || null,
      priority: input.priority || 100,
      effective_from: input.effective_from || new Date().toISOString(),
      effective_to: input.effective_to || null,
      assigned_by_id: assignedById || null,
      assigned_by_role: assignedByRole || null,
      status: 'active',
    })
    .select()
    .single();

  return { data: data || null, error: error?.message || null };
}

export async function deleteSchemeMapping(id: string): Promise<{ success: boolean }> {
  const supabase = getSupabase();
  const { error } = await supabase.from('scheme_mappings').update({ status: 'inactive' }).eq('id', id);
  return { success: !error };
}

// ============================================================================
// AEPS SETTLEMENT CHARGE CRUD
// ============================================================================

export async function getAEPSSettlementCharges(schemeId: string): Promise<SchemeAEPSSettlementCharge[]> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('scheme_aeps_settlement_charges')
    .select('*')
    .eq('scheme_id', schemeId)
    .order('min_amount');
  return data || [];
}

export async function upsertAEPSSettlementCharge(
  input: CreateAEPSSettlementChargeInput
): Promise<{ data: SchemeAEPSSettlementCharge | null; error: string | null }> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('scheme_aeps_settlement_charges')
    .upsert({
      scheme_id: input.scheme_id,
      min_amount: input.min_amount ?? 0,
      max_amount: input.max_amount ?? 999999999,
      retailer_charge: input.retailer_charge,
      retailer_charge_type: input.retailer_charge_type,
      distributor_commission: input.distributor_commission || 0,
      distributor_commission_type: input.distributor_commission_type || 'flat',
      md_commission: input.md_commission || 0,
      md_commission_type: input.md_commission_type || 'flat',
      company_charge: input.company_charge || 0,
      company_charge_type: input.company_charge_type || 'flat',
      md_purchase_charge: input.md_purchase_charge || 0,
      md_purchase_charge_type: input.md_purchase_charge_type || 'flat',
      dt_purchase_charge: input.dt_purchase_charge || 0,
      dt_purchase_charge_type: input.dt_purchase_charge_type || 'flat',
      rt_purchase_charge: input.rt_purchase_charge || 0,
      rt_purchase_charge_type: input.rt_purchase_charge_type || 'flat',
      gst_inclusive: input.gst_inclusive ?? false,
      vendor_rate: input.vendor_rate ?? 0,
      company_mdr_rate: input.company_mdr_rate ?? 0,
      status: 'active',
    }, { onConflict: 'scheme_id,min_amount,max_amount' })
    .select()
    .single();
  return { data: data || null, error: error?.message || null };
}

export async function deleteAEPSSettlementCharge(id: string): Promise<{ success: boolean }> {
  const supabase = getSupabase();
  const { error } = await supabase.from('scheme_aeps_settlement_charges').delete().eq('id', id);
  return { success: !error };
}

// ============================================================================
// SCHEME RESOLUTION
// ============================================================================

/**
 * Resolve which scheme applies to a user for a given service.
 * Hierarchy: retailer → distributor → master_distributor → global
 */
export async function resolveSchemeForUser(
  userId: string,
  userRole: string,
  serviceType: ServiceScope = 'all',
  distributorId?: string,
  mdId?: string
): Promise<ResolvedScheme | null> {
  const supabase = getSupabase();

  const { data, error } = await supabase.rpc('resolve_scheme_for_user', {
    p_user_id: userId,
    p_user_role: userRole,
    p_service_type: serviceType,
    p_distributor_id: distributorId || null,
    p_md_id: mdId || null,
  });

  if (error || !data || data.length === 0) {
    console.warn(`[SchemeService] No scheme resolved for ${userRole}:${userId} service:${serviceType}`);
    return null;
  }

  return data[0] as ResolvedScheme;
}

// ============================================================================
// CHARGE CALCULATION
// ============================================================================

/**
 * Calculate BBPS charge breakdown for a transaction
 */
export async function calculateBBPSCharge(
  userId: string,
  userRole: string,
  amount: number,
  category?: string,
  distributorId?: string,
  mdId?: string
): Promise<ChargeBreakdown | null> {
  // 1. Resolve scheme
  const resolved = await resolveSchemeForUser(userId, userRole, 'bbps', distributorId, mdId);
  if (!resolved) return null;

  // 2. Calculate charges via DB function
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('calculate_bbps_charge_from_scheme', {
    p_scheme_id: resolved.scheme_id,
    p_amount: amount,
    p_category: category || null,
  });

  if (error || !data || data.length === 0) {
    console.error('[SchemeService] BBPS charge calculation failed:', error);
    return null;
  }

  const row = data[0];
  const isChargeModel = (parseFloat(row.md_purchase_charge_val) || 0) > 0 ||
    (parseFloat(row.dt_purchase_charge_val) || 0) > 0 ||
    (parseFloat(row.rt_purchase_charge_val) || 0) > 0;
  return {
    retailer_charge: parseFloat(row.retailer_charge) || 0,
    retailer_commission: parseFloat(row.retailer_commission) || 0,
    distributor_commission: parseFloat(row.distributor_commission) || 0,
    md_commission: parseFloat(row.md_commission) || 0,
    company_earning: parseFloat(row.company_earning) || 0,
    md_purchase_charge: parseFloat(row.md_purchase_charge_val) || 0,
    dt_purchase_charge: parseFloat(row.dt_purchase_charge_val) || 0,
    rt_purchase_charge: parseFloat(row.rt_purchase_charge_val) || 0,
    md_margin: parseFloat(row.md_margin) || 0,
    dt_margin: parseFloat(row.dt_margin) || 0,
    company_margin: parseFloat(row.company_margin) || 0,
    is_charge_model: isChargeModel,
    scheme_id: resolved.scheme_id,
    scheme_name: resolved.scheme_name,
    scheme_type: resolved.scheme_type,
    resolved_via: resolved.resolved_via,
  };
}

/**
 * Calculate Payout charge breakdown for a transaction
 */
export async function calculatePayoutCharge(
  userId: string,
  userRole: string,
  amount: number,
  transferMode: string,
  distributorId?: string,
  mdId?: string
): Promise<ChargeBreakdown | null> {
  const resolved = await resolveSchemeForUser(userId, userRole, 'payout', distributorId, mdId);
  if (!resolved) return null;

  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('calculate_payout_charge_from_scheme', {
    p_scheme_id: resolved.scheme_id,
    p_amount: amount,
    p_transfer_mode: transferMode,
  });

  if (error || !data || data.length === 0) {
    console.error('[SchemeService] Payout charge calculation failed:', error);
    return null;
  }

  const row = data[0];
  const isChargeModel = (parseFloat(row.md_purchase_charge_val) || 0) > 0 ||
    (parseFloat(row.dt_purchase_charge_val) || 0) > 0 ||
    (parseFloat(row.rt_purchase_charge_val) || 0) > 0;
  return {
    retailer_charge: parseFloat(row.retailer_charge) || 0,
    retailer_commission: parseFloat(row.retailer_commission) || 0,
    distributor_commission: parseFloat(row.distributor_commission) || 0,
    md_commission: parseFloat(row.md_commission) || 0,
    company_earning: parseFloat(row.company_earning) || 0,
    md_purchase_charge: parseFloat(row.md_purchase_charge_val) || 0,
    dt_purchase_charge: parseFloat(row.dt_purchase_charge_val) || 0,
    rt_purchase_charge: parseFloat(row.rt_purchase_charge_val) || 0,
    md_margin: parseFloat(row.md_margin) || 0,
    dt_margin: parseFloat(row.dt_margin) || 0,
    company_margin: parseFloat(row.company_margin) || 0,
    is_charge_model: isChargeModel,
    scheme_id: resolved.scheme_id,
    scheme_name: resolved.scheme_name,
    scheme_type: resolved.scheme_type,
    resolved_via: resolved.resolved_via,
  };
}

/**
 * Calculate AEPS settlement charge breakdown for a given amount
 */
export async function calculateAEPSSettlementCharge(
  userId: string,
  userRole: string,
  amount: number,
  distributorId?: string,
  mdId?: string
): Promise<ChargeBreakdown | null> {
  const resolved = await resolveSchemeForUser(userId, userRole, 'aeps_settlement', distributorId, mdId);
  if (!resolved) return null;

  const supabase = getSupabase();
  const { data: chargeData, error: chargeErr } = await supabase.rpc('calculate_aeps_settlement_charge_from_scheme', {
    p_scheme_id: resolved.scheme_id,
    p_amount: amount,
  });

  if (chargeErr || !chargeData || chargeData.length === 0) {
    console.error('[SchemeService] AEPS settlement charge calculation failed:', chargeErr);
    return null;
  }

  const chargeRow = chargeData[0];
  const isChargeModel = (parseFloat(chargeRow.md_purchase_charge_val) || 0) > 0 ||
    (parseFloat(chargeRow.dt_purchase_charge_val) || 0) > 0 ||
    (parseFloat(chargeRow.rt_purchase_charge_val) || 0) > 0;
  return {
    retailer_charge: parseFloat(chargeRow.retailer_charge) || 0,
    retailer_commission: 0,
    distributor_commission: parseFloat(chargeRow.distributor_commission) || 0,
    md_commission: parseFloat(chargeRow.md_commission) || 0,
    company_earning: parseFloat(chargeRow.company_earning) || 0,
    md_purchase_charge: parseFloat(chargeRow.md_purchase_charge_val) || 0,
    dt_purchase_charge: parseFloat(chargeRow.dt_purchase_charge_val) || 0,
    rt_purchase_charge: parseFloat(chargeRow.rt_purchase_charge_val) || 0,
    md_margin: parseFloat(chargeRow.md_margin) || 0,
    dt_margin: parseFloat(chargeRow.dt_margin) || 0,
    company_margin: parseFloat(chargeRow.company_margin) || 0,
    is_charge_model: isChargeModel,
    scheme_id: resolved.scheme_id,
    scheme_name: resolved.scheme_name,
    scheme_type: resolved.scheme_type,
    resolved_via: resolved.resolved_via,
  };
}

// ============================================================================
// SHADVAL SETTLEMENT CHARGE CRUD
// ============================================================================

export async function getShadvalSettlementCharges(schemeId: string): Promise<SchemeShadvalSettlementCharge[]> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('scheme_shadval_settlement_charges')
    .select('*')
    .eq('scheme_id', schemeId)
    .order('transfer_mode')
    .order('min_amount');
  return data || [];
}

export async function upsertShadvalSettlementCharge(
  input: CreateShadvalSettlementChargeInput
): Promise<{ data: SchemeShadvalSettlementCharge | null; error: string | null }> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('scheme_shadval_settlement_charges')
    .upsert({
      scheme_id: input.scheme_id,
      transfer_mode: input.transfer_mode,
      min_amount: input.min_amount ?? 0,
      max_amount: input.max_amount ?? 999999999,
      retailer_charge: input.retailer_charge,
      retailer_charge_type: input.retailer_charge_type,
      distributor_commission: input.distributor_commission || 0,
      distributor_commission_type: input.distributor_commission_type || 'flat',
      md_commission: input.md_commission || 0,
      md_commission_type: input.md_commission_type || 'flat',
      company_charge: input.company_charge || 0,
      company_charge_type: input.company_charge_type || 'flat',
      md_purchase_charge: input.md_purchase_charge || 0,
      md_purchase_charge_type: input.md_purchase_charge_type || 'flat',
      dt_purchase_charge: input.dt_purchase_charge || 0,
      dt_purchase_charge_type: input.dt_purchase_charge_type || 'flat',
      rt_purchase_charge: input.rt_purchase_charge || 0,
      rt_purchase_charge_type: input.rt_purchase_charge_type || 'flat',
      gst_inclusive: input.gst_inclusive ?? false,
      vendor_rate: input.vendor_rate ?? 0,
      company_mdr_rate: input.company_mdr_rate ?? 0,
      status: 'active',
    }, { onConflict: 'scheme_id,transfer_mode,min_amount,max_amount' })
    .select()
    .single();
  return { data: data || null, error: error?.message || null };
}

export async function deleteShadvalSettlementCharge(id: string): Promise<{ success: boolean }> {
  const supabase = getSupabase();
  const { error } = await supabase.from('scheme_shadval_settlement_charges').delete().eq('id', id);
  return { success: !error };
}

export async function calculateShadvalSettlementCharge(
  userId: string,
  userRole: string,
  amount: number,
  transferMode: string = 'IMPS',
  distributorId?: string,
  mdId?: string
): Promise<ChargeBreakdown | null> {
  const resolved = await resolveSchemeForUser(userId, userRole, 'shadval_settlement', distributorId, mdId);
  if (!resolved) return null;

  const supabase = getSupabase();
  const { data: chargeData, error: chargeErr } = await supabase.rpc('calculate_shadval_settlement_charge_from_scheme', {
    p_scheme_id: resolved.scheme_id,
    p_amount: amount,
    p_transfer_mode: transferMode,
  });

  if (chargeErr || !chargeData || chargeData.length === 0) {
    console.error('[SchemeService] Shadval settlement charge calculation failed:', chargeErr);
    return null;
  }

  const chargeRow = chargeData[0];
  const isChargeModel = (parseFloat(chargeRow.md_purchase_charge_val) || 0) > 0 ||
    (parseFloat(chargeRow.dt_purchase_charge_val) || 0) > 0 ||
    (parseFloat(chargeRow.rt_purchase_charge_val) || 0) > 0;
  return {
    retailer_charge: parseFloat(chargeRow.retailer_charge) || 0,
    retailer_commission: 0,
    distributor_commission: parseFloat(chargeRow.distributor_commission) || 0,
    md_commission: parseFloat(chargeRow.md_commission) || 0,
    company_earning: parseFloat(chargeRow.company_earning || chargeRow.company_charge) || 0,
    md_purchase_charge: parseFloat(chargeRow.md_purchase_charge_val) || 0,
    dt_purchase_charge: parseFloat(chargeRow.dt_purchase_charge_val) || 0,
    rt_purchase_charge: parseFloat(chargeRow.rt_purchase_charge_val) || 0,
    md_margin: parseFloat(chargeRow.md_margin) || 0,
    dt_margin: parseFloat(chargeRow.dt_margin) || 0,
    company_margin: parseFloat(chargeRow.company_margin) || 0,
    is_charge_model: isChargeModel,
    scheme_id: resolved.scheme_id,
    scheme_name: resolved.scheme_name,
    scheme_type: resolved.scheme_type,
    resolved_via: resolved.resolved_via,
  };
}

