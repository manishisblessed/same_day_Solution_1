/**
 * Comprehensive Scheme Management Types
 * Covers: BBPS, Payout, MDR, Scheme Mapping
 */

// ============================================================================
// ENUMS
// ============================================================================

export type SchemeType = 'global' | 'golden' | 'custom';
export type SchemeStatus = 'active' | 'inactive' | 'draft';
export type ServiceScope = 'all' | 'bbps' | 'payout' | 'mdr' | 'settlement' | 'aeps' | 'aeps_settlement' | 'shadval_settlement';
export type AEPSTransactionType = 'cash_withdrawal' | 'cash_deposit' | 'balance_inquiry' | 'mini_statement' | 'aadhaar_to_aadhaar';
export type BBPSType = 'bbps_1' | 'bbps_2';
export type ChargeType = 'flat' | 'percentage';
export type TransferMode = 'IMPS' | 'NEFT' | 'RTGS';
export type PaymentMode = 'CARD' | 'UPI';
export type CardType = 'CREDIT' | 'DEBIT' | 'PREPAID';
export type UserRole = 'admin' | 'master_distributor' | 'distributor' | 'retailer' | 'partner';

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
  is_partner_plan: boolean;
  metadata: Record<string, any> | null;
  created_at: string;
  updated_at: string;
  
  // Joined data
  bbps_commissions?: SchemeBBPSCommission[];
  payout_charges?: SchemePayoutCharge[];
  mdr_rates?: SchemeMDRRate[];
  aeps_commissions?: SchemeAEPSCommission[];
  aeps_settlement_charges?: SchemeAEPSSettlementCharge[];
  shadval_settlement_charges?: SchemeShadvalSettlementCharge[];
  mappings?: SchemeMapping[];
  mapping_count?: number;
}

// ============================================================================
// BBPS COMMISSION
// ============================================================================

export interface SchemeBBPSCommission {
  id: string;
  scheme_id: string;
  bbps_type: BBPSType;
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
  card_classification: string | null; // PLATINUM, GOLD, CLASSIC, BUSINESS, STANDARD, etc.
  
  retailer_mdr_t1: number;
  retailer_mdr_t0: number;
  distributor_mdr_t1: number;
  distributor_mdr_t0: number;
  md_mdr_t1: number;
  md_mdr_t0: number;
  partner_mdr: number | null;
  
  status: string;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// AEPS COMMISSION
// ============================================================================

export interface SchemeAEPSCommission {
  id: string;
  scheme_id: string;
  transaction_type: AEPSTransactionType;
  min_amount: number;
  max_amount: number;

  // Partner -> Company pool
  base_commission: number;
  base_commission_type: ChargeType;

  // Company profit (taken first off pool)
  company_earning: number;
  company_earning_type: ChargeType;

  // MD margin -> primary wallet
  md_commission: number;
  md_commission_type: ChargeType;

  // DT margin -> primary wallet
  distributor_commission: number;
  distributor_commission_type: ChargeType;

  // RT earning -> AEPS wallet
  retailer_commission: number;
  retailer_commission_type: ChargeType;

  tds_percentage: number;

  status: string;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// AEPS SETTLEMENT CHARGE
// ============================================================================

export interface SchemeAEPSSettlementCharge {
  id: string;
  scheme_id: string;
  min_amount: number;
  max_amount: number;

  retailer_charge: number;
  retailer_charge_type: ChargeType;

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
// SHADVAL SETTLEMENT CHARGE
// ============================================================================

export interface SchemeShadvalSettlementCharge {
  id: string;
  scheme_id: string;
  transfer_mode: TransferMode;
  min_amount: number;
  max_amount: number;

  retailer_charge: number;
  retailer_charge_type: ChargeType;

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
  resolved_via: 'retailer_mapping' | 'partner_mapping' | 'distributor_mapping' | 'md_mapping' | 'global';
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
  is_partner_plan?: boolean;
}

export interface CreateBBPSCommissionInput {
  scheme_id: string;
  bbps_type?: BBPSType;
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
  card_classification?: string; // PLATINUM, GOLD, CLASSIC, BUSINESS, etc.
  retailer_mdr_t1: number;
  retailer_mdr_t0: number;
  distributor_mdr_t1: number;
  distributor_mdr_t0: number;
  md_mdr_t1?: number;
  md_mdr_t0?: number;
  partner_mdr?: number | null;
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

export interface CreateAEPSSettlementChargeInput {
  scheme_id: string;
  min_amount?: number;
  max_amount?: number;
  retailer_charge: number;
  retailer_charge_type: ChargeType;
  distributor_commission?: number;
  distributor_commission_type?: ChargeType;
  md_commission?: number;
  md_commission_type?: ChargeType;
  company_charge?: number;
  company_charge_type?: ChargeType;
}

export interface CreateShadvalSettlementChargeInput {
  scheme_id: string;
  transfer_mode: TransferMode;
  min_amount?: number;
  max_amount?: number;
  retailer_charge: number;
  retailer_charge_type: ChargeType;
  distributor_commission?: number;
  distributor_commission_type?: ChargeType;
  md_commission?: number;
  md_commission_type?: ChargeType;
  company_charge?: number;
  company_charge_type?: ChargeType;
}

export interface CreateAEPSCommissionInput {
  scheme_id: string;
  transaction_type: AEPSTransactionType;
  min_amount?: number;
  max_amount?: number;
  base_commission: number;
  base_commission_type?: ChargeType;
  company_earning?: number;
  company_earning_type?: ChargeType;
  md_commission?: number;
  md_commission_type?: ChargeType;
  distributor_commission?: number;
  distributor_commission_type?: ChargeType;
  retailer_commission?: number;
  retailer_commission_type?: ChargeType;
  tds_percentage?: number;
}

// ============================================================================
// AEPS COMMISSION BREAKDOWN (resolved per transaction)
// ============================================================================

export interface AEPSCommissionBreakdown {
  base_commission: number;       // partner -> company pool
  company_earning: number;       // company profit
  md_commission: number;         // MD margin (gross, before TDS)
  distributor_commission: number;// DT margin (gross, before TDS)
  retailer_commission: number;   // RT earning (gross, before TDS)
  tds_percentage: number;
  // Net amounts after TDS (what is actually credited)
  md_net: number;
  distributor_net: number;
  retailer_net: number;
  tds_total: number;
  scheme_id: string;
  scheme_name: string;
  scheme_type: SchemeType;
  resolved_via: string;
}

