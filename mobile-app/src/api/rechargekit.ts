import { api } from '@/lib/api';

export interface RkOperator { operator_code: string; operator_name: string; [k: string]: any }

export function fetchRkOperators() {
  return api.get<{ success: boolean; operators: RkOperator[]; count: number }>('/api/rechargekit/operators');
}

export function fetchRkCharges(amount: number) {
  return api.get<{
    success: boolean; amount: number; scheme_name: string;
    charges: { base_charge: number; gst_percent: number; gst_amount: number; total_charge: number };
  }>('/api/rechargekit/charges', { amount });
}

export function rkPay(input: {
  mobile_no: string;
  account_no: string;
  ifsc: string;
  bank_name: string;
  beneficiary_name: string;
  amount: number;
  operator_code: string;
  operator_name?: string;
  tpin: string;
}) {
  return api.post<{
    success: boolean; pending?: boolean; order_id: string; operator_reference: string;
    amount: number; charge: number; request_id: string; message: string;
  }>('/api/rechargekit/pay', input, { idempotent: true });
}

export function rkStatus(request_id: string) {
  return api.get<{ success: boolean; status: string; message: string; request_id: string; refunded?: boolean }>(
    '/api/rechargekit/status',
    { request_id }
  );
}
