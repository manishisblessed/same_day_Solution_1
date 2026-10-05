/**
 * Brand MDR engine (sameday).
 *
 * A Brand (ashvam / teachway / lagoon / …) owns a rate card (brand_mdr_rates).
 * Each row is the AUTHORITATIVE vendor/acquirer cost + minimum MDR floor for a
 * dimension tuple (provider / mode / card_type / brand_type / card_classification)
 * within an amount band.
 *
 *   mdr_value / mdr_value_t0        — vendor cost the company PAYS upstream.
 *   min_mdr_value / min_mdr_value_t0 — minimum MDR offered downstream (vendor
 *                                      cost + guaranteed company margin). A
 *                                      scheme's POS service charge can never be
 *                                      priced below this.
 *
 * Per-transaction economics:
 *   company margin (guaranteed) = min_mdr_value − mdr_value
 *   revenue per txn             = scheme service charge − vendor cost (mdr_value)
 *
 * All MDR values are a PERCENT in [0,100] (e.g. 1.5 = 1.5%), matching
 * scheme_mdr_rates. "*" (or null card dims) is a wildcard; an exact dimension
 * match beats a wildcard when resolving.
 */

import { getSupabaseAdmin } from '@/lib/supabase/server-admin';

export type SettlementType = 'T0' | 'T1';

/** India GST rate applied to vendor/acquirer cost (18%). */
export const GST_DIVISOR = 1.18;

/** Strip GST from a vendor cost when it was entered GST-inclusive. */
export function exGst(value: number, gstInclusive: boolean): number {
  return gstInclusive ? value / GST_DIVISOR : value;
}

