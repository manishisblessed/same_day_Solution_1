export type UserRole = 'retailer' | 'distributor' | 'master_distributor' | 'admin' | 'partner'

export interface Retailer {
  retailer_mdr_rate?: number // MDR rate charged to retailer (e.g., 0.02 for 2%)
  id: string
  partner_id: string
  name: string
  email: string
  phone: string
  business_name?: string
  address?: string
  city?: string
  state?: string
  pincode?: string
  gst_number?: string
  distributor_id?: string
  master_distributor_id?: string
  status: 'active' | 'inactive' | 'suspended'
  commission_rate?: number
  banking_payments_enabled?: boolean
  mini_atm_pos_enabled?: boolean
  aeps_enabled?: boolean
  aadhaar_pay_enabled?: boolean
  dmt_enabled?: boolean
  bbps_enabled?: boolean
  recharge_enabled?: boolean
  travel_enabled?: boolean
  cash_management_enabled?: boolean
  lic_enabled?: boolean
  insurance_enabled?: boolean
  // Bank account details (mandatory)
  bank_name?: string
  account_number?: string
  ifsc_code?: string
  bank_document_url?: string
  // Document fields
  aadhar_number?: string
  aadhar_attachment_url?: string // Legacy - kept for backward compatibility
  aadhar_front_url?: string
  aadhar_back_url?: string
  pan_number?: string
  pan_attachment_url?: string
  udhyam_number?: string
  udhyam_certificate_url?: string
  gst_certificate_url?: string
  verification_status?: string
  created_at: string
  updated_at: string
}

export interface Distributor {
  id: string
  partner_id: string
  name: string
  email: string
  phone: string
  business_name?: string
  address?: string
  city?: string
  state?: string
  pincode?: string
  gst_number?: string
  master_distributor_id?: string
  status: 'active' | 'inactive' | 'suspended'
  commission_rate?: number
  banking_payments_enabled?: boolean
  mini_atm_pos_enabled?: boolean
  aeps_enabled?: boolean
  aadhaar_pay_enabled?: boolean
  dmt_enabled?: boolean
  bbps_enabled?: boolean
  recharge_enabled?: boolean
  travel_enabled?: boolean
  cash_management_enabled?: boolean
  lic_enabled?: boolean
  insurance_enabled?: boolean
  approved_mdr_rate?: number // MDR rate approved by master distributor (e.g., 0.015 for 1.5%)
  mdr_approved_by?: string // Master distributor partner_id who approved
  mdr_approved_at?: string // Timestamp when MDR was approved
  // Bank account details (mandatory)
  bank_name?: string
  account_number?: string
  ifsc_code?: string
  bank_document_url?: string
  // Document fields
  aadhar_number?: string
  aadhar_attachment_url?: string // Legacy - kept for backward compatibility
  aadhar_front_url?: string
  aadhar_back_url?: string
  pan_number?: string
  pan_attachment_url?: string
  udhyam_number?: string
  udhyam_certificate_url?: string
  gst_certificate_url?: string
  verification_status?: string
  created_at: string
  updated_at: string
}

export interface MasterDistributor {
  id: string
  partner_id: string
  name: string
  email: string
  phone: string
  business_name?: string
  address?: string
  city?: string
  state?: string
  pincode?: string
  gst_number?: string
  status: 'active' | 'inactive' | 'suspended'
  commission_rate?: number
  banking_payments_enabled?: boolean
  mini_atm_pos_enabled?: boolean
  aeps_enabled?: boolean
  aadhaar_pay_enabled?: boolean
  dmt_enabled?: boolean
  bbps_enabled?: boolean
  recharge_enabled?: boolean
  travel_enabled?: boolean
  cash_management_enabled?: boolean
  lic_enabled?: boolean
  insurance_enabled?: boolean
  approved_mdr_rate?: number // MDR rate approved by company/admin (e.g., 0.01 for 1%)
  mdr_approved_by?: string // Admin user ID who approved
  mdr_approved_at?: string // Timestamp when MDR was approved
  // Bank account details (mandatory)
  bank_name?: string
  account_number?: string
  ifsc_code?: string
  bank_document_url?: string
  // Document fields
  aadhar_number?: string
  aadhar_attachment_url?: string // Legacy - kept for backward compatibility
  aadhar_front_url?: string
  aadhar_back_url?: string
  pan_number?: string
  pan_attachment_url?: string
  udhyam_number?: string
  udhyam_certificate_url?: string
  gst_certificate_url?: string
  verification_status?: string
  created_at: string
  updated_at: string
}

export interface AdminUser {
  id: string
  email: string
  name: string
  role: 'admin'
  created_at: string
}

export interface Partner {
  id: string
  name: string
  business_name: string
  email: string
  phone: string
  gst_number?: string
  pan_number?: string
  address?: string
  city?: string
  state?: string
  pincode?: string
  status: 'active' | 'inactive' | 'suspended'
  webhook_url?: string
  ip_whitelist?: string[]
  metadata?: Record<string, any>
  created_at: string
  updated_at: string
}

