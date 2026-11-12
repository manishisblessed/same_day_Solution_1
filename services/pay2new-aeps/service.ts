/**
 * Pay2New AePS Service Adapter
 *
 * Presents the same high-level interface as the Chagans-backed AEPSService so
 * that existing route handlers work unchanged when AEPS_PROVIDER=pay2new.
 *
 * Key differences vs Chagans:
 * - No per-retailer merchant creation: the outlet's biometric KYC is done once
 *   at platform level (or per sub-outlet). The returned "merchantId" is the
 *   Pay2New outletId.
 * - Merchant daily login requires the MERCHANT's own Aadhaar + biometric.
 * - Transactions require customer's Aadhaar + biometric, plus product_code,
 *   latitude, longitude, ip (from env/request).
 */

import { createPay2NewAepsClient, Pay2NewAepsAPIError } from './client';
import { validateAadhaar, validateMobile } from '@/lib/validation';
import type { AEPSBank, MiniStatementEntry } from '@/types/aeps.types';
import type { Pay2NewBiometricData } from './types';

// ─── Shared biometric field mapping ──────────────────────────────────────────
// The existing route/client passes RD fields at the top level of biometricData.
// Pay2New expects exactly the same names nested under biometricData + aadhaar_number.

type RdFields = {
  bioType?: string;
  dc?: string;
  ci?: string;
  hmac?: string;
  dpId?: string;
  mc?: string;
  pidDataType?: string;
  mi?: string;
  rdsId?: string;
  sessionKey?: string;
  fCount?: string;
  errCode?: string;
  errInfo?: string;
  pCount?: string;
  fType?: string;
  iCount?: string;
  iType?: string;
  pType?: string;
  srno?: string;
  sysid?: string;
  ts?: string;
  pidData?: string;
  qScore?: string;
  nmPoints?: string;
  rdsVer?: string;
};

function toBiometricData(aadhaarNumber: string, rd: RdFields): Pay2NewBiometricData {
  return {
    aadhaar_number: aadhaarNumber,
    dc: rd.dc ?? '',
    ci: rd.ci ?? '',
    hmac: rd.hmac ?? '',
    dpId: rd.dpId ?? '',
    mc: rd.mc ?? '',
    pidDataType: rd.pidDataType ?? 'X',
    sessionKey: rd.sessionKey ?? '',
    mi: rd.mi ?? '',
    rdsId: rd.rdsId ?? '',
    errCode: rd.errCode ?? '0',
    errInfo: rd.errInfo ?? '',
    fCount: rd.fCount ?? '1',
    fType: rd.fType ?? '2',
    iCount: rd.iCount ?? '0',
    iType: rd.iType ?? '',
    pCount: rd.pCount ?? '0',
    pType: rd.pType ?? '',
    srno: rd.srno ?? '',
    sysid: rd.sysid,
    ts: rd.ts,
    pidData: rd.pidData ?? '',
    qScore: rd.qScore ?? '',
    nmPoints: rd.nmPoints ?? '',
    rdsVer: rd.rdsVer ?? '',
  };
}

function getDefaultLocation() {
  return {
    latitude: process.env.PAY2NEW_LATITUDE || '19.1258',
    longitude: process.env.PAY2NEW_LONGITUDE || '74.7453',
  };
}

function getProductCode() {
  return process.env.PAY2NEW_AEPS_PRODUCT_CODE || '243';
}

// ─── TransactionParams (mirrors AEPSService) ──────────────────────────────────
interface TransactionParams {
  userId: string;
  userRole: string;
  merchantId: string;        // Pay2New: used as outletId override (optional)
  transactionType: 'balance_inquiry' | 'cash_withdrawal' | 'cash_deposit' | 'mini_statement' | 'aadhaar_to_aadhaar';
  amount?: number;
  customerAadhaar: string;
  customerMobile: string;
  bankIin: string;
  bankName?: string;
  wadh?: string;             // not used by Pay2New
  clientIp?: string;         // request IP
  latitude?: string;
  longitude?: string;
  biometricData?: {
    bioType?: 'FINGER' | 'FACE';
    dc: string; ci: string; hmac: string; dpId: string; mc: string;
    pidDataType: string; mi: string; rdsId: string; sessionKey: string;
    fCount: string; errCode: string; pCount: string; fType: string;
    iCount: string; pType: string; srno: string; pidData: string;
    qScore: string; nmPoints: string; rdsVer: string;
    // Pay2New extras (optional, ignored if not supplied)
    errInfo?: string; iType?: string; sysid?: string; ts?: string;
  };
}

