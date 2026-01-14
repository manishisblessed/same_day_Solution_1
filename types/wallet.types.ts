/**
 * Wallet and Ledger Type Definitions
 * Extended types for unified ledger system
 */

export type WalletType = 'primary' | 'aeps'

export type FundCategory = 'cash' | 'online' | 'commission' | 'settlement' | 'adjustment' | 'aeps' | 'bbps' | 'other'

export type ServiceType = 'bbps' | 'aeps' | 'settlement' | 'pos' | 'admin' | 'other'

export type LedgerStatus = 'pending' | 'completed' | 'failed' | 'reversed' | 'hold'

export type LimitType = 'per_transaction' | 'daily_transaction' | 'daily_settlement'

export type SettlementMode = 'instant' | 't+1'

export type SettlementStatus = 'pending' | 'processing' | 'success' | 'failed' | 'reversed' | 'hold'

export type AEPSTransactionType = 'balance_inquiry' | 'cash_withdrawal' | 'aadhaar_to_aadhaar' | 'mini_statement'

export type AEPSStatus = 'pending' | 'success' | 'failed' | 'reversed' | 'under_reconciliation'

export type DisputeStatus = 'open' | 'under_review' | 'resolved' | 'rejected'

export type DisputeType = 'transaction_failure' | 'amount_mismatch' | 'duplicate_charge' | 'unauthorized' | 'other'

export type ReversalStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'hold'

export interface Wallet {
  id: string
  user_id: string
  user_role: 'retailer' | 'distributor' | 'master_distributor'
  wallet_type: WalletType
  balance: number
  is_frozen: boolean
  is_settlement_held: boolean
  created_at: string
  updated_at: string
}

export interface UnifiedLedgerEntry {
  id: string
  retailer_id: string // For backward compatibility
  user_id?: string
  user_role?: 'retailer' | 'distributor' | 'master_distributor'
  wallet_type: WalletType
  fund_category: FundCategory
  service_type: ServiceType
  transaction_type: string
  transaction_id?: string
  credit: number
  debit: number
  opening_balance: number
  closing_balance: number
  reference_id?: string
  status: LedgerStatus
  description?: string
  remarks?: string
  created_at: string
}

export interface UserLimit {
  id: string
  user_id: string
  user_role: 'retailer' | 'distributor' | 'master_distributor'
  wallet_type: WalletType
  limit_type: LimitType
  limit_amount: number
  is_enabled: boolean
  is_overridden: boolean
  override_by?: string
  override_reason?: string
  created_at: string
  updated_at: string
}

export interface Settlement {
  id: string
  user_id: string
  user_role: 'retailer' | 'distributor' | 'master_distributor'
  settlement_mode: SettlementMode
  amount: number
  charge: number
  net_amount: number
  bank_account_number: string
  bank_ifsc: string
  bank_account_name: string
  status: SettlementStatus
  payout_reference_id?: string
  failure_reason?: string
  ledger_entry_id?: string
  reversal_ledger_id?: string
  idempotency_key: string
  created_at: string
  updated_at: string
  processed_at?: string
  completed_at?: string
}

export interface SettlementChargeSlab {
  id: string
  min_amount: number
  max_amount: number
  charge: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface BBPSLimitSlab {
  id: string
  slab_name: string
  min_amount: number
  max_amount: number
  is_enabled: boolean
  created_at: string
  updated_at: string
}

export interface AEPSTransaction {
  id: string
  user_id: string
  user_role: 'retailer' | 'distributor' | 'master_distributor'
  transaction_type: AEPSTransactionType
  is_financial: boolean
  amount?: number
  rrn?: string
  stan?: string
  aadhaar_number_masked?: string
  bank_iin?: string
  status: AEPSStatus
  error_code?: string
  error_message?: string
  wallet_debited: boolean
  wallet_debit_id?: string
  wallet_credited: boolean
  wallet_credit_id?: string
  mdr_amount?: number
  commission_rate?: number
  commission_amount?: number
  idempotency_key: string
  created_at: string
  updated_at: string
  completed_at?: string
}

export interface Reversal {
  id: string
  original_transaction_id: string
  transaction_type: 'bbps' | 'aeps' | 'settlement' | 'admin' | 'pos'
  user_id: string
  user_role: string
  original_amount: number
  reversal_amount: number
  reason: string
  status: ReversalStatus
  original_ledger_id?: string
  reversal_ledger_id?: string
  admin_id?: string
  ip_address?: string
  remarks?: string
  created_at: string
  updated_at: string
  completed_at?: string
}

export interface Dispute {
  id: string
  transaction_id: string
  transaction_type: 'bbps' | 'aeps' | 'settlement' | 'pos'
  user_id: string
  user_role: string
  dispute_type: DisputeType
  status: DisputeStatus
  description: string
  resolution?: string
  resolved_by?: string
  resolved_at?: string
  created_at: string
  updated_at: string
}

export interface AdminAuditLog {
  id: string
  admin_id: string
  action_type: string
  target_user_id?: string
  target_user_role?: string
  wallet_type?: WalletType
  fund_category?: FundCategory
  amount?: number
  before_balance?: number
  after_balance?: number
  ip_address?: string
  user_agent?: string
  remarks?: string
  metadata?: Record<string, any>
  created_at: string
}

export interface MDRConfig {
  id: string
  service_type: ServiceType
  user_role: 'retailer' | 'distributor' | 'master_distributor'
  mdr_rate: number
  is_active: boolean
  effective_from: string
  effective_to?: string
  created_at: string
  updated_at: string
}

export interface CommissionLedger {
  id: string
  transaction_id: string
  transaction_type: 'bbps' | 'aeps' | 'pos'
  user_id: string
  user_role: 'retailer' | 'distributor' | 'master_distributor'
  mdr_amount: number
  commission_rate: number
  commission_amount: number
  is_locked: boolean
  ledger_entry_id?: string
  created_at: string
  updated_at: string
}

