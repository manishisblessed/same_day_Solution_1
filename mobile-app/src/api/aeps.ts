import { api } from '@/lib/api';
import { BiometricFields } from '@/aeps/mantra';

export interface AepsBank { iin: string; bankName: string }

export interface LoginStatus {
  loginStatus: boolean;
  bankList: AepsBank[];
  wadh: string | null;
  route?: string;
  kycStatus?: string;
  sessionExpired?: boolean;
  deviceChanged?: boolean;
}

export function aepsLoginStatus(input: { merchantId: string; type: 'withdraw' | 'deposit'; deviceFingerprint: string }) {
  return api.post<{ success: boolean; isMockMode: boolean; data: LoginStatus }>(
    '/api/aeps/login-status',
    input
  );
}

/** Daily operator biometric 2FA login. Biometric fields are flattened at top level. */
export function aepsLogin(input: {
  merchantId: string;
  transType: 'withdraw' | 'deposit';
  wadh: string;
  deviceFingerprint: string;
  bio: BiometricFields;
}) {
  const { merchantId, transType, wadh, deviceFingerprint, bio } = input;
  return api.post<{ success: boolean; message: string; retry?: boolean; data: LoginStatus }>(
    '/api/aeps/login',
    { merchantId, transType, wadh, deviceFingerprint, ...bio }
  );
}

export type AepsTxnType =
  | 'balance_inquiry' | 'cash_withdrawal' | 'cash_deposit' | 'mini_statement' | 'aadhaar_to_aadhaar';

export interface AepsReceipt {
  txnId: string;
  utr?: string;
  timestamp: string;
  type: string;
  status: 'SUCCESS' | 'FAILED';
  customer?: { aadhaarMasked?: string; bankName?: string; accountNumberMasked?: string };
  transaction?: { amount?: number; commission?: number };
  bank?: { availableBalance?: string };
  miniStatement?: Array<{ date: string; narration: string; txnType: string; amount: string }>;
  error?: { errorCode?: string; errorMessage?: string; retryable?: boolean };
}

/** Unified AEPS transaction. Customer biometric goes under `biometricData`. */
export function aepsTransact(input: {
  merchantId: string;
  transactionType: AepsTxnType;
  customerAadhaar: string;
  customerMobile: string;
  bankIin: string;
  bankName?: string;
  amount?: number;
  wadh: string;
  deviceFingerprint: string;
  biometricData: BiometricFields;
}) {
  return api.post<{ success: boolean; isMockMode: boolean; receipt: AepsReceipt }>(
    '/api/aeps/transact',
    input,
    { idempotent: true }
  );
}

export function aepsBanks(merchantId: string) {
  return api.get<{ success: boolean; data: AepsBank[]; count: number }>('/api/aeps/banks', { merchantId });
}

export function aepsStats() {
  return api.get<{ success: boolean; data: any }>('/api/aeps/stats');
}

export function aepsSettlementAccounts() {
  return api.get<{ success: boolean; accounts: any[] }>('/api/aeps/settlement-account');
}

export function aepsSettle(input: { amount: number; settlement_account_id: string }) {
  return api.post<any>('/api/aeps/settlement', input, { idempotent: true });
}
