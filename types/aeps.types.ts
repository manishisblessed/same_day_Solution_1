/**
 * AEPS Types — Complete type definitions for AEPS system
 */

// Transaction types
export type AEPSTransactionType = 
  | 'balance_inquiry' 
  | 'cash_withdrawal' 
  | 'cash_deposit' 
  | 'mini_statement' 
  | 'aadhaar_to_aadhaar';

export type AEPSStatus = 
  | 'pending' 
  | 'processing' 
  | 'success' 
  | 'failed' 
  | 'reversed' 
  | 'under_reconciliation';

export type AEPSRoute = 'AIRTEL' | 'JIO' | 'PAYTM' | 'OTHER';

// Bank information
export interface AEPSBank {
  iin: string;
  bankName: string;
  shortName?: string;
  isActive?: boolean;
}

// Merchant types
export interface AEPSMerchant {
  merchantId: string;
  name: string;
  mobile: string;
  email: string;
  pan: string;
  aadhaar: string;
  kycStatus: 'pending' | 'validated' | 'rejected';
  bankPipe?: string;
  route?: AEPSRoute;
  address?: {
    full: string;
    city: string;
    pincode: string;
  };
  bankAccountNo?: string;
  bankIfsc?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateMerchantRequest {
  mobile: string;
  name: string;
  gender: 'M' | 'F';
  pan: string;
  email: string;
  address: {
    full: string;
    city: string;
    pincode: string;
  };
  aadhaar: string;
  dateOfBirth: string;
  latitude: string;
  longitude: string;
  bankAccountNo: string;
  bankIfsc: string;
}

export interface CreateMerchantResponse {
  success: boolean;
  code: number;
  message: string;
  data: {
    merchantId: string;
    kycStatus: string;
    bankPipe?: string;
    providerResponse?: string;
  };
}

// Login status
export interface AEPSLoginStatusRequest {
  merchantId: string;
  type: 'deposit' | 'withdraw';
}

export interface AEPSLoginStatusResponse {
  success: boolean;
  code: number;
  message: string;
  data: {
    loginStatus: boolean;
    bankList: AEPSBank[];
    kycStatus?: string;
    wadh?: string;
    route?: AEPSRoute;
  };
}

// AEPS Login (biometric)
export interface AEPSLoginRequest {
  merchantId: string;
  transType: 'deposit' | 'withdraw';
  bioType: 'FINGER' | 'FACE';
  // Device fields
  dc: string;
  ci: string;
  hmac: string;
  dpId: string;
  mc: string;
  pidDataType: string;
  mi: string;
  rdsId: string;
  sessionKey: string;
  fCount: string;
  errCode: string;
  pCount: string;
  fType: string;
  iCount: string;
  pType: string;
  srno: string;
  pidData: string;
  qScore: string;
  nmPoints: string;
  rdsVer: string;
}

export interface AEPSLoginResponse {
  success: boolean;
  code: number;
  message: string;
  data?: {
    loginStatus?: boolean;
    wadh?: string;
    route?: string;
  };
}

// AEPS Payment
export interface AEPSPaymentRequest {
  merchantId: string;
  type: 'withdraw' | 'deposit' | 'balance' | 'miniStatement';
  amount: string;
  iin: string;
  adhar: string;
  cMobile: string;
  bioType: 'FINGER' | 'FACE';
  // Device fields (same as login)
  dc: string;
  ci: string;
  hmac: string;
  dpId: string;
  mc: string;
  pidDataType: string;
  mi: string;
  rdsId: string;
  sessionKey: string;
  fCount: string;
  errCode: string;
  pCount: string;
  fType: string;
  iCount: string;
  pType: string;
  srno: string;
  pidData: string;
  qScore: string;
  nmPoints: string;
  rdsVer: string;
}

export interface MiniStatementEntry {
  date: string;
  txnType: 'Dr' | 'Cr';
  amount: string;
  narration: string;
}

export interface AEPSPaymentResponse {
  success: boolean;
  code: number;
  message: string;
  type: string;
  data: {
    status: 'success' | 'failed' | 'pending';
    orderId: string;
    bankName: string;
    accountNumber: string;
    amount: number;
    utr: string;
    bankAccountBalance: string | null;
    miniStatement: MiniStatementEntry[];
    txnId?: string;
  };
}

// Transaction record
export interface AEPSTransactionRecord {
  id: string;
  user_id: string;
  user_role: string;
  merchant_id?: string;
  transaction_type: AEPSTransactionType;
  is_financial: boolean;
  amount?: number;
  aadhaar_number_masked?: string;
  bank_iin?: string;
  bank_name?: string;
  account_number_masked?: string;
  rrn?: string;
  stan?: string;
  utr?: string;
  order_id?: string;
  status: AEPSStatus;
  error_message?: string;
  balance_after?: number;
  mini_statement?: MiniStatementEntry[];
  wallet_debited?: boolean;
  wallet_debit_id?: string;
  idempotency_key?: string;
  created_at: string;
  completed_at?: string;
}

// UI State types
export interface AEPSUIState {
  step: 'select' | 'input' | 'biometric' | 'processing' | 'result';
  transactionType: AEPSTransactionType | null;
  selectedBank: AEPSBank | null;
  amount: string;
  customerAadhaar: string;
  customerMobile: string;
  isLoading: boolean;
  error: string | null;
  result: AEPSPaymentResponse | null;
}

// Service config
export interface AEPSServiceConfig {
  useMock: boolean;
  baseUrl: string;
  mockBaseUrl: string;
  clientId: string;
  clientSecret: string;
  authToken: string;
}

// Wallet balance
export interface AEPSWalletInfo {
  balance: number;
  isFrozen: boolean;
  lastUpdated: string;
}
