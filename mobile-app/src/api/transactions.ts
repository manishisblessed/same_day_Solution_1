import { api } from '@/lib/api';
import { Paginated, ServiceTxnRow } from './types';

export type ServiceFilter =
  | 'all' | 'pos' | 'bbps' | 'aeps' | 'settlement' | 'payout' | 'creditcard' | 'account_verification';

export function fetchServiceTransactions(params?: {
  service?: ServiceFilter;
  date_from?: string;
  date_to?: string;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  return api.get<Paginated<ServiceTxnRow>>('/api/reports/service-transactions', {
    service: params?.service ?? 'all',
    date_from: params?.date_from,
    date_to: params?.date_to,
    status: params?.status,
    search: params?.search,
    limit: params?.limit ?? 25,
    offset: params?.offset ?? 0,
  });
}

export function fetchPayoutReport(params?: {
  date_from?: string; date_to?: string; status?: string; search?: string; limit?: number; offset?: number;
}) {
  return api.get<Paginated<any>>('/api/reports/payout-report', {
    ...params, limit: params?.limit ?? 25, offset: params?.offset ?? 0,
  });
}

export function fetchBillPaymentReport(params?: {
  date_from?: string; date_to?: string; status?: string; provider?: string; search?: string; limit?: number; offset?: number;
}) {
  return api.get<Paginated<any>>('/api/reports/bill-payment-report', {
    ...params, limit: params?.limit ?? 25, offset: params?.offset ?? 0,
  });
}

export function fetchPosTransactions(params?: {
  page?: number; limit?: number; machine_id?: string; device_serial?: string;
  date_from?: string; date_to?: string; status?: string;
}) {
  return api.get<{ success: boolean; data: any[]; pagination: any }>('/api/razorpay/transactions', {
    page: params?.page ?? 1, limit: params?.limit ?? 25, ...params,
  });
}