export interface AuthUser {
  id: string
  email: string
  role: UserRole
  partner_id?: string
  name?: string
  is_impersonated?: boolean
  original_admin_id?: string
  impersonation_session_id?: string
}

export interface POSMachine {
  id: string
  machine_id: string
  serial_number?: string  // Device Serial Number (e.g., 2841154268)
  mid?: string  // Merchant ID (e.g., 7568516041)
  tid?: string  // Terminal ID (e.g., 29196333)
  brand?: 'RAZORPAY' | 'PINELAB' | 'PAYTM' | 'ICICI' | 'HDFC' | 'AXIS' | 'OTHER'
  retailer_id?: string  // nullable for hierarchical assignment (MD/Distributor can hold without retailer)
  distributor_id?: string
  master_distributor_id?: string
  partner_id?: string  // UUID reference to partners table - allows direct assignment to co-branding partners
  machine_type: 'POS' | 'WPOS' | 'Mini-ATM'
  status: 'active' | 'inactive' | 'maintenance' | 'damaged' | 'returned'
  inventory_status?: 'in_stock' | 'received_from_bank' | 'assigned_to_master_distributor' | 'assigned_to_distributor' | 'assigned_to_retailer' | 'assigned_to_partner' | 'damaged_from_bank'
  assigned_by?: string
  assigned_by_role?: 'admin' | 'master_distributor' | 'distributor'
  last_assigned_at?: string
  delivery_date?: string
  installation_date?: string
  location?: string
  city?: string
  state?: string
  pincode?: string
  notes?: string
  created_at: string
  updated_at: string
}

// POS Assignment History (audit trail)
export interface POSAssignmentHistory {
  id: string
  pos_machine_id: string
  machine_id: string
  action: 'created' | 'assigned_to_master_distributor' | 'assigned_to_distributor' | 'assigned_to_retailer' | 'assigned_to_partner' | 'unassigned_from_master_distributor' | 'unassigned_from_distributor' | 'unassigned_from_retailer' | 'unassigned_from_partner' | 'reassigned'
  assigned_by: string
  assigned_by_role: 'admin' | 'master_distributor' | 'distributor'
  assigned_to?: string
  assigned_to_role?: 'master_distributor' | 'distributor' | 'retailer' | 'partner'
  previous_holder?: string
  previous_holder_role?: 'master_distributor' | 'distributor' | 'retailer' | 'partner'
  notes?: string
  created_at: string
}

// Razorpay POS Transaction Types
export interface POSTerminal {
  id: string
  tid: string
  machine_id: string
  retailer_id: string
  distributor_id?: string
  master_distributor_id?: string
  razorpay_terminal_id?: string
  status: 'active' | 'inactive' | 'suspended'
  created_at: string
  updated_at: string
}

export type TransactionStatus = 'pending' | 'authorized' | 'captured' | 'failed' | 'refunded' | 'partially_refunded'

export interface RazorpayTransaction {
  id: string
  razorpay_payment_id?: string
  tid: string
  rrn?: string
  retailer_id: string
  distributor_id?: string
  master_distributor_id?: string
  gross_amount: number
  mdr: number
  net_amount: number
  payment_mode?: string
  auth_code?: string
  status: TransactionStatus
  razorpay_status?: string
  wallet_credited: boolean
  wallet_credit_id?: string
  created_at: string
  updated_at: string
  transaction_timestamp?: string
  metadata?: Record<string, any>
}

export type WalletTransactionType = 'POS_CREDIT' | 'PAYOUT' | 'REFUND' | 'ADJUSTMENT' | 'COMMISSION' | 'BBPS_DEBIT' | 'BBPS_REFUND'

export interface WalletLedgerEntry {
  id: string
  retailer_id: string
  transaction_id?: string
  transaction_type: WalletTransactionType
  amount: number
  balance_after: number
  description?: string
  reference_id?: string
  created_at: string
}

export interface Commission {
  id: string
  transaction_id: string
  retailer_id: string
  distributor_id?: string
  master_distributor_id?: string
  commission_type?: 'retailer' | 'distributor' | 'master_distributor'
  commission_rate?: number
  commission_amount: number
  status: 'pending' | 'credited' | 'cancelled'
  created_at: string
}

// Razorpay Webhook Types
export interface RazorpayWebhookPayload {
  entity: string
  account_id: string
  event: string
  contains: string[]
  payload: {
    payment: {
      entity: {
        id: string
        entity: string
        amount: number
        currency: string
        status: string
        order_id: string
        invoice_id: string | null
        international: boolean
        method: string
        amount_refunded: number
        refund_status: string | null
        captured: boolean
        description: string
        card_id: string | null
        bank: string | null
        wallet: string | null
        vpa: string | null
        email: string
        contact: string
        notes: Record<string, any>
        fee: number
        tax: number
        error_code: string | null
        error_description: string | null
        error_source: string | null
        error_step: string | null
        error_reason: string | null
        acquirer_data: Record<string, any>
        created_at: number
        terminal_id?: string
        rrn?: string
        auth_code?: string
      }
    }
  }
  created_at: number
}

