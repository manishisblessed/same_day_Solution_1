import { api } from '@/lib/api';

export interface Pay2NewBiller {
  product_code: string;
  product_name: string;
  [k: string]: any;
}

/** service_id per Pay2New servicesList (1=prepaid, 3=DTH, 8=electricity, 34=credit card, …). */
export function fetchPay2NewBillers(service_id: number) {
  return api.get<{ success: boolean; service_id: number; billers: Pay2NewBiller[]; count: number }>(
    '/api/pay2new/billers',
    { service_id }
  );
}

export function fetchPay2NewCharges(amount: number) {
  return api.get<{
    success: boolean; amount: number; scheme_name: string;
    charges: { base_charge: number; gst_percent: number; gst_amount: number; total_charge: number };
  }>('/api/pay2new/charges', { amount });
}

export function fetchPay2NewBill(input: {
  number: string;
  product_code: string;
  customer_number: string;
  product_name?: string;
  optional1?: string;
}) {
  return api.post<{
    success: boolean; data: any; order_id: string; request_id: string;
    error?: string; fallback?: string; biller_id?: string;
  }>('/api/pay2new/bill/fetch', input);
}

export function payPay2NewBill(input: {
  number: string;
  amount: number;
  product_code: string;
  bill_fetch_ref: string;
  customer_number: string;
  tpin: string;
  product_name?: string;
  pan_number?: string;
  customer_name?: string;
  optional1?: string;
  use_bbps?: boolean;
  biller_id?: string;
}) {
  return api.post<{ success: boolean; order_id: string; operator_reference: string; amount: number; charge: number; request_id: string }>(
    '/api/pay2new/bill/pay',
    input,
    { idempotent: true }
  );
}

export function pay2NewRecharge(input: {
  number: string;
  amount: number;
  product_code: string;
}) {
  return api.post<{ success: boolean; order_id: string; operator_reference: string; amount: number; balance: number; request_id: string }>(
    '/api/pay2new/recharge',
    input,
    { idempotent: true }
  );
}
