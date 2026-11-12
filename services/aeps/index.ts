/**
 * AEPS Service — Main export
 *
 * Provider selection is controlled by AEPS_PROVIDER env var:
 *   AEPS_PROVIDER=chagans   (default) — Chagans/Instantpay
 *   AEPS_PROVIDER=pay2new             — Pay2New AePS
 */

export * from './config';
export * from './client';
export * from './service';
export * from './commission';
export * from './error-codes';

import { getAEPSProvider } from './config';
import { getAEPSService as getChagansAEPSService } from './service';
import { getPay2NewAepsService } from '@/services/pay2new-aeps';

/**
 * Returns the active AePS service instance based on AEPS_PROVIDER env var.
 * Routes should call this instead of getAEPSService() directly when they
 * need provider-agnostic transaction processing.
 */
export function getActiveAepsService(): ReturnType<typeof getChagansAEPSService> | ReturnType<typeof getPay2NewAepsService> {
  if (getAEPSProvider() === 'pay2new') {
    return getPay2NewAepsService() as any;
  }
  return getChagansAEPSService();
}

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
