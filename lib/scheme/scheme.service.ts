/**
 * Comprehensive Scheme Management Service
 * 
 * Handles: CRUD for schemes, BBPS commissions, Payout charges, MDR rates, Mappings
 * Resolves: Which scheme applies to a given user for a given service
 * Calculates: Charges/commissions based on resolved scheme
 */

import { createClient } from '@supabase/supabase-js';
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
  ServiceScope,
} from '@/types/scheme.types';

// ============================================================================
// HELPER: Get admin Supabase client
// ============================================================================

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key);
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
  const [bbps, payout, mdr, mappings] = await Promise.all([
    supabase.from('scheme_bbps_commissions').select('*').eq('scheme_id', id).order('min_amount'),
    supabase.from('scheme_payout_charges').select('*').eq('scheme_id', id).order('transfer_mode'),
    supabase.from('scheme_mdr_rates').select('*').eq('scheme_id', id).order('mode'),
    supabase.from('scheme_mappings').select('*').eq('scheme_id', id).eq('status', 'active'),
  ]);

  return {
    data: {
      ...scheme,
      bbps_commissions: bbps.data || [],
      payout_charges: payout.data || [],
      mdr_rates: mdr.data || [],
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
  const { data, error } = await supabase
    .from('scheme_bbps_commissions')
    .upsert({
      scheme_id: input.scheme_id,
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
      company_charge: input.company_charge || 0,
      company_charge_type: input.company_charge_type || 'flat',
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
  const { data, error } = await supabase
    .from('scheme_payout_charges')
    .upsert({
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
      company_charge: input.company_charge || 0,
      company_charge_type: input.company_charge_type || 'flat',
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
  const { data, error } = await supabase
    .from('scheme_mdr_rates')
    .upsert({
      scheme_id: input.scheme_id,
      mode: input.mode,
      card_type: input.card_type || null,
      brand_type: input.brand_type || null,
      retailer_mdr_t1: input.retailer_mdr_t1,
      retailer_mdr_t0: input.retailer_mdr_t0,
      distributor_mdr_t1: input.distributor_mdr_t1,
      distributor_mdr_t0: input.distributor_mdr_t0,
      md_mdr_t1: input.md_mdr_t1 || 0,
      md_mdr_t0: input.md_mdr_t0 || 0,
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

  // Deactivate existing active mapping for this entity+service
  await supabase
    .from('scheme_mappings')
    .update({ status: 'inactive' })
    .eq('entity_id', input.entity_id)
    .eq('entity_role', input.entity_role)
    .eq('status', 'active')
    .or(`service_type.eq.${input.service_type || 'all'},service_type.is.null`);

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
  return {
    retailer_charge: parseFloat(row.retailer_charge) || 0,
    retailer_commission: parseFloat(row.retailer_commission) || 0,
    distributor_commission: parseFloat(row.distributor_commission) || 0,
    md_commission: parseFloat(row.md_commission) || 0,
    company_earning: parseFloat(row.company_earning) || 0,
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
  return {
    retailer_charge: parseFloat(row.retailer_charge) || 0,
    retailer_commission: parseFloat(row.retailer_commission) || 0,
    distributor_commission: parseFloat(row.distributor_commission) || 0,
    md_commission: parseFloat(row.md_commission) || 0,
    company_earning: parseFloat(row.company_earning) || 0,
    scheme_id: resolved.scheme_id,
    scheme_name: resolved.scheme_name,
    scheme_type: resolved.scheme_type,
    resolved_via: resolved.resolved_via,
  };
}