interface TransactionResult {
  success: boolean;
  orderId?: string;
  utr?: string;
  status: 'success' | 'failed' | 'pending';
  message: string;
  data?: {
    bankName?: string;
    accountNumber?: string;
    amount?: number;
    balance?: string;
    miniStatement?: MiniStatementEntry[];
  };
  error?: string;
  npciCode?: string;
}

// ─── AePS Login Status (mirrors existing shape) ───────────────────────────────
interface LoginStatusResponse {
  success: boolean;
  data?: {
    loginStatus: boolean;
    bankList: AEPSBank[];
    wadh: string | null;
    route: string | null;
    kycStatus: string | null;
  };
  message?: string;
}

// ─── Service adapter ──────────────────────────────────────────────────────────
export class Pay2NewAepsService {
  private outletId: string;

  constructor(outletId?: string) {
    this.outletId = outletId || process.env.PAY2NEW_OUTLET_ID || '';
  }

  private client(outletIdOverride?: string) {
    return createPay2NewAepsClient(outletIdOverride || this.outletId);
  }

  isMockMode(): boolean {
    return false; // Pay2New AePS always calls real API; use mock at route level
  }

  validateAadhaarNumber(aadhaar: string) {
    return validateAadhaar(aadhaar);
  }

  validateMobileNumber(mobile: string) {
    return validateMobile(mobile);
  }

  maskAadhaar(aadhaar: string): string {
    const clean = aadhaar.replace(/\s/g, '');
    if (clean.length !== 12) return aadhaar;
    return `XXXX XXXX ${clean.slice(-4)}`;
  }

  // ─── Bank List ──────────────────────────────────────────────────────────────
  async getBanks(outletIdOverride?: string): Promise<AEPSBank[]> {
    try {
      const res = await this.client(outletIdOverride).getBankList();
      if (res.status === 1 && Array.isArray(res.data)) {
        return res.data.map((b) => ({ iin: b.iin, bankName: b.bankName }));
      }
    } catch (e) {
      console.error('[Pay2NewAePS] getBanks error:', e);
    }
    // Fallback static list
    return [
      { iin: '607094', bankName: 'HDFC Bank' },
      { iin: '607152', bankName: 'State Bank of India' },
      { iin: '505290', bankName: 'Axis Bank' },
      { iin: '607095', bankName: 'ICICI Bank' },
      { iin: '607161', bankName: 'Punjab National Bank' },
      { iin: '607389', bankName: 'Bank of Baroda' },
    ];
  }

  // ─── Merchant KYC Status (replaces Chagans checkLoginStatus for KYC checks) ─
  async checkBioKycStatus(outletIdOverride?: string) {
    return this.client(outletIdOverride).getBioKycStatus();
  }

  // ─── Merchant Login Status (replaces Chagans loginStatus) ────────────────────
  async checkLoginStatus(_merchantId: string, _type: 'deposit' | 'withdraw', outletIdOverride?: string): Promise<LoginStatusResponse> {
    try {
      const [statusRes, bankRes] = await Promise.all([
        this.client(outletIdOverride).getMerchantLoginStatus(),
        this.getBanks(outletIdOverride),
      ]);

      // login_status: 1=logged in, 2=login required
      const loggedIn = statusRes.status === 1 && statusRes.data?.login_status !== 2;

      return {
        success: statusRes.status === 1,
        data: {
          loginStatus: loggedIn,
          bankList: bankRes,
          wadh: null,         // Pay2New doesn't use wadh
          route: 'INSTANTPAY',
          kycStatus: 'validated',
        },
        message: statusRes.message,
      };
    } catch (e: any) {
      console.error('[Pay2NewAePS] checkLoginStatus error:', e);
      throw e;
    }
  }

