/**
 * Service vendor/minimum rate engine (BBPS + Settlement/Payout).
 *
 * The service-rail analogue of the POS brand rate card. A row in
 * service_vendor_rates is the AUTHORITATIVE vendor cost + minimum charge for a
 * rail (BBPS | PAYOUT), keyed by a sub-dimension (scope_key) + optional category
 * within an amount band:
 *
 *   vendor_rate (+ type)  — acquirer/API cost the company PAYS upstream.
 *   min_charge  (+ type)  — minimum the company offers downstream (vendor cost +
 *                           company margin). A scheme's customer charge for this
 *                           rail can never be priced below it.
 *
 * GST: when gst_inclusive the vendor cost includes 18% GST, so the real (ex-GST)
 * cost = value/1.18 (GST is an input credit). Revenue uses the ex-GST cost:
 *
 *   company revenue per txn = customer charge − ex-GST vendor cost
 *
 * PERCENT values are a percent in [0,100]; FLAT values are absolute ₹.
 * "*" scope_key = wildcard; an exact scope match beats a wildcard.
 */

import { getSupabaseAdmin } from '@/lib/supabase/server-admin';
import { GST_DIVISOR } from '@/lib/brand/mdr';

export type ServiceKind = 'BBPS' | 'PAYOUT';
export type RateType = 'PERCENT' | 'FLAT';

