/**
 * Pay2New AePS HTTP Client
 * Base URL: https://pay2new.in/apis/aeps/v1/
 * Auth: same secret + outletId headers as BBPS
 */

import { getPay2NewSecret, getPay2NewTimeout } from '@/services/pay2new/config';
import { SERVICE_DOWN_MESSAGE, maskProviderBalanceError } from '@/lib/provider-error';
import type {
  Pay2NewBankListResponse,
  Pay2NewBioKycStatusResponse,
  Pay2NewBioKycRequest,
  Pay2NewBioKycResponse,
  Pay2NewMerchantLoginStatusResponse,
  Pay2NewMerchantLoginRequest,
  Pay2NewMerchantLoginResponse,
  Pay2NewTransactionOtpRequest,
  Pay2NewTransactionOtpResponse,
  Pay2NewCashRequest,
  Pay2NewCashResponse,
  Pay2NewBalanceCheckRequest,
  Pay2NewBalanceCheckResponse,
  Pay2NewMiniStatementRequest,
  Pay2NewMiniStatementResponse,
  Pay2NewAadhaarPayRequest,
  Pay2NewAadhaarPayResponse,
  Pay2NewSettlementAccountListResponse,
  Pay2NewSettlementAddRequest,
  Pay2NewSettlementAddResponse,
  Pay2NewSettlementDeleteRequest,
  Pay2NewSettlementDeleteResponse,
} from './types';

const AEPS_BASE = 'https://pay2new.in/apis/aeps/v1';

export class Pay2NewAepsAPIError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public data?: unknown,
    public ambiguous = false,
  ) {
    super(message);
    this.name = 'Pay2NewAepsAPIError';
  }
}

function getAepsHeaders(outletId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    secret: getPay2NewSecret(),
    outletId,
  };
}

async function aepsRequest<T>(
  path: string,
  method: 'GET' | 'POST',
  outletId: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const url = `${AEPS_BASE}${path.startsWith('/') ? path : '/' + path}`;
  const timeoutMs = getPay2NewTimeout();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers: getAepsHeaders(outletId),
      body: method === 'POST' && body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    let parsed: any;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw new Pay2NewAepsAPIError(
        text.startsWith('<') ? SERVICE_DOWN_MESSAGE : maskProviderBalanceError(text.slice(0, 300)),
        res.status,
        { raw: text.slice(0, 300) },
        true,
      );
    }

    if (!res.ok) {
      throw new Pay2NewAepsAPIError(
        parsed.message || `HTTP ${res.status}`,
        res.status,
        parsed,
      );
    }

    return parsed as T;
  } catch (e: any) {
    clearTimeout(timer);
    if (e instanceof Pay2NewAepsAPIError) throw e;
    if (e?.name === 'AbortError') {
      throw new Pay2NewAepsAPIError(SERVICE_DOWN_MESSAGE, 408, undefined, true);
    }
    throw new Pay2NewAepsAPIError(e?.message || 'Network error', 0, undefined, true);
  } finally {
    clearTimeout(timer);
  }
}

export class Pay2NewAepsClient {
  constructor(private readonly outletId: string) {}

  /** GET /aepsBankList */
  async getBankList(): Promise<Pay2NewBankListResponse> {
    return aepsRequest<Pay2NewBankListResponse>('/aepsBankList', 'GET', this.outletId);
  }

  /** GET /biometricKycStatus */
  async getBioKycStatus(): Promise<Pay2NewBioKycStatusResponse> {
    return aepsRequest<Pay2NewBioKycStatusResponse>('/biometricKycStatus', 'GET', this.outletId);
  }

  /** POST /biometricKyc */
  async submitBioKyc(payload: Pay2NewBioKycRequest): Promise<Pay2NewBioKycResponse> {
    return aepsRequest<Pay2NewBioKycResponse>('/biometricKyc', 'POST', this.outletId, payload as unknown as Record<string, unknown>);
  }

