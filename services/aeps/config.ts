/**
 * AEPS Service Configuration
 * Controls mock vs real API switching and provider selection.
 *
 * AEPS_PROVIDER=chagans (default) — existing Chagans/Instantpay integration
 * AEPS_PROVIDER=pay2new           — Pay2New AePS (uses PAY2NEW_SECRET + PAY2NEW_OUTLET_ID)
 */

export type AEPSProvider = 'chagans' | 'pay2new';

export function getAEPSProvider(): AEPSProvider {
  const v = (process.env.AEPS_PROVIDER || 'chagans').toLowerCase();
  return v === 'pay2new' ? 'pay2new' : 'chagans';
}

export function isAEPSProviderPay2New(): boolean {
  return getAEPSProvider() === 'pay2new';
}

export interface AEPSConfig {
  useMock: boolean;
  baseUrl: string;
  mockBaseUrl: string;
  clientId: string;
  clientSecret: string;
  authToken: string;
  defaultRoute: 'AIRTEL' | 'JIO';
  timeoutMs: number;
}

export function getAEPSConfig(): AEPSConfig {
  // IMPORTANT: Only check AEPS_USE_MOCK env variable
  // DO NOT force mock in development - let the env variable control it
  // This allows local testing with real Chagans API when AEPS_USE_MOCK=false
  const useMock = process.env.AEPS_USE_MOCK === 'true';
  
  // Log config on first load for debugging
  if (typeof window === 'undefined') {
    console.log(`[AEPS Config] Mode: ${useMock ? 'MOCK' : 'PRODUCTION'}, BaseURL: ${process.env.CHAGHANS_AEPS_BASE_URL || 'default'}`);
  }
  
  return {
    useMock,
    baseUrl: process.env.CHAGHANS_AEPS_BASE_URL || 'https://chagans.com/aeps',
    mockBaseUrl: process.env.AEPS_MOCK_BASE_URL || 'http://localhost:3000/api/aeps',
    clientId: process.env.CHAGHANS_AEPS_CLIENT_ID || '',
    clientSecret: process.env.CHAGHANS_AEPS_CONSUMER_SECRET || '',
    authToken: process.env.CHAGHANS_AEPS_AUTH_TOKEN || '',
    defaultRoute: 'AIRTEL',
    timeoutMs: 60000, // 60 seconds for biometric operations
  };
}

export function getAEPSHeaders(config: AEPSConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'client-id': config.clientId,
    'client-secret': config.clientSecret,
    'authorization': config.authToken.startsWith('Bearer ') 
      ? config.authToken 
      : `Bearer ${config.authToken}`,
    'apiType': 'aeps',
  };
}

export function getAEPSEndpoint(config: AEPSConfig, path: string): string {
  const base = config.useMock ? config.mockBaseUrl : config.baseUrl;
  return `${base}${path.startsWith('/') ? path : '/' + path}`;
}
