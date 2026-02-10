/**
 * BBPS API Types
 * Type definitions for SparkUpTech BBPS API requests and responses
 */

/**
 * BBPS Biller Information
 */
export interface BBPSBiller {
  biller_id: string
  biller_name: string
  category?: string
  category_name?: string
  biller_alias?: string
  is_active?: boolean
  params?: string[]
  amount_exactness?: 'EXACT' | 'INEXACT' | 'ANY'
  support_bill_fetch?: boolean
  support_partial_payment?: boolean
  support_additional_info?: boolean
  paymentMode?: string // Payment mode (e.g., "Cash", "Wallet", "UPI", etc.)
  metadata?: Record<string, any>
}

/**
 * BBPS Bill Details
 */
export interface BBPSBillDetails {
  biller_id: string
  consumer_number: string
  bill_amount: number
  due_date?: string
  bill_date?: string
  bill_number?: string
  consumer_name?: string
  additional_info?: Record<string, any>
  reqId?: string
}

/**
 * BBPS Payment Request
 */
export interface BBPSPaymentRequest {
  biller_id: string
  consumer_number: string
  amount: number
  agent_transaction_id: string
  additional_info?: Record<string, any>
  reqId?: string
}

/**
 * BBPS Payment Response
 */
export interface BBPSPaymentResponse {
  success: boolean
  transaction_id?: string
  agent_transaction_id?: string
  status?: string
  payment_status?: string
  error_code?: string
  error_message?: string
  bill_amount?: number
  amount_paid?: number
  reqId?: string
}

/**
 * BBPS Biller Info Response
 */
export interface BBPSBillerInfo {
  billerId: string
  billerName: string
  billerCategory?: string
  billerInputParams?: Record<string, any>
  billerPaymentModes?: string
  amountExactness?: 'EXACT' | 'INEXACT' | 'ANY'
  supportBillFetch?: boolean
  supportPartialPayment?: boolean
  supportAdditionalInfo?: boolean
  [key: string]: any
}

/**
 * BBPS Transaction Status Response
 */
export interface BBPSTransactionStatus {
  transaction_id: string
  status: string
  payment_status?: string
  amount?: number
  response_code?: string
  response_reason?: string
  txn_reference_id?: string
  [key: string]: any
}

/**
 * BBPS Complaint Registration Request
 */
export interface BBPSComplaintRequest {
  transaction_id: string
  complaint_type: string
  description: string
  complaint_disposition?: string
}

/**
 * BBPS Complaint Registration Response
 */
export interface BBPSComplaintResponse {
  success: boolean
  complaint_id?: string
  transaction_id?: string
  status?: string
  message?: string
  error_code?: string
  error_message?: string
  complaint_assigned?: string
  response_code?: string
  response_reason?: string
  transaction_details?: string
}

/**
 * BBPS Complaint Tracking Response
 */
export interface BBPSComplaintTracking {
  complaint_id: string
  status: string
  complaint_type?: string
  description?: string
  resolution?: string
  [key: string]: any
}

/**
 * BBPS API Error Response
 */
export interface BBPSApiError {
  success: false
  error_code: string
  error_message: string
  status?: number
  reqId?: string
}

/**
 * BBPS API Success Response
 */
export interface BBPSApiSuccess<T = any> {
  success: true
  data: T
  message?: string
  status?: number | string
  reqId?: string
}

/**
 * BBPS API Response (union type)
 */
export type BBPSApiResponse<T = any> = BBPSApiSuccess<T> | BBPSApiError

