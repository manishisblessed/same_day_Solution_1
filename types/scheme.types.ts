/**
 * Comprehensive Scheme Management Types
 * Covers: BBPS, Payout, MDR, Scheme Mapping
 */

// ============================================================================
// ENUMS
// ============================================================================

export type SchemeType = 'global' | 'golden' | 'custom';
export type SchemeStatus = 'active' | 'inactive' | 'draft';
export type ServiceScope = 'all' | 'bbps' | 'payout' | 'mdr' | 'settlement';
export type ChargeType = 'flat' | 'percentage';
export type TransferMode = 'IMPS' | 'NEFT' | 'RTGS';
export type PaymentMode = 'CARD' | 'UPI';
export type CardType = 'CREDIT' | 'DEBIT' | 'PREPAID';
export type UserRole = 'admin' | 'master_distributor' | 'distributor' | 'retailer';

// ============================================================================
// MASTER SCHEME
// ============================================================================

export interface Scheme {
  id: string;
  name: string;
  description: string | null;
  scheme_type: SchemeType;
  service_scope: ServiceScope;
  status: SchemeStatus;
  created_by_id: string | null;
  created_by_role: string | null;
  effective_from: string;
  effective_to: string | null;
  priority: number;
  metadata: Record<string, any> | null;
  created_at: string;
  updated_at: string;
  
  // Joined data
  bbps_commissions?: SchemeBBPSCommission[];
  payout_charges?: SchemePayoutCharge[];
  mdr_rates?: SchemeMDRRate[];
  mappings?: SchemeMapping[];
  mapping_count?: number;
}

// ============================================================================
// BBPS COMMISSION
// ============================================================================

export interface SchemeBBPSCommission {
  id: string;
  scheme_id: string;
  category: string | null;
  min_amount: number;
  max_amount: number;
  
  retailer_charge: number;
  retailer_charge_type: ChargeType;
  
  retailer_commission: number;
  retailer_commission_type: ChargeType;
  
  distributor_commission: number;
  distributor_commission_type: ChargeType;
  
  md_commission: number;
  md_commission_type: ChargeType;
  
  company_charge: number;
  company_charge_type: ChargeType;
  
  status: string;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// PAYOUT CHARGE
// ============================================================================

export interface SchemePayoutCharge {
  id: string;
  scheme_id: string;
  transfer_mode: TransferMode;
  min_amount: number;
  max_amount: number;
  
  retailer_charge: number;
  retailer_charge_type: ChargeType;
  
  retailer_commission: number;
  retailer_commission_type: ChargeType;
  
  distributor_commission: number;
  distributor_commission_type: ChargeType;
  
  md_commission: number;
  md_commission_type: ChargeType;
  
  company_charge: number;
  company_charge_type: ChargeType;
  
  status: string;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// MDR RATE
// ============================================================================

export interface SchemeMDRRate {
  id: string;
  scheme_id: string;
  mode: PaymentMode;
  card_type: CardType | null;
  brand_type: string | null;
  
  retailer_mdr_t1: number;
  retailer_mdr_t0: number;
  distributor_mdr_t1: number;
  distributor_mdr_t0: number;
  md_mdr_t1: number;
  md_mdr_t0: number;
  
  status: string;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// SCHEME MAPPING
// ============================================================================

export interface SchemeMapping {
  id: string;
  scheme_id: string;
  entity_id: string;
  entity_role: UserRole;
  assigned_by_id: string | null;
  assigned_by_role: string | null;
  service_type: ServiceScope | null;
  priority: number;
  status: string;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
  updated_at: string;
  
  // Joined data
  scheme?: Scheme;
  entity_name?: string;
}

// ============================================================================
// RESOLVED SCHEME (from DB function)
// ============================================================================

export interface ResolvedScheme {
  scheme_id: string;
  scheme_name: string;
  scheme_type: SchemeType;
  resolved_via: 'retailer_mapping' | 'distributor_mapping' | 'md_mapping' | 'global';
}

// ============================================================================
// CHARGE CALCULATION RESULTS
// ============================================================================

export interface ChargeBreakdown {
  retailer_charge: number;
  retailer_commission: number;
  distributor_commission: number;
  md_commission: number;
  company_earning: number;
  scheme_id: string;
  scheme_name: string;
  scheme_type: SchemeType;
  resolved_via: string;
}

// ============================================================================
// INPUT TYPES (for creating/updating)
// ============================================================================

export interface CreateSchemeInput {
  name: string;
  description?: string;
  scheme_type: SchemeType;
  service_scope: ServiceScope;
  priority?: number;
  effective_from?: string;
  effective_to?: string;
  metadata?: Record<string, any>;
}

export interface CreateBBPSCommissionInput {
  scheme_id: string;
  category?: string;
  min_amount: number;
  max_amount: number;
  retailer_charge: number;
  retailer_charge_type: ChargeType;
  retailer_commission?: number;
  retailer_commission_type?: ChargeType;
  distributor_commission?: number;
  distributor_commission_type?: ChargeType;
  md_commission?: number;
  md_commission_type?: ChargeType;
  company_charge?: number;
  company_charge_type?: ChargeType;
}

export interface CreatePayoutChargeInput {
  scheme_id: string;
  transfer_mode: TransferMode;
  min_amount?: number;
  max_amount?: number;
  retailer_charge: number;
  retailer_charge_type: ChargeType;
  retailer_commission?: number;
  retailer_commission_type?: ChargeType;
  distributor_commission?: number;
  distributor_commission_type?: ChargeType;
  md_commission?: number;
  md_commission_type?: ChargeType;
  company_charge?: number;
  company_charge_type?: ChargeType;
}

export interface CreateMDRRateInput {
  scheme_id: string;
  mode: PaymentMode;
  card_type?: CardType;
  brand_type?: string;
  retailer_mdr_t1: number;
  retailer_mdr_t0: number;
  distributor_mdr_t1: number;
  distributor_mdr_t0: number;
  md_mdr_t1?: number;
  md_mdr_t0?: number;
}

export interface CreateSchemeMappingInput {
  scheme_id: string;
  entity_id: string;
  entity_role: UserRole;
  service_type?: ServiceScope;
  priority?: number;
  effective_from?: string;
  effective_to?: string;
}

