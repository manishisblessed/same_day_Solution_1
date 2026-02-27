/**
 * MDR Scheme Service
 * 
 * Handles fetching and validating MDR schemes (global and custom)
 */

import { getSupabaseAdmin } from '@/lib/supabase/server-admin';
import type {
  GlobalScheme,
  RetailerScheme,
  SchemeQueryParams,
  CreateGlobalSchemeInput,
  CreateRetailerSchemeInput,
} from '@/types/mdr-scheme.types';

/**
 * Get active global scheme matching the query parameters
 */
export async function getGlobalScheme(
  params: SchemeQueryParams
): Promise<GlobalScheme | null> {
  const supabase = getSupabaseAdmin();

  let query = supabase
    .from('global_schemes')
    .select('*')
    .eq('mode', params.mode)
    .eq('status', 'active')
    .order('effective_date', { ascending: false })
    .limit(1);

  // Match card_type (NULL matches NULL)
  if (params.card_type === null) {
    query = query.is('card_type', null);
  } else if (params.card_type) {
    query = query.eq('card_type', params.card_type);
  }

  if (params.brand_type === null) {
    query = query.is('brand_type', null);
  } else if (params.brand_type) {
    query = query.ilike('brand_type', params.brand_type);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error('Error fetching global scheme:', error);
    return null;
  }

  return data as GlobalScheme | null;
}

/**
 * Get active retailer scheme (custom scheme) matching the query parameters
 */
export async function getRetailerScheme(
  params: SchemeQueryParams & { retailer_id: string }
): Promise<RetailerScheme | null> {
  const supabase = getSupabaseAdmin();

  if (!params.retailer_id) {
    return null;
  }

  let query = supabase
    .from('retailer_schemes')
    .select('*')
    .eq('retailer_id', params.retailer_id)
    .eq('mode', params.mode)
    .eq('status', 'active')
    .order('effective_date', { ascending: false })
    .limit(1);

  // Match card_type (NULL matches NULL)
  if (params.card_type === null) {
    query = query.is('card_type', null);
  } else if (params.card_type) {
    query = query.eq('card_type', params.card_type);
  }

  if (params.brand_type === null) {
    query = query.is('brand_type', null);
  } else if (params.brand_type) {
    query = query.ilike('brand_type', params.brand_type);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error('Error fetching retailer scheme:', error);
    return null;
  }

  return data as RetailerScheme | null;
}

/**
 * Get scheme for transaction (checks retailer_schemes first, then global_schemes)
 */
export async function getSchemeForTransaction(
  params: SchemeQueryParams & { retailer_id: string }
): Promise<{
  scheme: GlobalScheme | RetailerScheme | null;
  scheme_type: 'global' | 'custom' | null;
}> {
  // First, try to get custom retailer scheme
  const retailerScheme = await getRetailerScheme(params);
  if (retailerScheme) {
    return {
      scheme: retailerScheme,
      scheme_type: 'custom',
    };
  }

  // Fallback to global scheme
  const globalScheme = await getGlobalScheme(params);
  if (globalScheme) {
    return {
      scheme: globalScheme,
      scheme_type: 'global',
    };
  }

  return {
    scheme: null,
    scheme_type: null,
  };
}

/**
 * Validate retailer MDR >= distributor MDR
 */
export function validateRetailerMDR(
  retailerMDR: number,
  distributorMDR: number
): boolean {
  return retailerMDR >= distributorMDR;
}

/**
 * Calculate T+0 MDR from T+1 MDR (T+0 = T+1 + 1%)
 */
export function calculateT0MDR(t1MDR: number): number {
  return Number((t1MDR + 1).toFixed(4));
}

/**
 * Create global scheme with auto-calculation of T+0 MDR
 */