  /** POST /merchantLoginStatus — no body required */
  async getMerchantLoginStatus(): Promise<Pay2NewMerchantLoginStatusResponse> {
    return aepsRequest<Pay2NewMerchantLoginStatusResponse>('/merchantLoginStatus', 'POST', this.outletId);
  }

  /** POST /merchantLogin */
  async merchantLogin(payload: Pay2NewMerchantLoginRequest): Promise<Pay2NewMerchantLoginResponse> {
    return aepsRequest<Pay2NewMerchantLoginResponse>('/merchantLogin', 'POST', this.outletId, payload as unknown as Record<string, unknown>);
  }

  /** POST /aepsBalanceCheck */
  async balanceCheck(payload: Pay2NewBalanceCheckRequest): Promise<Pay2NewBalanceCheckResponse> {
    return aepsRequest<Pay2NewBalanceCheckResponse>('/aepsBalanceCheck', 'POST', this.outletId, payload as unknown as Record<string, unknown>);
  }

  /** POST /miniStatement */
  async miniStatement(payload: Pay2NewMiniStatementRequest): Promise<Pay2NewMiniStatementResponse> {
    return aepsRequest<Pay2NewMiniStatementResponse>('/miniStatement', 'POST', this.outletId, payload as unknown as Record<string, unknown>);
  }

  /** POST /transactionOtp — required for cashWithdrawal > ₹5,000 */
  async transactionOtp(payload: Pay2NewTransactionOtpRequest): Promise<Pay2NewTransactionOtpResponse> {
    return aepsRequest<Pay2NewTransactionOtpResponse>('/transactionOtp', 'POST', this.outletId, payload as unknown as Record<string, unknown>);
  }

  /** POST /cashWithdrawal */
  async cashWithdrawal(payload: Pay2NewCashRequest): Promise<Pay2NewCashResponse> {
    return aepsRequest<Pay2NewCashResponse>('/cashWithdrawal', 'POST', this.outletId, payload as unknown as Record<string, unknown>);
  }

  /** POST /cashDeposit */
  async cashDeposit(payload: Pay2NewCashRequest): Promise<Pay2NewCashResponse> {
    return aepsRequest<Pay2NewCashResponse>('/cashDeposit', 'POST', this.outletId, payload as unknown as Record<string, unknown>);
  }

  /** POST /aadhaarPay */
  async aadhaarPay(payload: Pay2NewAadhaarPayRequest): Promise<Pay2NewAadhaarPayResponse> {
    return aepsRequest<Pay2NewAadhaarPayResponse>('/aadhaarPay', 'POST', this.outletId, payload as unknown as Record<string, unknown>);
  }

  // ─── Settlement ─────────────────────────────────────────────────────────────

  /** GET /accountList — list settlement accounts registered with Pay2New */
  async settlementAccountList(): Promise<Pay2NewSettlementAccountListResponse> {
    return aepsRequest<Pay2NewSettlementAccountListResponse>('/accountList', 'GET', this.outletId);
  }

  /** POST /addAccount — register a settlement account with Pay2New */
  async settlementAddAccount(payload: Pay2NewSettlementAddRequest): Promise<Pay2NewSettlementAddResponse> {
    return aepsRequest<Pay2NewSettlementAddResponse>('/addAccount', 'POST', this.outletId, payload as unknown as Record<string, unknown>);
  }

  /** POST /deleteAccount — remove a settlement account from Pay2New */
  async settlementDeleteAccount(payload: Pay2NewSettlementDeleteRequest): Promise<Pay2NewSettlementDeleteResponse> {
    return aepsRequest<Pay2NewSettlementDeleteResponse>('/deleteAccount', 'POST', this.outletId, payload as unknown as Record<string, unknown>);
  }
}

/** Create a client using the given outlet ID (retailer-specific or platform-wide) */
export function createPay2NewAepsClient(outletId?: string): Pay2NewAepsClient {
  const id = outletId || process.env.PAY2NEW_OUTLET_ID || '';
  if (!id) {
    throw new Error('Pay2New AePS: outletId is required. Set PAY2NEW_OUTLET_ID in environment.');
  }
  return new Pay2NewAepsClient(id);
}
