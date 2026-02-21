/**
 * MDR Scheme Engine TypeScript Types
 * 
 * Types for the Distributor → Retailer MDR Scheme Engine
 * with Razorpay settlement and Supabase database.
 */

export type PaymentMode = 'CARD' | 'UPI';
export type CardType = 'CREDIT' | 'DEBIT' | 'PREPAID';
export type SettlementType = 'T0' | 'T1';
export type SchemeStatus = 'active' | 'inactive';
export type TransactionSettlementStatus = 'pending' | 'completed' | 'failed';
export type SchemeType = 'global' | 'custom';

/**
 * Global Scheme
 * Default MDR schemes that apply to all retailers
 */
export interface GlobalScheme {
  id: string;
  mode: PaymentMode;
  card_type: CardType | null;
  brand_type: string | null; // VISA, MasterCard, etc.
  card_classification: string | null; // PLATINUM, GOLD, CLASSIC, BUSINESS, etc.
  
  rt_mdr_t1: number; // Retailer MDR T+1
  rt_mdr_t0: number; // Retailer MDR T+0 (should be T+1 + 1%)
  dt_mdr_t1: number; // Distributor MDR T+1
  dt_mdr_t0: number; // Distributor MDR T+0 (should be T+1 + 1%)
  
  status: SchemeStatus;
  effective_date: string;
  created_at: string;
  updated_at: string;
}

/**
 * Retailer Scheme (Custom Scheme)
 * Distributor-defined custom MDR schemes for specific retailers
 */
export interface RetailerScheme {
  id: string;
  distributor_id: string;
  retailer_id: string;
  
  mode: PaymentMode;
  card_type: CardType | null;
  brand_type: string | null;
  card_classification: string | null;
  
  retailer_mdr_t1: number;
  retailer_mdr_t0: number;
  distributor_mdr_t1: number;
  distributor_mdr_t0: number;
  
  status: SchemeStatus;
  effective_date: string;
  created_at: string;
  updated_at: string;
}

/**
 * Transaction Record
 * Stores transaction with MDR calculations and settlement details
 */
export interface Transaction {
  id: string;
  razorpay_payment_id: string;
  
  amount: number;
  settlement_type: SettlementType;
  
  mode: PaymentMode;
  card_type: CardType | null;
  brand_type: string | null;
  card_classification: string | null;
  
  retailer_id: string;
  distributor_id: string | null;
  
  // MDR rates used
  retailer_mdr_used: number;
  distributor_mdr_used: number;
  
  // Fee calculations
  retailer_fee: number;
  distributor_fee: number;
  distributor_margin: number;
  company_earning: number;
  
  // Settlement
  settlement_status: TransactionSettlementStatus;
  retailer_settlement_amount: number;
  
  // Wallet credit tracking
  retailer_wallet_credited: boolean;
  retailer_wallet_credit_id: string | null;
  distributor_wallet_credited: boolean;
  distributor_wallet_credit_id: string | null;
  admin_wallet_credited: boolean;
  admin_wallet_credit_id: string | null;
  
  // Scheme reference
  scheme_type: SchemeType | null;
  scheme_id: string | null;
  
  created_at: string;
  updated_at: string;
  metadata: Record<string, any> | null;
}

/**
 * Scheme Query Parameters
 * Used to find matching scheme for a transaction
 */
export interface SchemeQueryParams {
  mode: PaymentMode;
  card_type?: CardType | null;
  brand_type?: string | null;
  card_classification?: string | null;
  retailer_id?: string;
  distributor_id?: string;
}

/**
 * MDR Calculation Result
 * Result of MDR calculation for a transaction
 */
export interface MDRCalculationResult {
  retailer_mdr: number;
  distributor_mdr: number;
  retailer_fee: number;
  distributor_fee: number;
  distributor_margin: number;
  company_earning: number;
  retailer_settlement_amount: number;
  scheme_type: SchemeType;
  scheme_id: string | null;
}

/**
 * Settlement Calculation Input
 * Input parameters for settlement calculation
 */
export interface SettlementCalculationInput {
  amount: number;
  settlement_type: SettlementType;
  mode: PaymentMode;
  card_type?: CardType | null;
  brand_type?: string | null;
  card_classification?: string | null;
  retailer_id: string;
  distributor_id?: string | null;
}

/**
 * Wallet Credit Result
 * Result of wallet credit operation
 */
export interface WalletCreditResult {
  success: boolean;
  wallet_credit_id: string | null;
  error?: string;
}

/**
 * Transaction Creation Input
 * Input for creating a new transaction record
 */
export interface CreateTransactionInput {
  razorpay_payment_id: string;
  amount: number;
  settlement_type: SettlementType;
  mode: PaymentMode;
  card_type?: CardType | null;
  brand_type?: string | null;
  card_classification?: string | null;
  retailer_id: string;
  distributor_id?: string | null;
  metadata?: Record<string, any>;
}

/**
 * Global Scheme Creation Input
 */
export interface CreateGlobalSchemeInput {
  mode: PaymentMode;
  card_type?: CardType | null;
  brand_type?: string | null;
  card_classification?: string | null;
  rt_mdr_t1: number;
  dt_mdr_t1: number;
  status?: SchemeStatus;
  effective_date?: string;
}

/**
 * Retailer Scheme Creation Input
 */
export interface CreateRetailerSchemeInput {
  distributor_id: string;
  retailer_id: string;
  mode: PaymentMode;
  card_type?: CardType | null;
  brand_type?: string | null;
  card_classification?: string | null;
  retailer_mdr_t1: number;
  retailer_mdr_t0: number;
  distributor_mdr_t1: number;
  distributor_mdr_t0: number;
  status?: SchemeStatus;
  effective_date?: string;
}

/**
 * Razorpay Payment Entity
 * Structure of Razorpay payment data from webhook
 */
export interface RazorpayPaymentEntity {
  id: string;
  amount: number; // in paise
  currency: string;
  status: string;
  method: string; // 'card', 'upi', etc.
  card?: {
    network: string; // 'Visa', 'MasterCard', etc.
    type: string; // 'credit', 'debit', 'prepaid'
    last4: string;
    issuer: string;
  };
  vpa?: string; // UPI VPA
  notes?: {
    settlement_type?: 'T0' | 'T1';
    retailer_id?: string;
    distributor_id?: string;
    [key: string]: any;
  };
  created_at: number; // Unix timestamp
  [key: string]: any;
}

/**
 * Razorpay Webhook Payload
 */
export interface RazorpayWebhookPayload {
  event: string;
  payload: {
    payment: {
      entity: RazorpayPaymentEntity;
    };
  };
  [key: string]: any;
}

