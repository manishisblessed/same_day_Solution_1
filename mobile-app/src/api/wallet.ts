import { api } from '@/lib/api';
import { WalletBalanceResponse, WalletLedgerRow } from './types';

export type WalletType = 'primary' | 'aeps' | 'commission' | 'settlement';

export function fetchWalletBalance(wallet_type: WalletType = 'primary') {
  return api.get<WalletBalanceResponse>('/api/wallet/balance', { wallet_type });
}

export function fetchWalletTransactions(params?: { limit?: number; offset?: number; type?: string }) {
  return api.get<{
    success: boolean;
    transactions: WalletLedgerRow[];
    total: number;
    balance: number;
    limit: number;
    offset: number;
  }>('/api/wallet/transactions', {
    limit: params?.limit ?? 50,
    offset: params?.offset ?? 0,
    type: params?.type,
  });
}

export interface PushPullEntry {
  id: string;
  created_at: string;
  action_type: 'push' | 'pull';
  amount: number;
  fund_category?: string;
  wallet_type?: string;
  before_balance?: number;
  after_balance?: number;
  performed_by?: string;
  remarks?: string;
  reference_id?: string;
}

export function fetchPushPull(params?: {
  action_type?: 'push' | 'pull';
  wallet_type?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  limit?: number;
}) {
  return api.get<{
    entries: PushPullEntry[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    summary: { totalPush: number; totalPull: number; net: number };
  }>('/api/reports/push-pull', { ...params, page: params?.page ?? 1, limit: params?.limit ?? 25 });
}

export function fetchLedger(params?: {
  date_from?: string;
  date_to?: string;
  wallet_type?: string;
  service_type?: string;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  return api.get<{ success: boolean; data: WalletLedgerRow[]; total: number; limit: number; offset: number }>(
    '/api/reports/ledger',
    { ...params, limit: params?.limit ?? 50, offset: params?.offset ?? 0 }
  );
}
