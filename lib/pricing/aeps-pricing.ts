/**
 * AEPS Pricing Engine (scheme-aware)
 *
 * Single entry point for resolving AEPS commission from the unified scheme
 * system. Mirrors the BBPS/Payout pattern:
 *   1. resolve_scheme_for_user (retailer -> distributor -> md -> global)
 *   2. calculate_aeps_commission_from_scheme RPC
 *   3. apply margin model (skip owner's margin to avoid double-counting)
 *   4. apply per-scheme TDS to RT/DT/MD credits
 *
 * Commission model (confirmed):
 *   Partner pool -> Company profit (first) -> MD -> DT -> RT
 *   RT credit -> AEPS wallet; DT/MD credit -> primary wallet.
 */

import { createClient } from '@supabase/supabase-js';
import type { AEPSCommissionBreakdown, AEPSTransactionType } from '@/types/scheme.types';

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key);
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Resolve and calculate the full AEPS commission breakdown for a transaction.
 * Returns null when no scheme resolves (caller may fall back to legacy engine).
 */
export async function calculateAEPSCommission(params: {
  userId: string;
  userRole: string;
  transactionType: AEPSTransactionType;
  amount: number;
  distributorId?: string | null;
  mdId?: string | null;
}): Promise<AEPSCommissionBreakdown | null> {
  const { userId, userRole, transactionType, amount, distributorId, mdId } = params;
  const supabase = getSupabase();

  // 1. Resolve scheme via shared RPC
  const { data: resolved, error: resolveErr } = await supabase.rpc('resolve_scheme_for_user', {
    p_user_id: userId,
    p_user_role: userRole,
    p_service_type: 'aeps',
    p_distributor_id: distributorId || null,
    p_md_id: mdId || null,
  });

  if (resolveErr || !resolved || resolved.length === 0) {
    console.warn(`[AEPSPricing] No scheme resolved for ${userRole}:${userId}`, resolveErr?.message);
    return null;
  }

  const scheme = resolved[0];

  // 2. Calculate commission split via RPC
  const { data: calc, error: calcErr } = await supabase.rpc('calculate_aeps_commission_from_scheme', {
    p_scheme_id: scheme.scheme_id,
    p_amount: amount || 0,
    p_transaction_type: transactionType,
  });

  if (calcErr || !calc || calc.length === 0) {
    console.error('[AEPSPricing] Commission calculation failed:', calcErr?.message);
    return null;
  }

  const row = calc[0];
  const base = parseFloat(row.base_commission) || 0;
  const company = parseFloat(row.company_earning) || 0;
  let md = parseFloat(row.md_commission) || 0;
  let dt = parseFloat(row.distributor_commission) || 0;
  const rt = parseFloat(row.retailer_commission) || 0;
  const tdsPct = parseFloat(row.tds_percentage) || 0;

  // 3. Margin model: when the scheme is owned by DT/MD, their margin is already
  // built into the slab they configured downward — don't credit them again.
  if (scheme.resolved_via === 'distributor_mapping') {
    dt = 0;
  }
  if (scheme.resolved_via === 'md_mapping') {
    md = 0;
  }

  // 4. Apply TDS to each role's credit
  const tdsFactor = 1 - tdsPct / 100;
  const rtNet = round2(rt * tdsFactor);
  const dtNet = round2(dt * tdsFactor);
  const mdNet = round2(md * tdsFactor);
  const tdsTotal = round2((rt + dt + md) * (tdsPct / 100));

  return {
    base_commission: round2(base),
    company_earning: round2(company),
    md_commission: round2(md),
    distributor_commission: round2(dt),
    retailer_commission: round2(rt),
    tds_percentage: tdsPct,
    md_net: mdNet,
    distributor_net: dtNet,
    retailer_net: rtNet,
    tds_total: tdsTotal,
    scheme_id: scheme.scheme_id,
    scheme_name: scheme.scheme_name,
    scheme_type: scheme.scheme_type,
    resolved_via: scheme.resolved_via,
  };
}
