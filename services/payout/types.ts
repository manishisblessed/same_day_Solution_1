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
  // Additional fields from API
  sprintBankID?: number
  iPayBankID?: number
  pdrsBankID?: number
  pay1MoneyBankID?: number
  accountNo?: string | null
  npcicode?: string | null
  isaepsStatus?: boolean
  isNotLive?: boolean
  isVirtual?: boolean
}

/**
 * Balance response - matches /api/wallet/getBalance
 */
export interface PayoutBalanceResponse {
  success: boolean
  status?: number
  message?: string
  data?: {
    _id?: string
    balance?: number
    lien?: number
    is_active?: boolean
    created_at?: string
    created_by?: string
    updated_at?: string
    updated_by?: string
    first_name?: string
    middle_name?: string
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
  bankId?: number
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
 * Transfer request - matches expressPay2 API
 */
export interface TransferRequest {
  accountNumber: string
  ifscCode: string
  accountHolderName: string
  amount: number
  transferMode: 'IMPS' | 'NEFT'
  bankId: number          // Required: BankID from bank list
  bankName: string        // Required: Bank name
  beneficiaryMobile: string // Required: Beneficiary mobile
  senderName: string      // Required: Sender name
  senderMobile: string    // Required: Sender mobile
  senderEmail?: string    // Optional: Sender email
  remarks?: string
  clientRefId?: string    // Our internal reference ID (becomes APIRequestID)
  webhookUrl?: string     // Optional: Webhook URL for callbacks
}

/**
 * Express Pay API Request Body - exact format for expressPay2
 */
export interface ExpressPayRequestBody {
  AccountNo: string
  AmountR: number
  APIRequestID: number
  BankID: number
  BeneMobile: string
  BeneName: string
  bankName: string
  IFSC: string
  SenderEmail: string
  SenderMobile: string
  SenderName: string
  paymentType: 'IMPS' | 'NEFT'
  WebHook: string
  extraParam1: string
  extraParam2: string
  extraField1: string
  sub_service_name: string
  remark: string
}

/**
 * Transfer response - matches expressPay2 API response
 */
export interface TransferResponse {
  success: boolean
  message?: string
  data?: {
    clientReqId?: number      // API returns this
    totalAmount?: number
    serviceCharge?: number
    transactionAmount?: number
    referenceNo?: string | null
    transaction_id?: string   // UTR number
    status?: string           // 'pending', 'success', 'failed'
    remark?: string
    paymentType?: string
  }
  error?: string
}

/**
 * Transfer status request
 */
export interface TransferStatusRequest {
  transactionId: string   // Required: UTR transaction ID
}

/**
 * Transfer status response - matches statusCheck API
 */
export interface TransferStatusResponse {
  success: boolean
  status?: number
  data?: {
    status?: number          // 2 = SUCCESS, 1 = PENDING, 0 = FAILED
    msg?: string             // 'SUCCESS', 'PENDING', 'FAILED'
    bal?: number             // Remaining balance
    errorcode?: string
    account?: string         // Account number
    amount?: number
    rpid?: string            // Reference ID
    agentid?: string
    opid?: string            // Operator ID / RRN
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

