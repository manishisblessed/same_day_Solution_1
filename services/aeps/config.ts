/**
 * AEPS Service Configuration
 * Controls mock vs real API switching
 */

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
  const useMock = process.env.AEPS_USE_MOCK === 'true' || 
                  process.env.NODE_ENV === 'development';
  
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
