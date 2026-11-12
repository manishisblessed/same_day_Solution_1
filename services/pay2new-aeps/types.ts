/**
 * Pay2New AePS API — Type Definitions
 * Base URL: https://pay2new.in/apis/aeps/v1/
 * Auth: secret + outletId headers (same as BBPS)
 * Status: 1=success, 2=failure, 3=pending/uncertain
 */

export interface Pay2NewAepsBase {
  status: 1 | 2 | 3;
  message: string;
  order_id?: string | null;
}

// ─── Bank List ───────────────────────────────────────────────────────────────
export interface Pay2NewBank {
  iin: string;
  bankName: string;
}

export interface Pay2NewBankListResponse extends Pay2NewAepsBase {
  data?: Pay2NewBank[];
}

// ─── Biometric KYC Status ────────────────────────────────────────────────────
export type Pay2NewKycAction = 'ACTION-REQUIRED' | 'NO-ACTION-REQUIRED' | '';
export type Pay2NewKycStatus = 'APPROVED' | 'PENDING' | 'APPROVAL_PENDING' | '';

export interface Pay2NewBioKycStatusData {
  customer_aadhaar_number: string;
  status: Pay2NewKycStatus;
  action: Pay2NewKycAction;
  referenceKey: string;
  pidOptionWadh: string;
}

export interface Pay2NewBioKycStatusResponse extends Pay2NewAepsBase {
  data?: Pay2NewBioKycStatusData;
}

// ─── Biometric Data (common to KYC, Login, Transactions) ─────────────────────
export interface Pay2NewBiometricData {
  aadhaar_number: string;  // 12-digit Aadhaar; Pay2New encrypts internally
  dc: string;
  ci: string;
  hmac: string;
  dpId: string;
  mc: string;
  pidDataType: string;     // e.g. "X"
  sessionKey: string;
  mi: string;
  rdsId: string;
  errCode: string;
  errInfo?: string;
  fCount: string;
  fType: string;
  iCount: string;
  iType?: string;
  pCount: string;
  pType?: string;
  srno: string;
  sysid?: string;
  ts?: string;
  pidData: string;
  qScore: string;
  nmPoints: string;
  rdsVer: string;
}

// ─── Biometric KYC Submit ─────────────────────────────────────────────────────
export interface Pay2NewBioKycRequest {
  referenceKey: string;
  latitude: string;
  longitude: string;
  request_id: string;
  biometricData: Pay2NewBiometricData;
}

export interface Pay2NewBioKycResponse extends Pay2NewAepsBase {
  data?: [] | Record<string, unknown>;
}

// ─── Merchant Login Status ────────────────────────────────────────────────────
export interface Pay2NewMerchantLoginStatusData {
  login_status?: 1 | 2;  // 1=logged in, 2=login required
  [key: string]: unknown;
}

export interface Pay2NewMerchantLoginStatusResponse extends Pay2NewAepsBase {
  data?: Pay2NewMerchantLoginStatusData;
}

// ─── Merchant Login ───────────────────────────────────────────────────────────
export interface Pay2NewMerchantLoginRequest {
  latitude: string;
  longitude: string;
  type: 'DAILY_LOGIN' | 'TXN_AUTH';
  bankiin?: string;        // required when type=TXN_AUTH
  captureType?: 'FINGER' | 'IRIS' | 'FACE';
  biometricData: Pay2NewBiometricData;
}

export interface Pay2NewMerchantLoginResponse extends Pay2NewAepsBase {
  data?: Record<string, unknown>;
}

// ─── Transaction OTP (for withdrawals > ₹5,000) ──────────────────────────────
export interface Pay2NewTransactionOtpRequest {
  product_code: string;
  amount: string;
  bankiin: string;
  customer_mobile: string;
  latitude: string;
  longitude: string;
  ip: string;
  biometricData: Pick<Pay2NewBiometricData, 'aadhaar_number'> & Partial<Pay2NewBiometricData>;
}

export interface Pay2NewTransactionOtpData {
  referenceKey?: string;
  validity?: string;
  [key: string]: unknown;
}

export interface Pay2NewTransactionOtpResponse extends Pay2NewAepsBase {
  data?: Pay2NewTransactionOtpData;
}

