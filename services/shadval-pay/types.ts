/**
 * SHADVAL PAY PRIVATE LIMITED - API Types
 */

export interface ShadvalBaseResponse {
  status: 'SUCCESS' | 'FAILED' | 'PENDING'
  code: string
  message: string
}

export interface ShadvalBalanceResponse extends ShadvalBaseResponse {
  data?: {
    balance: number
  }
}

export interface ShadvalFundAccount {
  name: string
  ifsc: string
  account_number: string
}

export interface ShadvalContactDetails {
  name: string
  email: string
  mobile: string
}

export interface ShadvalTransferRequest {
  amount: number
  mode: 'IMPS' | 'NEFT' | 'RTGS'
  fund_account: ShadvalFundAccount
  contact_details: ShadvalContactDetails
  reference_id: string
  latitude: string
  longitude: string
  narration: string
}

export interface ShadvalWalletInfo {
  trans_amount: number
  charges: number
  total_value: number
  trans_mode: string
}

export interface ShadvalTransferResponse extends ShadvalBaseResponse {
  data?: {
    reference_id: string
    order_id: string
    trans_amount: number
    utr: string
    mode: string
    internal_ref_id: string
    wallet: ShadvalWalletInfo
    fund_account: ShadvalFundAccount
    timestamp: string
  }
}

export interface ShadvalStatusRequest {
  reference_id: string
}

export interface ShadvalStatusResponse extends ShadvalBaseResponse {
  data?: {
    txn_datetime: string
    txn_status: string
    reference_id: string
    status_message?: string
    order_id: string
    trans_amount: number
    utr: string
    mode: string
    internal_ref_id: string
    wallet: {
      transaction: ShadvalWalletInfo & {
        debit_datetime: string
      }
      reversal?: ShadvalWalletInfo & {
        reversal_datetime: string
      }
    }
    fund_account: ShadvalFundAccount
    timestamp: string
  }
}

/** Internal transaction record for DB/UI */
export interface ShadvalPayTransaction {
  id?: string
  retailer_id: string
  reference_id: string
  order_id?: string
  internal_ref_id?: string
  utr?: string
  account_number: string
  ifsc_code: string
  account_holder_name: string
  amount: number
  charges: number
  total_value: number
  mode: 'IMPS' | 'NEFT' | 'RTGS'
  status: 'SUCCESS' | 'FAILED' | 'PENDING'
  status_message?: string
  failure_reason?: string
  narration?: string
  contact_name?: string
  contact_email?: string
  contact_mobile?: string
  latitude?: string
  longitude?: string
  provider: 'shadval_pay'
  created_at?: string
  updated_at?: string
}

/** Response codes from SHADVAL PAY */
export const SHADVAL_CODES = {
  SP100: 'Success',
  SP103: 'Provide valid Content-Type in header',
  SP104: 'Wrong authorization token / IP not whitelisted / Bad Request',
  SP105: 'Duplicate reference number',
  SP106: 'Transaction not found for this reference_id',
} as const
