/** Status codes from Rechargekit CC API */
export const RECHARGEKIT_STATUS = {
  SUCCESS: 1,
  PENDING: 2,
  FAILED: 3,
} as const

export type RechargekitStatusCode =
  (typeof RECHARGEKIT_STATUS)[keyof typeof RECHARGEKIT_STATUS]

export interface RechargekitOperator {
  operator_id: string
  operator_name: string
  operator_code?: string
  operator_ifsc?: string
  [key: string]: unknown
}

export interface RechargekitCcPaymentRequest {
  mobile_no: string
  account_no: string
  ifsc: string
  bank_name: string
  beneficiary_name: string
  amount: number | string
  partner_request_id: string
  operator_code: string
  /** Bank transfer rail. '5' = IMPS, '6' = NEFT (CC endpoint also allows 15/16) */
  transfer_type: string
}

/** Rechargekit transfer rails. Value is sent as a string in the payload. */
export const RECHARGEKIT_TRANSFER_TYPE = {
  IMPS: '5',
  NEFT: '6',
} as const

export interface RechargekitCcPaymentResponse {
  status: number
  message?: string
  txn_id?: string
  transaction_id?: string
  operator_ref?: string
  operator_reference?: string
  partner_request_id?: string
  amount?: number | string
  [key: string]: unknown
}