// Transaction Filter Types
export interface TransactionFilters {
  dateFrom?: string
  dateTo?: string
  tid?: string
  rrn?: string
  status?: TransactionStatus | 'all'
  retailer_id?: string
  distributor_id?: string
  master_distributor_id?: string
  minAmount?: number
  maxAmount?: number
  page?: number
  limit?: number
  sortBy?: 'created_at' | 'gross_amount' | 'net_amount'
  sortOrder?: 'asc' | 'desc'
}

export interface TransactionListResponse {
  transactions: RazorpayTransaction[]
  total: number
  page: number
  limit: number
  totalPages: number
}

// BBPS Transaction Types
export type BBPSTransactionStatus = 'pending' | 'initiated' | 'success' | 'failed' | 'reversed' | 'refunded'

export interface BBPSTransaction {
  id: string
  retailer_id: string
  distributor_id?: string
  master_distributor_id?: string
  biller_id: string
  biller_name?: string
  consumer_number: string
  consumer_name?: string
  bill_amount: number
  amount_paid: number
  transaction_id?: string
  agent_transaction_id?: string
  status: BBPSTransactionStatus
  payment_status?: string
  bill_fetch_status?: string
  due_date?: string
  bill_date?: string
  bill_number?: string
  additional_info?: Record<string, any>
  error_code?: string
  error_message?: string
  wallet_debited: boolean
  wallet_debit_id?: string
  commission_rate?: number
  commission_amount?: number
  created_at: string
  updated_at: string
  completed_at?: string
}

export interface BBPSBiller {
  id: string
  biller_id: string
  biller_name: string
  category?: string
  category_name?: string
  biller_alias?: string
  is_active: boolean
  params?: string[]
  amount_exactness?: 'EXACT' | 'INEXACT' | 'ANY'
  support_bill_fetch: boolean
  support_partial_payment: boolean
  support_additional_info: boolean
  metadata?: Record<string, any>
  created_at: string
  updated_at: string
}

// Razorpay POS Transaction Types (Phase 1)
export type InstaCashSettlementMode = 'INSTACASH' | 'AUTO_T1'

export interface RazorpayPOSTransaction {
  id: string
  txn_id: string
  status: string
  display_status: 'SUCCESS' | 'FAILED' | 'PENDING'
  amount: number
  payment_mode: string | null
  device_serial: string | null
  tid: string | null
  merchant_name: string | null
  transaction_time: string | null
  created_at: string
  updated_at: string
  raw_data?: Record<string, any>
  // Detailed fields
  customer_name: string | null
  payer_name: string | null
  username: string | null
  txn_type: string | null
  auth_code: string | null
  card_number: string | null
  issuing_bank: string | null
  card_classification: string | null
  card_txn_type: string | null
  acquiring_bank: string | null
  mid_code: string | null
  card_brand: string | null
  card_type: string | null
  currency: string | null
  rrn: string | null
  external_ref: string | null
  settlement_status: string | null
  settled_on: string | null
  receipt_url: string | null
  posting_date: string | null
  // InstaCash / Settlement tracking
  settlement_mode: InstaCashSettlementMode | null
  wallet_credited: boolean
  wallet_credit_id: string | null
  retailer_id: string | null
  distributor_id: string | null
  master_distributor_id: string | null
  gross_amount: number | null
  mdr_amount: number | null
  net_amount: number | null
  mdr_rate: number | null
  mdr_scheme_id: string | null
  mdr_scheme_type: string | null
  instacash_requested_at: string | null
  instacash_batch_id: string | null
  auto_settled_at: string | null
}

// InstaCash Batch Types
export interface InstaCashBatch {
  id: string
  retailer_id: string
  total_transactions: number
  total_gross_amount: number
  total_mdr_amount: number
  total_net_amount: number
  status: 'processing' | 'completed' | 'partial' | 'failed'
  success_count: number
  failed_count: number
  wallet_credit_id: string | null
  requested_at: string
  completed_at: string | null
  created_at: string
  metadata: Record<string, any> | null
}

export interface InstaCashBatchItem {
  id: string
  batch_id: string
  pos_transaction_id: string
  txn_id: string
  gross_amount: number
  mdr_rate: number
  mdr_amount: number
  net_amount: number
  card_type: string | null
  card_brand: string | null
  card_classification: string | null
  payment_mode: string | null
  scheme_id: string | null
  scheme_type: string | null
  status: 'pending' | 'settled' | 'failed' | 'skipped'
  error_message: string | null
  created_at: string
}

// POS Device Mapping Types (Phase 2)
export interface POSDeviceMapping {
  id: string
  device_serial: string
  tid: string | null
  retailer_id: string | null
  distributor_id: string | null
  master_distributor_id: string | null
  status: 'ACTIVE' | 'INACTIVE'
  created_at: string
  updated_at: string
}