export interface ServiceVendorRate {
  id: string;
  service_kind: ServiceKind;
  scope_key: string;
  category: string | null;
  min_amount: number;
  max_amount: number;
  vendor_rate_type: RateType;
  vendor_rate: number;
  min_charge_type: RateType;
  min_charge: number;
  gst_inclusive: boolean;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface ServiceVendorResolved {
  rateId: string;
  /** Vendor cost resolved to an absolute ₹ for `amount` (as entered, incl. GST if flagged). */
  vendorCost: number;
  /** Ex-GST vendor cost (₹) — the cost used for revenue. */
  vendorCostExGst: number;
  /** Minimum customer charge resolved to an absolute ₹ for `amount`. */
  minCharge: number;
  vendor_rate_type: RateType;
  vendor_rate: number; // raw value as entered
  min_charge_type: RateType;
  min_charge: number; // raw value as entered
  gst_inclusive: boolean;
}

const norm = (v: string | null | undefined) => (v ?? '').trim().toUpperCase();
const isWildcard = (v: string | null | undefined) => {
  const n = norm(v);
  return n === '' || n === '*';
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Resolve a PERCENT/FLAT value to an absolute ₹ against `amount`. */
export function toAbsolute(value: number, type: RateType, amount: number): number {
  return type === 'PERCENT' ? round2((amount * value) / 100) : round2(value);
}

/** Strip GST from a value when it was entered GST-inclusive. */
export function exGstValue(value: number, gstInclusive: boolean): number {
  return gstInclusive ? value / GST_DIVISOR : value;
}

/**
 * Score a rate against (scope_key, category). -1 = ineligible (a pinned
 * dimension mismatches), else count of exact matches (higher = more specific).
 */
function rateScore(rate: ServiceVendorRate, dims: { scope_key?: string | null; category?: string | null }): number {
  let score = 0;
  const pairs: Array<[string | null, string | null | undefined]> = [
    [rate.scope_key, dims.scope_key],
    [rate.category, dims.category],
  ];
  for (const [rateVal, txnVal] of pairs) {
    if (isWildcard(rateVal)) continue;
    if (isWildcard(txnVal)) return -1;
    if (norm(rateVal) !== norm(txnVal)) return -1;
    score++;
  }
  return score;
}

/** Pick the most specific eligible rate whose band contains `amount`. */
function pickRate(
  rates: ServiceVendorRate[],
  amount: number,
  dims: { scope_key?: string | null; category?: string | null },
  relaxBand = false
): ServiceVendorRate | null {
  const best = (candidates: ServiceVendorRate[]): ServiceVendorRate | null => {
    let chosen: ServiceVendorRate | null = null;
    let bestScore = -1;
    for (const r of candidates) {
      const s = rateScore(r, dims);
      if (s > bestScore) {
        chosen = r;
        bestScore = s;
      }
    }
    return bestScore >= 0 ? chosen : null;
  };
  const inBand = rates.filter((r) => amount >= Number(r.min_amount) && amount <= Number(r.max_amount));
  const hit = best(inBand);
  if (hit || !relaxBand) return hit;
  return best(rates);
}

async function fetchActive(serviceKind: ServiceKind): Promise<ServiceVendorRate[]> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('service_vendor_rates')
    .select('*')
    .eq('service_kind', serviceKind)
    .eq('active', true)
    .order('min_amount', { ascending: true });
  return (data as unknown as ServiceVendorRate[]) || [];
}

/**
 * Resolve the authoritative vendor cost + minimum for a service transaction/slab.
 * Returns null when no active rate matches (caller keeps supplied values).
 */
export async function resolveServiceVendorRate(input: {
  serviceKind: ServiceKind;
  scopeKey?: string | null;
  category?: string | null;
  amount: number;
  relaxBand?: boolean;
}): Promise<ServiceVendorResolved | null> {
  const rates = await fetchActive(input.serviceKind);
  const rate = pickRate(
    rates,
    round2(input.amount),
    { scope_key: input.scopeKey ?? null, category: input.category ?? null },
    input.relaxBand ?? true
  );
  if (!rate) return null;

  const amt = round2(input.amount);
  const vendorAbs = toAbsolute(Number(rate.vendor_rate), rate.vendor_rate_type, amt);
  const vendorAbsExGst = round2(exGstValue(vendorAbs, !!rate.gst_inclusive));
  const minAbs = toAbsolute(Number(rate.min_charge), rate.min_charge_type, amt);

  return {
    rateId: rate.id,
    vendorCost: vendorAbs,
    vendorCostExGst: vendorAbsExGst,
    minCharge: minAbs,
    vendor_rate_type: rate.vendor_rate_type,
    vendor_rate: Number(rate.vendor_rate),
    min_charge_type: rate.min_charge_type,
    min_charge: Number(rate.min_charge),
    gst_inclusive: !!rate.gst_inclusive,
  };
}

/**
 * Validate that min_charge >= vendor cost (the company never books a loss),
 * compared at a representative amount so PERCENT/FLAT mixes are handled.
 * Uses the EX-GST vendor cost (GST is an input credit). Returns error or null.
 */
export function validateMinVsVendor(
  v: { vendor_rate: number; vendor_rate_type: RateType; min_charge: number; min_charge_type: RateType; gst_inclusive: boolean },
  repAmount = 1000
): string | null {
  if (v.min_charge <= 0) return null; // unset
  const vendorAbs = toAbsolute(v.vendor_rate, v.vendor_rate_type, repAmount);
  const vendorExGst = exGstValue(vendorAbs, v.gst_inclusive);
  const minAbs = toAbsolute(v.min_charge, v.min_charge_type, repAmount);
  if (minAbs - vendorExGst < -1e-9) {
    return `Minimum charge (₹${minAbs.toFixed(2)} at ₹${repAmount}) cannot be below the ex-GST vendor cost (₹${vendorExGst.toFixed(2)}). It must cover the vendor cost plus the company margin.`;
  }
  return null;
}

/**
 * Validate a candidate band against existing active rows sharing the SAME
 * (scope_key, category). Returns an error string or null.
 */
export async function validateServiceVendorBand(
  serviceKind: ServiceKind,
  dims: { scope_key: string; category: string | null },
  range: { min_amount: number; max_amount: number },
  excludeId?: string
): Promise<string | null> {
  if (range.min_amount > range.max_amount) return 'min_amount must be <= max_amount';

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from('service_vendor_rates')
    .select('id, min_amount, max_amount')
    .eq('service_kind', serviceKind)
    .eq('scope_key', dims.scope_key)
    .eq('active', true);
  query = dims.category === null ? query.is('category', null) : query.eq('category', dims.category);
  if (excludeId) query = query.neq('id', excludeId);

  const { data } = await query;
  const label = [dims.scope_key, dims.category].filter((x) => x && x !== '*').join('/') || '*';
  for (const r of ((data as any[]) || [])) {
    if (range.min_amount <= Number(r.max_amount) && Number(r.min_amount) <= range.max_amount) {
      return `Range ₹${range.min_amount}–₹${range.max_amount} overlaps an existing ${label} rate (₹${Number(r.min_amount)}–₹${Number(r.max_amount)})`;
    }
  }
  return null;
}