  // ─── Merchant Daily Login (replaces Chagans aepsLogin) ───────────────────────
  async merchantLogin(params: {
    merchantAadhaar: string;
    latitude?: string;
    longitude?: string;
    captureType?: 'FINGER' | 'IRIS' | 'FACE';
    bankIin?: string;
    type?: 'DAILY_LOGIN' | 'TXN_AUTH';
    rdFields: RdFields;
    outletIdOverride?: string;
  }) {
    const loc = getDefaultLocation();
    return this.client(params.outletIdOverride).merchantLogin({
      latitude: params.latitude || loc.latitude,
      longitude: params.longitude || loc.longitude,
      type: params.type || 'DAILY_LOGIN',
      bankiin: params.bankIin,
      captureType: params.captureType || (params.rdFields.bioType === 'FACE' ? 'FACE' : 'FINGER'),
      biometricData: toBiometricData(params.merchantAadhaar, params.rdFields),
    });
  }

  // ─── Biometric KYC Submit ─────────────────────────────────────────────────────
  async submitBioKyc(params: {
    referenceKey: string;
    merchantAadhaar: string;
    latitude?: string;
    longitude?: string;
    requestId: string;
    rdFields: RdFields;
    outletIdOverride?: string;
  }) {
    const loc = getDefaultLocation();
    return this.client(params.outletIdOverride).submitBioKyc({
      referenceKey: params.referenceKey,
      latitude: params.latitude || loc.latitude,
      longitude: params.longitude || loc.longitude,
      request_id: params.requestId,
      biometricData: toBiometricData(params.merchantAadhaar, params.rdFields),
    });
  }