export interface BrandMdrRate {
  id: string;
  brand_id: string;
  provider: string;
  mode: string;
  card_type: string | null;
  brand_type: string | null;
  card_classification: string | null;
  min_amount: number;
  max_amount: number;
  mdr_type: 'PERCENT';
  mdr_value: number;
  mdr_value_t0: number;
  min_mdr_value: number;
  min_mdr_value_t0: number;
  gst_inclusive: boolean;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Brand {
  id: string;
  key: string;
  name: string;
  short_name: string | null;
  description: string | null;
  active: boolean;
  settlement_mode: 'INSTANT' | 'T1' | 'BOTH';
  t1_cutoff_hour: number | null;
  created_by: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Transaction-side dimensions used to pick the most specific brand rate. */
export interface BrandRateDims {
  provider?: string | null;
  mode?: string | null;
  card_type?: string | null;
  brand_type?: string | null;
  card_classification?: string | null;
}

export interface BrandMdrResult {
  rateId: string;
  brandId: string;
  /** Vendor/acquirer cost % for the chosen settlement type (T0 falls back to T1), as entered. */
  vendorMdr: number;
  /** Ex-GST vendor cost % (value/1.18 when gst_inclusive). This is the cost used for revenue. */
  vendorMdrExGst: number;
  /** Whether the vendor cost was entered GST-inclusive. */
  gstInclusive: boolean;
  /** Minimum MDR % the company offers downstream (floor for scheme pricing). */
  minMdr: number;
  provider: string;
  mode: string;
  card_type: string | null;
  brand_type: string | null;
  card_classification: string | null;
}

// ── normalization ────────────────────────────────────────────────────────────
const norm = (v: string | null | undefined) => (v ?? '').trim().toUpperCase();
const isWildcard = (v: string | null | undefined) => {
  const n = norm(v);
  return n === '' || n === '*';
};
const normDim = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim();
  return s && s !== '*' ? s.toUpperCase() : null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Effective vendor cost for a settlement type (T0 falls back to T1 when 0). */
function vendorValue(rate: BrandMdrRate, settlementType: SettlementType): number {
  if (settlementType === 'T0' && Number(rate.mdr_value_t0) > 0) return Number(rate.mdr_value_t0);
  return Number(rate.mdr_value);
}

/** Effective minimum MDR for a settlement type (T0 falls back to T1 when 0). */
function minValue(rate: BrandMdrRate, settlementType: SettlementType): number {
  if (settlementType === 'T0' && Number(rate.min_mdr_value_t0) > 0) return Number(rate.min_mdr_value_t0);
  return Number(rate.min_mdr_value);
}

/**
 * Score a rate against capture dimensions. -1 = ineligible (a pinned dimension
 * mismatches), otherwise the count of exact matches (higher = more specific).
 * Wildcard rate dimensions are eligible but score 0.
 */
function rateScore(
  rate: BrandMdrRate,
  dims: BrandRateDims,
  opts?: { ignoreProvider?: boolean; relaxWildcard?: boolean }
): number {
  let score = 0;
  const pairs: Array<[string | null, string | null | undefined]> = [
    [rate.mode, dims.mode],
    [rate.card_type, dims.card_type],
    [rate.brand_type, dims.brand_type],
    [rate.card_classification, dims.card_classification],
  ];
  if (!opts?.ignoreProvider) {
    pairs.unshift([rate.provider, dims.provider]);
  }
  for (const [rateVal, txnVal] of pairs) {
    if (isWildcard(rateVal)) continue;
    if (isWildcard(txnVal)) {
      // At config time (relaxWildcard) an "Any" slab dim may inherit a
      // pinned brand rate (scores 0). For a live capture it's ineligible.
      if (opts?.relaxWildcard) continue;
      return -1;
    }
    if (norm(rateVal) !== norm(txnVal)) return -1;
    score++;
  }
  return score;
}

/** Pick the most specific eligible rate whose band contains `amount`. */
function pickRate(
  rates: BrandMdrRate[],
  amount: number,
  dims: BrandRateDims,
  opts?: { ignoreProvider?: boolean; relaxWildcard?: boolean; relaxBand?: boolean }
): BrandMdrRate | null {
  const pickBest = (candidates: BrandMdrRate[]): BrandMdrRate | null => {
    let best: BrandMdrRate | null = null;
    let bestScore = -1;
    for (const rate of candidates) {
      const score = rateScore(rate, dims, opts);
      if (score > bestScore) {
        best = rate;
        bestScore = score;
      }
    }
    return bestScore >= 0 ? best : null;
  };

  const inBand = rates.filter(
    (r) => amount >= Number(r.min_amount) && amount <= Number(r.max_amount)
  );
  const best = pickBest(inBand);
  if (best || !opts?.relaxBand) return best;

  // Config-time band fallback: a scheme slab's band is independent of the rate
  // card's tiers, so a slab that starts below the lowest tier still locks on.
  // `rates` is ordered by min_amount asc; pickBest keeps the first of equal
  // scores → deterministically the lowest matching tier.
  return pickBest(rates);
}

async function fetchActiveRates(brandId: string): Promise<BrandMdrRate[]> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('brand_mdr_rates')
    .select('*')
    .eq('brand_id', brandId)
    .eq('active', true)
    .order('min_amount', { ascending: true });
  return (data as unknown as BrandMdrRate[]) || [];
}

/** Resolve a brand id from its key (merchant_slug). */
export async function getBrandIdByKey(key: string): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('brands')
    .select('id')
    .eq('key', key.toLowerCase().trim())
    .eq('active', true)
    .maybeSingle();
  return (data as any)?.id ?? null;
}

/**
 * Resolve the effective brand MDR (vendor cost + minimum) for a LIVE capture.
 * Returns null when the brand has no active rate matching the dimensions/band
 * (caller must NOT settle unpriced money).
 */
export async function resolveBrandMdr(input: {
  brandId?: string | null;
  brandKey?: string | null;
  amount: number;
  provider?: string | null;
  mode?: string | null;
  card_type?: string | null;
  brand_type?: string | null;
  card_classification?: string | null;
  settlementType?: SettlementType;
}): Promise<BrandMdrResult | null> {
  const brandId = input.brandId ?? (input.brandKey ? await getBrandIdByKey(input.brandKey) : null);
  if (!brandId) return null;

  const rates = await fetchActiveRates(brandId);
  const rate = pickRate(rates, round2(input.amount), input);
  if (!rate) return null;

  const st = input.settlementType ?? 'T1';
  const vendor = vendorValue(rate, st);
  return {
    rateId: rate.id,
    brandId,
    vendorMdr: vendor,
    vendorMdrExGst: exGst(vendor, !!rate.gst_inclusive),
    gstInclusive: !!rate.gst_inclusive,
    minMdr: minValue(rate, st),
    provider: rate.provider,
    mode: rate.mode,
    card_type: rate.card_type,
    brand_type: rate.brand_type,
    card_classification: rate.card_classification,
  };
}

