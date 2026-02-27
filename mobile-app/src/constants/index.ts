export const APP_NAME = 'Sameday';
export const APP_TAGLINE = 'Retailer Portal';

export const TRANSACTION_STATUS = {
  SUCCESS: 'success',
  PENDING: 'pending',
  FAILED: 'failed',
  PROCESSING: 'processing',
} as const;

export const TRANSACTION_TYPES = {
  BBPS: 'BBPS',
  AEPS: 'AEPS',
  PAYOUT: 'Payout',
  POS: 'POS',
  SETTLEMENT: 'Settlement',
  COMMISSION: 'Commission',
  WALLET_CREDIT: 'Wallet Credit',
  WALLET_DEBIT: 'Wallet Debit',
} as const;

export const SERVICE_CATEGORIES = [
  { id: 'bbps', label: 'BBPS Payments', icon: 'receipt' as const },
  { id: 'aeps', label: 'AEPS', icon: 'fingerprint' as const },
  { id: 'pos', label: 'POS', icon: 'credit-card' as const },
  { id: 'dmt', label: 'Money Transfer', icon: 'send' as const },
  { id: 'recharge', label: 'Recharge', icon: 'smartphone' as const },
  { id: 'utility', label: 'Utility Bills', icon: 'zap' as const },
] as const;

export const SETTLEMENT_STATUS = {
  COMPLETED: 'completed',
  PENDING: 'pending',
  PROCESSING: 'processing',
  FAILED: 'failed',
} as const;

export type TransactionStatus = typeof TRANSACTION_STATUS[keyof typeof TRANSACTION_STATUS];
export type SettlementStatus = typeof SETTLEMENT_STATUS[keyof typeof SETTLEMENT_STATUS];
