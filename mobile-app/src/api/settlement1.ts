import { api } from '@/lib/api';

export interface Settlement1Account {
  id: string;
  account_number: string;
  ifsc_code: string;
  account_holder_name: string;
  bank_name?: string;
  mobile?: string;
  is_registered: boolean;
  is_bank_verified: boolean;
  disclaimer_accepted?: boolean;
}

export function fetchSettlement1Accounts() {
  return api.get<{ success: boolean; accounts: Settlement1Account[] }>(
    '/api/knteer-payout/accounts'
  );
}

export function addSettlement1Account(input: {
  account_number: string;
  ifsc_code: string;
  mobile: string;
  email?: string;
  registration_type: 'register' | 'verify';
  account_holder_name?: string;   // required for register
  disclaimer_accepted?: boolean;  // required for register
}) {
  return api.post<{ success: boolean; account?: Settlement1Account; error?: string }>(
    '/api/knteer-payout/accounts',
    input
  );
}

export function deleteSettlement1Account(id: string) {
  return api.del<{ success: boolean }>('/api/knteer-payout/accounts', { id });
}

export function settlement1Transfer(input: {
  accountNumber: string;
  ifscCode: string;
  accountHolderName: string;
  bankName: string;
  amount: number;
  paymentMode: 'IMPS' | 'NEFT';
  mobile: string;
  email: string;
  senderName: string;
  senderMobile: string;
  remarks?: string;
  tpin: string;
}) {
  return api.post<{
    success: boolean;
    message: string;
    transaction_id: string;
    partner_trans_id?: string;
    knteer_trans_id?: string;
    utr?: string;
    status: string;
    amount: number;
    charges: number;
    payment_mode?: string;
    account_number?: string;
    account_holder_name?: string;
    bank_name?: string;
  }>('/api/knteer-payout/transfer', input, { idempotent: true });
}

export function fetchSettlement1Charges(amount: number) {
  return api.get<{
    resolved: boolean;
    charges?: { retailer_charge?: number };
    charge_available?: boolean;
    scheme_assigned?: boolean;
    message?: string;
  }>('/api/schemes/resolve-charges', { service_type: 'payout', amount, transfer_mode: 'IMPS' });
}