  // ─── Process Transaction (replaces AEPSService.processTransaction) ────────────
  async processTransaction(params: TransactionParams): Promise<TransactionResult> {
    const {
      transactionType,
      amount,
      customerAadhaar,
      customerMobile,
      bankIin,
      biometricData,
      clientIp,
      latitude,
      longitude,
      merchantId,
    } = params;

    if (!biometricData) {
      return { success: false, status: 'failed', message: 'Biometric data required', error: 'BIOMETRIC_REQUIRED' };
    }

    const loc = getDefaultLocation();
    const lat = latitude || loc.latitude;
    const lng = longitude || loc.longitude;
    const ip = clientIp || '127.0.0.1';
    const productCode = getProductCode();
    const requestId = `AEPS_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const captureType = biometricData.bioType === 'FACE' ? 'FACE' : 'FINGER';

    const bioData = toBiometricData(customerAadhaar, biometricData);

    const c = this.client(merchantId !== 'PAY2NEW' ? undefined : merchantId);

    try {
      switch (transactionType) {
        case 'balance_inquiry': {
          const res = await c.balanceCheck({
            bankiin: bankIin,
            latitude: lat,
            longitude: lng,
            customer_mobile: customerMobile,
            request_id: requestId,
            product_code: productCode,
            ip,
            biometricData: bioData,
            captureType,
          });
          return this.formatTransactionResult(res, transactionType);
        }

        case 'mini_statement': {
          const res = await c.miniStatement({
            bankiin: bankIin,
            latitude: lat,
            longitude: lng,
            customer_mobile: customerMobile,
            request_id: requestId,
            product_code: productCode,
            ip,
            biometricData: bioData,
            captureType,
          });
          return this.formatTransactionResult(res, transactionType);
        }

        case 'cash_withdrawal': {
          const txnAmount = amount || 0;
          // Amounts > ₹5,000 require Transaction OTP first; that flow must be
          // handled at the route level (collect OTP from customer → capture again).
          // Here we just submit the withdrawal (with or without referenceKey).
          const res = await c.cashWithdrawal({
            amount: String(txnAmount.toFixed(2)),
            bankiin: bankIin,
            latitude: lat,
            longitude: lng,
            customer_mobile: customerMobile,
            request_id: requestId,
            product_code: productCode,
            ip,
            biometricData: bioData,
            captureType,
            // referenceKey is injected from route when amount > 5000
          });
          return this.formatTransactionResult(res, transactionType);
        }

        case 'cash_deposit': {
          const txnAmount = amount || 0;
          const res = await c.cashDeposit({
            amount: String(txnAmount.toFixed(2)),
            bankiin: bankIin,
            latitude: lat,
            longitude: lng,
            customer_mobile: customerMobile,
            request_id: requestId,
            product_code: productCode,
            ip,
            biometricData: bioData,
            captureType,
          });
          return this.formatTransactionResult(res, transactionType);
        }

        case 'aadhaar_to_aadhaar': {
          const txnAmount = amount || 0;
          const res = await c.aadhaarPay({
            amount: String(txnAmount.toFixed(2)),
            bankiin: bankIin,
            latitude: lat,
            longitude: lng,
            customer_mobile: customerMobile,
            request_id: requestId,
            product_code: productCode,
            ip,
            biometricData: bioData,
            captureType,
          });
          return this.formatTransactionResult(res, transactionType);
        }

        default:
          return { success: false, status: 'failed', message: 'Unknown transaction type', error: 'INVALID_TYPE' };
      }
    } catch (e: any) {
      console.error('[Pay2NewAePS] processTransaction error:', e);
      if (e instanceof Pay2NewAepsAPIError && e.ambiguous) {
        return { success: false, status: 'pending', message: e.message, error: 'AMBIGUOUS_OUTCOME' };
      }
      return {
        success: false,
        status: 'failed',
        message: e?.message || 'Transaction failed',
        error: 'API_ERROR',
      };
    }
  }

  private formatTransactionResult(res: any, type: string): TransactionResult {
    if (res.status === 1) {
      const data = Array.isArray(res.data) ? {} : (res.data || {});
      return {
        success: true,
        orderId: res.order_id || data.order_id || undefined,
        utr: data.rrn || data.stan || res.order_id || undefined,
        status: 'success',
        message: res.message || 'Transaction successful',
        data: {
          balance: data.balance || undefined,
          accountNumber: data.account_number || undefined,
          bankName: data.bankName || undefined,
          amount: data.amount || undefined,
          miniStatement: type === 'mini_statement'
            ? this.normalizeMiniStatement(data.miniStatement)
            : undefined,
        },
      };
    }

    if (res.status === 3) {
      return {
        success: false,
        orderId: res.order_id || undefined,
        status: 'pending',
        message: res.message || 'Transaction pending',
        error: 'PENDING',
      };
    }

    return {
      success: false,
      orderId: res.order_id || undefined,
      status: 'failed',
      message: res.message || 'Transaction failed',
      error: 'FAILED',
    };
  }

  private normalizeMiniStatement(raw: unknown): MiniStatementEntry[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((e: any): MiniStatementEntry | null => {
        if (!e || typeof e !== 'object') return null;
        const date = e.date || e.txnDate || '';
        const narration = e.narration || e.description || e.remarks || '';
        const rawType = e.txnType || e.transactionType || e.type || '';
        const txnType: 'Dr' | 'Cr' =
          rawType === 'Cr' || rawType === 'CREDIT' || rawType === 'credit' || rawType === 'C' ? 'Cr' : 'Dr';
        const amount = String(e.amount || e.txnAmount || '0');
        if (!date && !narration) return null;
        return { date, narration, txnType, amount };
      })
      .filter((e): e is MiniStatementEntry => e !== null)
      .slice(0, 10);
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────
let _instance: Pay2NewAepsService | null = null;

/**
 * Returns the Pay2New AePS service.
 * When `outletId` is provided a fresh instance is returned for that specific
 * merchant (e.g. during PAN-based onboarding when the outletId is just created).
 * Otherwise the platform-level singleton is returned.
 */
export function getPay2NewAepsService(outletId?: string): Pay2NewAepsService {
  if (outletId) return new Pay2NewAepsService(outletId);
  if (!_instance) _instance = new Pay2NewAepsService();
  return _instance;
}
