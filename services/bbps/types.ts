export interface BBPSBillDetails {
  biller_id: string
  consumer_number: string
  bill_amount: number
  due_date?: string
  bill_date?: string
  bill_number?: string
  consumer_name?: string
  reqId?: string
  additional_info?: Record<string, any>
}

export interface BBPSBiller {
  biller_id: string
  biller_name: string
  category?: string
  category_name?: string
  biller_alias?: string
  is_active?: boolean
  amount_exactness?: 'EXACT' | 'INEXACT' | 'ANY'
  support_bill_fetch?: boolean
  support_partial_payment?: boolean
  paymentMode?: string
  metadata?: Record<string, any>
}

export interface BBPSBillerInfo {
  billerId: string
  billerName: string
  billerCategory?: string
  billerInputParams?: any
  billerPaymentModes?: string
  amountExactness?: 'EXACT' | 'INEXACT' | 'ANY'
  supportBillFetch?: boolean
  supportPartialPayment?: boolean
  supportAdditionalInfo?: boolean
  enquiryId?: string
  [key: string]: any
}

export interface BBPSPaymentRequest {
  biller_id: string
  consumer_number: string
  amount: number
  agent_transaction_id: string
  reqId?: string
}

export interface BBPSPaymentResponse {
  success: boolean
  transaction_id?: string
  agent_transaction_id?: string
  status?: string
  payment_status?: string
  bill_amount?: number
  amount_paid?: number
  error_code?: string
  error_message?: string
  reqId?: string
}

export interface BBPSComplaintRequest {
  transaction_id: string
  complaint_type: string
  description: string
  complaint_disposition?: string
}

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

export interface BBPSComplaintTracking {
  complaint_id: string
  status: string
  complaint_type?: string
  description?: string
  resolution?: string
  [key: string]: any
}

export interface BBPSTransactionStatus {
  transaction_id: string
  status: string
  payment_status?: string
  amount?: number
  response_code?: string
  response_reason?: string
  txn_reference_id?: string
  totalAmount?: number
  serviceCharge?: number
  transactionAmount?: number
  referenceNo?: string
  remark?: string
  compalainRegisterDes?: any
  compalainRegisterStatus?: boolean
  reqId?: string
}
