/**
 * AEPS Service — Main export
 */

export * from './config';
export * from './client';
export * from './service';

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
