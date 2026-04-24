/**
 * AEPS API Client — Handles both real Chagans and mock endpoints
 */

import { getAEPSConfig, getAEPSHeaders, getAEPSEndpoint, AEPSConfig } from './config';
import type {
  AEPSLoginStatusRequest,
  AEPSLoginStatusResponse,
  AEPSLoginRequest,
  AEPSLoginResponse,
  AEPSPaymentRequest,
  AEPSPaymentResponse,
  CreateMerchantRequest,
  CreateMerchantResponse,
  AEPSBank,
} from '@/types/aeps.types';

class AEPSClient {
  private config: AEPSConfig;

  constructor() {
    this.config = getAEPSConfig();
  }

  private async request<T>(
    path: string,
    method: 'GET' | 'POST' = 'POST',
    body?: unknown,
    useMock?: boolean
  ): Promise<T> {
    const config = { ...this.config, useMock: useMock ?? this.config.useMock };
    const url = getAEPSEndpoint(config, path);
    const headers = config.useMock 
      ? { 'Content-Type': 'application/json' }
      : getAEPSHeaders(config);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new AEPSAPIError(
          errorData.message || `HTTP ${response.status}`,
          response.status,
          errorData
        );
      }

      return response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new AEPSAPIError('Request timeout', 408);
      }
      
      if (error instanceof AEPSAPIError) {
        throw error;
      }
      
      throw new AEPSAPIError(error.message || 'Network error', 0);
    }
  }

  /**
   * Create new merchant with KYC
   */
  async createMerchant(data: CreateMerchantRequest): Promise<CreateMerchantResponse> {
    return this.request<CreateMerchantResponse>('/createMerchant', 'POST', data, false);
  }

  /**
   * Get merchant list
   */
  async getMerchantList(params?: {
    page?: number;
    limit?: number;
    kycStatus?: string;
    mobile?: string;
    search?: string;
  }): Promise<{
    success: boolean;
    data: any[];
    pagination: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.set('page', String(params.page));
    if (params?.limit) queryParams.set('limit', String(params.limit));
    if (params?.kycStatus) queryParams.set('kycStatus', params.kycStatus);
    if (params?.mobile) queryParams.set('mobile', params.mobile);
    if (params?.search) queryParams.set('search', params.search);

    const path = `/merchantList${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
    return this.request(path, 'POST', {}, false);
  }

  /**
   * Check AEPS login status and get bank list
   */
  async checkLoginStatus(data: AEPSLoginStatusRequest): Promise<AEPSLoginStatusResponse> {
    // For login status, always use real API if credentials available
    const useMock = !this.config.clientId || !this.config.authToken;
    return this.request<AEPSLoginStatusResponse>('/loginStatus', 'POST', data, useMock ? true : false);
  }

  /**
   * AEPS biometric login (daily authentication)
   */
  async aepsLogin(data: AEPSLoginRequest): Promise<AEPSLoginResponse> {
    if (this.config.useMock) {
      return this.request<AEPSLoginResponse>('/mock-login', 'POST', {
        merchantId: data.merchantId,
        type: data.transType,
      }, true);
    }
    return this.request<AEPSLoginResponse>('/aepsLogin', 'POST', data, false);
  }

  /**
   * AEPS payment transaction (withdraw, deposit, balance, miniStatement)
   */
  async aepsPayment(data: AEPSPaymentRequest): Promise<AEPSPaymentResponse> {
    if (this.config.useMock) {
      return this.request<AEPSPaymentResponse>('/mock-payment', 'POST', {
        merchantId: data.merchantId,
        type: data.type,
        amount: data.amount,
        iin: data.iin,
        adhar: data.adhar,
        cMobile: data.cMobile,
      }, true);
    }
    return this.request<AEPSPaymentResponse>('/aepsPayment', 'POST', data, false);
  }

  /**
   * Get available banks for AEPS
   */
  async getBankList(merchantId: string, type: 'deposit' | 'withdraw' = 'withdraw'): Promise<AEPSBank[]> {
    try {
      const response = await this.checkLoginStatus({ merchantId, type });
      return response.data?.bankList || [];
    } catch {
      // Return default banks on error
      return [
        { iin: '607094', bankName: 'HDFC Bank' },
        { iin: '607152', bankName: 'State Bank of India' },
        { iin: '505290', bankName: 'Axis Bank' },
        { iin: '607095', bankName: 'ICICI Bank' },
        { iin: '607161', bankName: 'Punjab National Bank' },
      ];
    }
  }

  /**
   * Get wadh (session key) for biometric operations
   */
  async getWadh(merchantId: string, type: 'deposit' | 'withdraw' = 'withdraw'): Promise<string | null> {
    try {
      const response = await this.checkLoginStatus({ merchantId, type });
      return response.data?.wadh || null;
    } catch {
      return null;
    }
  }

  /**
   * Check if using mock mode
   */
  isMockMode(): boolean {
    return this.config.useMock;
  }

  /**
   * Get current configuration
   */
  getConfig(): AEPSConfig {
    return { ...this.config };
  }
}

export class AEPSAPIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public data?: any
  ) {
    super(message);
    this.name = 'AEPSAPIError';
  }
}

// Singleton instance
let aepsClientInstance: AEPSClient | null = null;

export function getAEPSClient(): AEPSClient {
  if (!aepsClientInstance) {
    aepsClientInstance = new AEPSClient();
  }
  return aepsClientInstance;
}

export { AEPSClient };
