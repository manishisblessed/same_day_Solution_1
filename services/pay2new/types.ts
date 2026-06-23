/**
 * Pay2New API Types
 */

export interface Pay2NewApiResponse {
  status: number // 1 = success, 2 = error
  message: string
}

export interface Pay2NewBillFetchResponse extends Pay2NewApiResponse {
  data: {
    customer_name: string
    bill_period?: string
    bill_date?: string
    bill_due_date?: string
    bill_number?: string
    amount: string
    billDate?: string
    dueDate?: string
    'Minimum Amount Due'?: string
    'Maximum Permissible Amount'?: string
  } | []
  order_id: string | null
}

export interface Pay2NewBillPaymentResponse extends Pay2NewApiResponse {
  order_id?: string
  request_id?: string
  operator_reference?: string
  number?: string
  amount?: number | string
  balance?: string
}

export interface Pay2NewBalanceResponse extends Pay2NewApiResponse {
  balance: string
}

export interface Pay2NewProductListResponse extends Pay2NewApiResponse {
  data: Pay2NewProduct[]
}

export interface Pay2NewProduct {
  product_code: string
  product_name: string
  service_id: string
}

export interface Pay2NewBillFetchRequest {
  number: string
  product_code: string
  request_id: string
  optional1?: string
  optional2?: string
  optional3?: string
  optional4?: string
  customer_number: string
  pincode: string
  latitude: string
  longitude: string
  ip: string
  outletId: number
}

export interface Pay2NewBillPaymentRequest {
  number: string
  amount: number
  product_code: string
  request_id: string
  bill_fetch_ref: string
  optional1?: string
  optional2?: string
  optional3?: string
  optional4?: string
  customer_number: string
  pincode: string
  latitude: string
  longitude: string
  ip: string
  outletId: string
}
