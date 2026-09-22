import { api } from '@/lib/api';

export interface BbpsCategory { id?: string; name: string; group?: string }
export interface BbpsBiller {
  biller_id: string;
  biller_name: string;
  category?: string;
  [k: string]: any;
}

export function fetchBbpsCategories() {
  return api.get<{ success: boolean; categories: BbpsCategory[]; groups: string[]; count: number }>(
    '/api/bbps/categories'
  );
}

export function fetchBbpsBillers(category: string) {
  return api.get<{ success: boolean; billers: BbpsBiller[]; count: number }>('/api/bbps/billers', { category });
}

export function fetchBillerInfo(biller_id: string) {
  return api.post<{ success: boolean; biller_info: any }>('/api/bbps/biller-info', { biller_id });
}

export function fetchBill(input: {
  biller_id: string;
  consumer_number?: string;
  input_params?: Record<string, string>;
  additional_params?: Record<string, string>;
}) {
  return api.post<{ success: boolean; status: string; message: string; data: any; reqId: string; bill: any }>(
    '/api/bbps/bill/fetch',
    input
  );
}

export function payBill(input: {
  biller_id: string;
  consumer_number: string;
  amount: number; // paise
  biller_name: string;
  tpin: string;
  reqId?: string;
  consumer_name?: string;
  biller_category?: string;
  customer_mobile?: string;
  pan_number?: string;
}) {
  return api.post<{
    success: boolean;
    transaction_id: string;
    bbps_transaction_id?: string;
    status: string;
    payment_status?: string;
    error_code?: string;
    error_message?: string;
    wallet_balance?: number;
  }>('/api/bbps/bill/pay', input, { idempotent: true });
}

export function bbpsTransactionStatus(transaction_id: string) {
  return api.post<{ success: boolean; status: string; message: string; data: any }>(
    '/api/bbps/transaction-status',
    { transaction_id }
  );
}
