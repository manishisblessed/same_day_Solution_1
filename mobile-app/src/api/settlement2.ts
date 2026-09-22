import { api } from '@/lib/api';

export interface Settlement2Account {
  id: string;
  account_number: string;
  ifsc_code: string;
  account_holder_name: string;
  verification_status?: string;
  [k: string]: any;
}

export function fetchSettlement2Accounts() {
  return api.get<{ success: boolean; accounts: Settlement2Account[]; count: number }>('/api/settlement-2/accounts');
}

export function addSettlement2Account(input: {
  account_number: string;
  ifsc_code: string;
  account_holder_name: string;
  contact_mobile: string;
  contact_name?: string;
  contact_email?: string;
}) {
  return api.post<any>('/api/settlement-2/accounts', input);
}

export function fetchSettlement2Charges(amount: number, mode: 'IMPS' | 'RTGS' = 'IMPS') {
  return api.get<{
    success: boolean; amount: number; mode: string; scheme_name: string;
    charges: { retailer_charge: number; retailer_charge_base: number; gst_amount: number; gst_percent: number };
  }>('/api/settlement-2/charges', { amount, mode });
}

export function settlement2Transfer(input: {
  account_id: string;
  amount: number;
  mode?: 'IMPS' | 'RTGS';
  narration?: string;
  tpin: string;
}) {
  return api.post<{
    success: boolean;
    transaction: {
      id: string; reference_id: string; order_id: string; utr: string; amount: number;
      charges: number; mode: string; status: string; status_message: string;
      account_number: string; account_holder_name: string;
    };
  }>('/api/settlement-2/transfer', input, { idempotent: true });
}

export function settlement2Status(reference_id: string) {
  return api.post<{ success: boolean; data: any; refunded?: boolean }>('/api/settlement-2/status', { reference_id });
}
