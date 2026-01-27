/**
 * Express Pay Payout API Types
 */

/**
 * Bank information from bank list API
 */
export interface PayoutBank {
  id: number
  bankName: string
  code: string
  bankType: string
  ifsc: string
  iin: number
  isIMPS: boolean
  isNEFT: boolean
  isACVerification: boolean
  isPopular: boolean
  logo?: string
  accountLimit?: number
}

/**
 * Balance response
 */
export interface PayoutBalanceResponse {
  success: boolean
  status?: number
  message?: string
  data?: {
    balance?: number
    lien?: number
    is_active?: boolean
    first_name?: string
    last_name?: string
    email?: string
    mobile?: string
    client_id?: string
  }
}

/**
 * Bank list response
 */
export interface BankListResponse {
  success: boolean
  status?: number
  message?: string
  data?: PayoutBank[]
}

/**
 * Account verification request
 */
export interface VerifyAccountRequest {
  accountNumber: string
  ifscCode: string
  bankName?: string
}

/**
 * Account verification response
 */
export interface VerifyAccountResponse {
  success: boolean
  status?: number
  message?: string
  data?: {
    accountNumber?: string
    ifsc?: string
    accountHolderName?: string
    bankName?: string
    branchName?: string
    isValid?: boolean
    transactionId?: string
  }
  error?: string
}

/**
 * Transfer request
 */
export interface TransferRequest {
  accountNumber: string
  ifscCode: string
  accountHolderName: string
  amount: number
  transferMode: 'IMPS' | 'NEFT'
  remarks?: string
  clientRefId?: string // Our internal reference ID
}

/**
 * Transfer response
 */
export interface TransferResponse {
  success: boolean
  status?: number
  message?: string
  data?: {
    transactionId?: string // SparkUp transaction ID
    clientRefId?: string // Our reference ID
    rrn?: string // Bank RRN
    status?: 'PENDING' | 'SUCCESS' | 'FAILED' | 'PROCESSING'
    amount?: number
    charges?: number
    accountNumber?: string
    ifsc?: string
    accountHolderName?: string
    bankName?: string
    transferMode?: string
    timestamp?: string
  }
  error?: string
}

/**
 * Transfer status request
 */
export interface TransferStatusRequest {
  transactionId?: string
  clientRefId?: string
}

/**
 * Transfer status response
 */
export interface TransferStatusResponse {
  success: boolean
  status?: number
  message?: string
  data?: {
    transactionId?: string
    clientRefId?: string
    rrn?: string
    status?: 'PENDING' | 'SUCCESS' | 'FAILED' | 'PROCESSING'
    amount?: number
    charges?: number
    accountNumber?: string
    ifsc?: string
    accountHolderName?: string
    bankName?: string
    transferMode?: string
    failureReason?: string
    timestamp?: string
    completedAt?: string
  }
  error?: string
}

/**
 * Payout transaction for database
 */
export interface PayoutTransaction {
  id?: string
  retailer_id: string
  distributor_id?: string
  master_distributor_id?: string
  account_number: string
  ifsc_code: string
  account_holder_name: string
  bank_name?: string
  amount: number
  charges: number
  transfer_mode: 'IMPS' | 'NEFT'
  client_ref_id: string
  transaction_id?: string // SparkUp transaction ID
  rrn?: string
  status: 'pending' | 'processing' | 'success' | 'failed' | 'refunded'
  failure_reason?: string
  remarks?: string
  wallet_debited: boolean
  wallet_debit_id?: string
  created_at?: string
  updated_at?: string
  completed_at?: string
}

/**
 * Payout result for UI
 */
export interface PayoutResult {
  success: boolean
  message: string
  transactionId?: string
  clientRefId?: string
  rrn?: string
  status?: string
  amount?: number
  charges?: number
  error?: string
}

