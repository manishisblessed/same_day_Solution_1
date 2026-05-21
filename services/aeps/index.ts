/**
 * AEPS Service — Main export
 */

export * from './config';
export * from './client';
export * from './service';
export * from './commission';
export * from './error-codes';

// Re-export types for convenience
export type {
  AEPSTransactionType,
  AEPSStatus,
  AEPSRoute,
  AEPSBank,
  AEPSMerchant,
  AEPSLoginStatusResponse,
  AEPSPaymentResponse,
  AEPSTransactionRecord,
  AEPSUIState,
  AEPSWalletInfo,
  MiniStatementEntry,
} from '@/types/aeps.types';