/**
 * Resolve the company-approved brand rate for a scheme POS slab (config time).
 * `merchantSlug` maps to a brand.key. Returns the most specific active rate
 * whose band contains `amount`, provider-agnostic and band-relaxed so a slab
 * always locks onto the brand's authoritative vendor cost + floor. null = no
 * linked brand / rate.
 */
export async function findApprovedBrandRate(
  input: { merchantSlug: string; amount: number } & BrandRateDims
): Promise<BrandMdrRate | null> {
  const brandId = await getBrandIdByKey(input.merchantSlug);
  if (!brandId) return null;

  const rates = await fetchActiveRates(brandId);
  return pickRate(rates, round2(input.amount), input, {
    ignoreProvider: true,
    relaxWildcard: true,
    relaxBand: true,
  });
}

/**
 * Guardrail so the company never books a loss: the Minimum MDR (offered
 * downstream) must be at least the vendor cost on both the T+1 and T+0 legs.
 * A zero minimum is allowed (unset) and skipped. T0 values fall back to their
 * T+1 counterpart when unset. All values are percent in [0,100].
 * Returns an error string or null.
 */
export function validateMinMdrVsVendor(v: {
  mdr_value: number;
  mdr_value_t0: number;
  min_mdr_value: number;
  min_mdr_value_t0: number;
}): string | null {
  const EPS = 1e-9;
  if (v.min_mdr_value > 0 && v.min_mdr_value - v.mdr_value < -EPS) {
    return `Minimum MDR (${v.min_mdr_value.toFixed(2)}%) cannot be below the vendor cost (${v.mdr_value.toFixed(2)}%). It must cover the acquirer cost plus the company margin.`;
  }
  const minT0 = v.min_mdr_value_t0 > 0 ? v.min_mdr_value_t0 : v.min_mdr_value;
  const venT0 = v.mdr_value_t0 > 0 ? v.mdr_value_t0 : v.mdr_value;
  if (minT0 > 0 && minT0 - venT0 < -EPS) {
    return `T+0 Minimum MDR (${minT0.toFixed(2)}%) cannot be below the T+0 vendor cost (${venT0.toFixed(2)}%).`;
  }
  return null;
}

/**
 * Validate a candidate rate band against existing active rates sharing the SAME
 * full dimension tuple. Different dimension values may share bands. Returns an
 * error string or null.
 */
export async function validateBrandRate(
  brandId: string,
  dims: {
    provider: string;
    mode: string;
    card_type: string | null;
    brand_type: string | null;
    card_classification: string | null;
  },
  range: { min_amount: number; max_amount: number },
  excludeRateId?: string
): Promise<string | null> {
  if (range.min_amount > range.max_amount) {
    return 'min_amount must be less than or equal to max_amount';
  }

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from('brand_mdr_rates')
    .select('id, min_amount, max_amount')
    .eq('brand_id', brandId)
    .eq('provider', dims.provider)
    .eq('mode', dims.mode)
    .eq('active', true);

  query = dims.card_type === null ? query.is('card_type', null) : query.eq('card_type', dims.card_type);
  query = dims.brand_type === null ? query.is('brand_type', null) : query.eq('brand_type', dims.brand_type);
  query =
    dims.card_classification === null
      ? query.is('card_classification', null)
      : query.eq('card_classification', dims.card_classification);
  if (excludeRateId) query = query.neq('id', excludeRateId);

  const { data } = await query;
  const existing = (data as any[]) || [];

  const label =
    [dims.provider, dims.mode, dims.card_type, dims.brand_type, dims.card_classification]
      .filter((x) => x && x !== '*')
      .join('/') || '*';

  for (const r of existing) {
    if (range.min_amount <= Number(r.max_amount) && Number(r.min_amount) <= range.max_amount) {
      return `Range ₹${range.min_amount}–₹${range.max_amount} overlaps an existing ${label} rate (₹${Number(
        r.min_amount
      )}–₹${Number(r.max_amount)})`;
    }
  }
  return null;
}

export { norm as normBrandValue, normDim as normBrandDim };