// ─── Cash Withdrawal / Cash Deposit ──────────────────────────────────────────
export interface Pay2NewCashRequest {
  amount: string;
  bankiin: string;
  latitude: string;
  longitude: string;
  customer_mobile: string;
  request_id: string;
  product_code: string;
  ip: string;
  biometricData: Pay2NewBiometricData;
  captureType?: 'FINGER' | 'IRIS' | 'FACE';
  referenceKey?: string;   // required when amount > ₹5,000 for withdrawal
}

export interface Pay2NewTransactionData {
  order_id?: string;
  rrn?: string;
  stan?: string;
  balance?: string;
  account_number?: string;
  bankName?: string;
  amount?: number | string;
  [key: string]: unknown;
}

export interface Pay2NewCashResponse extends Pay2NewAepsBase {
  data?: Pay2NewTransactionData;
}

// ─── Balance Check ────────────────────────────────────────────────────────────
export interface Pay2NewBalanceCheckRequest {
  bankiin: string;
  latitude: string;
  longitude: string;
  customer_mobile: string;
  request_id: string;
  product_code: string;
  ip: string;
  biometricData: Pay2NewBiometricData;
  captureType?: 'FINGER' | 'IRIS' | 'FACE';
}

export interface Pay2NewBalanceData {
  balance?: string;
  account_number?: string;
  bankName?: string;
  [key: string]: unknown;
}

export interface Pay2NewBalanceCheckResponse extends Pay2NewAepsBase {
  data?: Pay2NewBalanceData;
}

// ─── Mini Statement ───────────────────────────────────────────────────────────
export interface Pay2NewMiniStatementRequest {
  bankiin: string;
  latitude: string;
  longitude: string;
  customer_mobile: string;
  request_id: string;
  product_code: string;
  ip: string;
  biometricData: Pay2NewBiometricData;
  captureType?: 'FINGER' | 'IRIS' | 'FACE';
}

export interface Pay2NewMiniStatementEntry {
  date?: string;
  amount?: string;
  txnType?: 'Dr' | 'Cr';
  narration?: string;
  [key: string]: unknown;
}

export interface Pay2NewMiniStatementData {
  miniStatement?: Pay2NewMiniStatementEntry[];
  account_number?: string;
  [key: string]: unknown;
}

export interface Pay2NewMiniStatementResponse extends Pay2NewAepsBase {
  data?: Pay2NewMiniStatementData;
}

// ─── Aadhaar Pay ──────────────────────────────────────────────────────────────
export interface Pay2NewAadhaarPayRequest {
  amount: string;
  bankiin: string;
  latitude: string;
  longitude: string;
  customer_mobile: string;
  request_id: string;
  product_code: string;
  ip: string;
  biometricData: Pay2NewBiometricData;
  captureType?: 'FINGER' | 'IRIS' | 'FACE';
  referenceKey?: string;
}

export interface Pay2NewAadhaarPayResponse extends Pay2NewAepsBase {
  data?: Pay2NewTransactionData;
}

// ─── Settlement Account List ──────────────────────────────────────────────────
export interface Pay2NewSettlementAccount {
  id: string;
  account_holder_name: string;
  account_number: string;
  ifsc: string;
  bank: string;
  is_verified: 0 | 1;
  instantpay_status: string;
}

export interface Pay2NewSettlementAccountListResponse extends Pay2NewAepsBase {
  data?: Pay2NewSettlementAccount[];
}

// ─── Settlement Add Account ───────────────────────────────────────────────────
export interface Pay2NewSettlementAddRequest {
  bank: string;
  account_holder_name: string;
  account_number: string;
  ifsc: string;
  latitude: string;
  longitude: string;
  terms_agree: 'Y';
  request_id: string;
  ip: string;
}

export interface Pay2NewSettlementAddResponse extends Pay2NewAepsBase {
  data?: {
    id?: string;
    instantpay_status?: string;
    is_verified?: 0 | 1;
    txn_status?: string;
    [key: string]: unknown;
  };
}

// ─── Settlement Delete Account ────────────────────────────────────────────────
export interface Pay2NewSettlementDeleteRequest {
  id: string; // digits only, from accountList
}

export interface Pay2NewSettlementDeleteResponse extends Pay2NewAepsBase {
  data?: Record<string, unknown>;
}