export async function createGlobalScheme(
  input: CreateGlobalSchemeInput
): Promise<{ success: boolean; data?: GlobalScheme; error?: string }> {
  const supabase = getSupabaseAdmin();

  // Auto-calculate T+0 MDR = T+1 MDR + 1%
  const rt_mdr_t0 = calculateT0MDR(input.rt_mdr_t1);
  const dt_mdr_t0 = calculateT0MDR(input.dt_mdr_t1);

  // Validate T+1 MDRs
  if (input.rt_mdr_t1 < 0 || input.rt_mdr_t1 > 100) {
    return { success: false, error: 'RT MDR T+1 must be between 0 and 100' };
  }
  if (input.dt_mdr_t1 < 0 || input.dt_mdr_t1 > 100) {
    return { success: false, error: 'DT MDR T+1 must be between 0 and 100' };
  }

  // Validate retailer MDR >= distributor MDR
  if (!validateRetailerMDR(input.rt_mdr_t1, input.dt_mdr_t1)) {
    return {
      success: false,
      error: 'Retailer MDR T+1 must be >= Distributor MDR T+1',
    };
  }
  if (!validateRetailerMDR(rt_mdr_t0, dt_mdr_t0)) {
    return {
      success: false,
      error: 'Retailer MDR T+0 must be >= Distributor MDR T+0',
    };
  }

  const schemeData = {
    mode: input.mode,
    card_type: input.card_type || null,
    brand_type: input.brand_type || null,
    rt_mdr_t1: input.rt_mdr_t1,
    rt_mdr_t0: rt_mdr_t0,
    dt_mdr_t1: input.dt_mdr_t1,
    dt_mdr_t0: dt_mdr_t0,
    status: input.status || 'active',
    effective_date: input.effective_date || new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('global_schemes')
    .insert(schemeData)
    .select()
    .single();

  if (error) {
    console.error('Error creating global scheme:', error);
    return { success: false, error: error.message };
  }

  return { success: true, data: data as GlobalScheme };
}

/**
 * Create retailer scheme with validation
 */
export async function createRetailerScheme(
  input: CreateRetailerSchemeInput
): Promise<{ success: boolean; data?: RetailerScheme; error?: string }> {
  const supabase = getSupabaseAdmin();

  // Validate MDR ranges
  if (input.retailer_mdr_t1 < 0 || input.retailer_mdr_t1 > 100) {
    return {
      success: false,
      error: 'Retailer MDR T+1 must be between 0 and 100',
    };
  }
  if (input.retailer_mdr_t0 < 0 || input.retailer_mdr_t0 > 100) {
    return {
      success: false,
      error: 'Retailer MDR T+0 must be between 0 and 100',
    };
  }
  if (input.distributor_mdr_t1 < 0 || input.distributor_mdr_t1 > 100) {
    return {
      success: false,
      error: 'Distributor MDR T+1 must be between 0 and 100',
    };
  }
  if (input.distributor_mdr_t0 < 0 || input.distributor_mdr_t0 > 100) {
    return {
      success: false,
      error: 'Distributor MDR T+0 must be between 0 and 100',
    };
  }

  // Validate retailer MDR >= distributor MDR
  if (
    !validateRetailerMDR(input.retailer_mdr_t1, input.distributor_mdr_t1)
  ) {
    return {
      success: false,
      error: 'Retailer MDR T+1 must be >= Distributor MDR T+1',
    };
  }
  if (
    !validateRetailerMDR(input.retailer_mdr_t0, input.distributor_mdr_t0)
  ) {
    return {
      success: false,
      error: 'Retailer MDR T+0 must be >= Distributor MDR T+0',
    };
  }

  const schemeData = {
    distributor_id: input.distributor_id,
    retailer_id: input.retailer_id,
    mode: input.mode,
    card_type: input.card_type || null,
    brand_type: input.brand_type || null,
    retailer_mdr_t1: input.retailer_mdr_t1,
    retailer_mdr_t0: input.retailer_mdr_t0,
    distributor_mdr_t1: input.distributor_mdr_t1,
    distributor_mdr_t0: input.distributor_mdr_t0,
    status: input.status || 'active',
    effective_date: input.effective_date || new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('retailer_schemes')
    .insert(schemeData)
    .select()
    .single();

  if (error) {
    console.error('Error creating retailer scheme:', error);
    return { success: false, error: error.message };
  }

  return { success: true, data: data as RetailerScheme };
}

/**
 * Normalize payment mode from Razorpay format
 */
export function normalizePaymentMode(method: string): 'CARD' | 'UPI' {
  const upperMethod = method.toUpperCase();
  if (upperMethod === 'CARD' || upperMethod.includes('CARD')) {
    return 'CARD';
  }
  if (upperMethod === 'UPI' || upperMethod.includes('UPI')) {
    return 'UPI';
  }
  // Default to UPI for unknown methods
  return 'UPI';
}

/**
 * Normalize card type from Razorpay format
 */
export function normalizeCardType(
  cardType: string | undefined
): 'CREDIT' | 'DEBIT' | 'PREPAID' | null {
  if (!cardType) return null;
  const upperType = cardType.toUpperCase();
  if (upperType === 'CREDIT') return 'CREDIT';
  if (upperType === 'DEBIT') return 'DEBIT';
  if (upperType === 'PREPAID') return 'PREPAID';
  return null;
}

/**
 * Normalize brand type from Razorpay format
 * Razorpay sends brands like MASTER_CARD, VISA, AMEX, RUPAY etc.
 * Schemes may store them as MasterCard, MASTERCARD, Visa, etc.
 * We normalize to a canonical uppercase form without separators.
 */
export function normalizeBrandType(brand: string | undefined): string | null {
  if (!brand) return null;
  const normalized = brand
    .toUpperCase()
    .replace(/[\s_-]+/g, '');

  const BRAND_ALIASES: Record<string, string> = {
    'MASTERCARD': 'MASTERCARD',
    'MASTER': 'MASTERCARD',
    'MC': 'MASTERCARD',
    'VISA': 'VISA',
    'AMEX': 'AMEX',
    'AMERICANEXPRESS': 'AMEX',
    'RUPAY': 'RUPAY',
    'DINERS': 'DINERS',
    'DINERSCLUB': 'DINERS',
    'MAESTRO': 'MAESTRO',
    'JCB': 'JCB',
    'DISCOVER': 'DISCOVER',
  }

  return BRAND_ALIASES[normalized] || normalized || null;
}

