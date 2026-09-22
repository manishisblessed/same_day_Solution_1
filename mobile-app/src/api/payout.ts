import { api } from '@/lib/api';
import { Beneficiary } from './types';

export interface PayoutBank { id?: string; name: string; [k: string]: any }

export function fetchPayoutBanks(params?: { imps?: boolean; neft?: boolean; popular?: boolean; search?: string }) {
  return api.get<{ success: boolean; banks: PayoutBank[]; total: number }>('/api/payout/banks', params);
}

export function verifyAccount(input: { accountNumber: string; ifscCode: string; bankName?: string; bankId?: string }) {
  return api.post<{
    success: boolean; is_valid: boolean; account_holder_name: string;
    bank_name: string; branch_name: string; verification_charges: number; message: string; reference_id: string;
  }>('/api/payout/verify', input);
}

export function fetchBeneficiaries() {
  return api.get<{ success: boolean; beneficiaries: Beneficiary[] }>('/api/beneficiaries');
}

export function addBeneficiary(input: {
  account_number: string; ifsc_code: string; bank_name: string;
  account_holder_name?: string; bank_id?: string; beneficiary_mobile?: string; nickname?: string; is_default?: boolean;
}) {
  return api.post<{ success: boolean; beneficiary: Beneficiary }>('/api/beneficiaries', input);
}

export function deleteBeneficiary(id: string) {
  return api.del<{ success: boolean }>('/api/beneficiaries', { id });
}

export function payoutTransfer(input: {
  accountNumber: string;
  ifscCode: string;
  accountHolderName: string;
  amount: number;
  transferMode: 'IMPS' | 'NEFT';
  bankId?: string;
  bankName: string;
  beneficiaryMobile?: string;
  remarks?: string;
  tpin: string;
}) {
  return api.post<{
    success: boolean; message: string; transaction_id: string; provider_txn_id: string;
    status: string; amount: number; charges: number; total_debited: number;
  }>('/api/payout/transfer', input, { idempotent: true });
}

export function payoutStatus(params: { transactionId?: string; clientRefId?: string; list?: boolean }) {
  return api.get<any>('/api/payout/status', params);
}

export function resolvePayoutCharges(amount: number, transfer_mode: 'IMPS' | 'NEFT') {
  return api.get<any>('/api/schemes/resolve-charges', { service_type: 'payout', amount, transfer_mode });
}
