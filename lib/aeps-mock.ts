/**
 * AEPS Mock Helper — for dev/test without real Chagans biometrics
 * Use in app/api/aeps/mock-login/route.ts and app/api/aeps/mock-payment/route.ts
 */

export interface MockLoginRequest {
  merchantId: string;
  type: 'deposit' | 'withdraw';
}

export interface MockLoginResponse {
  success: boolean;
  code: number;
  message: string;
  data: {
    loginStatus: boolean;
    bankList: Array<{ iin: string; bankName: string }>;
    wadh: string;
    route: string;
    kycStatus: string;
  };
}

export interface MockPaymentRequest {
  merchantId: string;
  type: 'balance' | 'withdraw' | 'deposit' | 'miniStatement';
  amount?: string | number;
  iin: string;
  adhar: string;
  cMobile: string;
}

export interface MockPaymentResponse {
  success: boolean;
  code: number;
  message: string;
  data: {
    status: string;
    orderId: string;
    bankName: string;
    accountNumber: string;
    amount: number;
    utr: string;
    bankAccountBalance: string;
    miniStatement: Array<{
      date: string;
      txnType: 'Dr' | 'Cr';
      amount: string;
      narration: string;
    }>;
  };
  type: string;
}

/**
 * Mock AEPS Login
 * Simulates successful biometric authentication without real device/Chagans
 */
export function mockAepsLogin(req: MockLoginRequest): MockLoginResponse {
  const { merchantId, type } = req;

  if (!merchantId) {
    return {
      success: false,
      code: 400,
      message: 'Merchant ID required',
      data: {
        loginStatus: false,
        bankList: [],
        wadh: '',
        route: '',
        kycStatus: '',
      },
    };
  }

  // Generate base64 encoded wadh for PID crypto simulation
  const wadhSeed = `${merchantId}_${type}_${Date.now()}_${Math.random()}`;
  const wadh = Buffer.from(wadhSeed).toString('base64');

  return {
    success: true,
    code: 200,
    message: 'AEPS login successful (mock)',
    data: {
      loginStatus: true,
      bankList: [
        { iin: '607094', bankName: 'HDFC Bank' },
        { iin: '607152', bankName: 'State Bank of India' },
        { iin: '505290', bankName: 'Axis Bank' },
      ],
      wadh,
      route: 'AIRTEL', // Can vary; your route
      kycStatus: 'ACTIVE',
    },
  };
}

/**
 * Mock AEPS Payment
 * Simulates transactions (balance, withdraw, deposit, mini statement) without real biometric
 */
export function mockAepsPayment(req: MockPaymentRequest): MockPaymentResponse {
  const { merchantId, type, amount, cMobile } = req;

  if (!merchantId) {
    return {
      success: false,
      code: 400,
      message: 'Merchant ID required',
      data: {
        status: 'failed',
        orderId: '',
        bankName: '',
        accountNumber: '',
        amount: 0,
        utr: '',
        bankAccountBalance: '0.00',
        miniStatement: [],
      },
      type,
    };
  }

  // Generate transaction IDs
  const orderId = `AEPSTXN${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const utr = Math.random().toString(36).substring(2, 14).toUpperCase();
  const last4 = (cMobile || '0000').slice(-4);
  const txnAmount = type === 'balance' || type === 'miniStatement' ? 0 : parseInt(String(amount || 0)) || 0;

  // Mock balance — varies by txn type
  let balance = '50000.00';
  if (type === 'withdraw' && txnAmount > 0) {
    balance = (50000 - txnAmount).toFixed(2);
  } else if (type === 'deposit' && txnAmount > 0) {
    balance = (50000 + txnAmount).toFixed(2);
  }

  const miniStatement =
    type === 'miniStatement'
      ? [
          { date: '2026-04-24', txnType: 'Dr' as const, amount: '1000.00', narration: 'ATM Withdrawal' },
          { date: '2026-04-23', txnType: 'Cr' as const, amount: '5000.00', narration: 'Salary Credit' },
          { date: '2026-04-22', txnType: 'Dr' as const, amount: '500.00', narration: 'POS Purchase' },
          { date: '2026-04-21', txnType: 'Cr' as const, amount: '2000.00', narration: 'Transfer In' },
          { date: '2026-04-20', txnType: 'Dr' as const, amount: '300.00', narration: 'Bill Payment' },
        ]
      : [];

  return {
    success: true,
    code: 200,
    message: 'Transaction Successful (mock)',
    data: {
      status: 'success',
      orderId,
      bankName: 'HDFC Bank',
      accountNumber: `XXXXXXXX${last4}`,
      amount: txnAmount,
      utr,
      bankAccountBalance: balance,
      miniStatement,
    },
    type,
  };
}
