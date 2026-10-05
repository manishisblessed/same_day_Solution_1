/**
 * Platform-wide minimum MDR/charge floor (company_mdr_floor).
 *
 * The lowest guardrail beneath every brand/service/scheme rate: no vendor or
 * minimum may be priced below the platform floor for a rail. Values are PERCENT
 * ([0,100]) or FLAT (₹). "*" scope_key = applies to the whole rail.
 */

import { getSupabaseAdmin } from '@/lib/supabase/server-admin';
import { toAbsolute, type RateType } from '@/lib/service-vendor/rates';

export type FloorServiceKind = 'POS' | 'BBPS' | 'PAYOUT';

export interface CompanyMdrFloor {
  id: string;
  service_kind: FloorServiceKind;
  scope_key: string;
  min_amount: number;
  max_amount: number;
  rate_type: RateType;
  floor_value: number;
  active: boolean;
}

const norm = (v: string | null | undefined) => (v ?? '').trim().toUpperCase();
const isWildcard = (v: string | null | undefined) => {
  const n = norm(v);
  return n === '' || n === '*';
};

/**
 * Resolve the most specific active platform floor for a rail, as an absolute ₹
 * for `amount`. Returns 0 when no floor is configured.
 */
export async function resolveCompanyFloor(input: {
  serviceKind: FloorServiceKind;
  scopeKey?: string | null;
  amount: number;
}): Promise<number> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('company_mdr_floor')
    .select('*')
    .eq('service_kind', input.serviceKind)
    .eq('active', true)
    .lte('min_amount', input.amount)
    .gte('max_amount', input.amount)
    .order('min_amount', { ascending: false });
  const rows = (data as unknown as CompanyMdrFloor[]) || [];
  // Prefer an exact scope match, else a wildcard.
  const exact = rows.find((r) => !isWildcard(r.scope_key) && norm(r.scope_key) === norm(input.scopeKey));
  const wild = rows.find((r) => isWildcard(r.scope_key));
  const chosen = exact || wild;
  if (!chosen) return 0;
  return toAbsolute(Number(chosen.floor_value), chosen.rate_type, input.amount);
}
