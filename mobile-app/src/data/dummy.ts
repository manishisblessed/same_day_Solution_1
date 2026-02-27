import { TransactionStatus, SettlementStatus } from '../constants';

export interface Transaction {
  id: string;
  type: string;
  description: string;
  amount: number;
  status: TransactionStatus;
  date: string;
  referenceId: string;
  category: string;
  mdr?: number;
  netAmount?: number;
  paymentMode?: string;
}

export interface WalletTransaction {
  id: string;
  type: 'credit' | 'debit';
  description: string;
  amount: number;
  balance: number;
  date: string;
  referenceId: string;
  serviceType: string;
}

export interface Settlement {
  id: string;
  amount: number;
  charges: number;
  netAmount: number;
  status: SettlementStatus;
  bankName: string;
  accountNumber: string;
  utr: string;
  createdAt: string;
  completedAt?: string;
}

export interface RetailerProfile {
  id: string;
  partnerId: string;
  name: string;
  email: string;
  phone: string;
  shopName: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  panNumber: string;
  aadharNumber: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankName: string;
  distributorName: string;
  kycStatus: 'verified' | 'pending' | 'rejected';
  createdAt: string;
}

export const retailerProfile: RetailerProfile = {
  id: '1',
  partnerId: 'SD-RET-100234',
  name: 'Rajesh Kumar',
  email: 'rajesh.kumar@example.com',
  phone: '+91 98765 43210',
  shopName: 'Rajesh Digital Services',
  address: '123, MG Road, Sector 15',
  city: 'Noida',
  state: 'Uttar Pradesh',
  pincode: '201301',
  panNumber: 'ABCPK1234A',
  aadharNumber: '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u20225678',
  bankAccountNumber: '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u20221234',
  bankIfsc: 'SBIN0001234',
  bankName: 'State Bank of India',
  distributorName: 'Metro Distributors Pvt Ltd',
  kycStatus: 'verified',
  createdAt: '2024-06-15T10:30:00Z',
};

export const walletBalance = {
  primary: 45672.50,
  aeps: 12340.00,
};

export const todaySummary = {
  totalTransactions: 47,
  totalRevenue: 234500.00,
  commissionEarned: 1876.50,
  successRate: 94.2,
};

export const recentTransactions: Transaction[] = [
  {
    id: 'txn_001',
    type: 'BBPS',
    description: 'Electricity Bill - BSES Rajdhani',
    amount: 3450.00,
    status: 'success',
    date: '2026-02-25T14:30:00Z',
    referenceId: 'BBP2602250001',
    category: 'Utility Bills',
    paymentMode: 'Wallet',
  },
  {
    id: 'txn_002',
    type: 'POS',
    description: 'POS Transaction - Card Payment',
    amount: 15000.00,
    status: 'success',
    date: '2026-02-25T13:15:00Z',
    referenceId: 'POS2602250042',
    category: 'POS',
    mdr: 150.00,
    netAmount: 14850.00,
    paymentMode: 'Card',
  },
  {
    id: 'txn_003',
    type: 'BBPS',
    description: 'Mobile Recharge - Airtel Prepaid',
    amount: 599.00,
    status: 'success',
    date: '2026-02-25T12:45:00Z',
    referenceId: 'BBP2602250002',
    category: 'Recharge',
    paymentMode: 'Wallet',
  },
  {
    id: 'txn_004',
    type: 'AEPS',
    description: 'AEPS Cash Withdrawal',
    amount: 5000.00,
    status: 'pending',
    date: '2026-02-25T11:30:00Z',
    referenceId: 'AEP2602250012',
    category: 'AEPS',
    paymentMode: 'Aadhaar',
  },
  {
    id: 'txn_005',
    type: 'Payout',
    description: 'Settlement to Bank - SBI',
    amount: 25000.00,
    status: 'processing',
    date: '2026-02-25T10:00:00Z',
    referenceId: 'PAY2602250005',
    category: 'Settlement',
    paymentMode: 'NEFT',
  },
  {
    id: 'txn_006',
    type: 'BBPS',
    description: 'DTH Recharge - Tata Play',
    amount: 450.00,
    status: 'success',
    date: '2026-02-25T09:20:00Z',
    referenceId: 'BBP2602250003',
    category: 'Recharge',
    paymentMode: 'Wallet',
  },
  {
    id: 'txn_007',
    type: 'BBPS',
    description: 'Gas Bill - IGL',
    amount: 1890.00,
    status: 'failed',
    date: '2026-02-24T16:45:00Z',
    referenceId: 'BBP2402250004',
    category: 'Utility Bills',
    paymentMode: 'Wallet',
  },
  {
    id: 'txn_008',
    type: 'POS',
    description: 'POS Transaction - UPI Payment',
    amount: 8500.00,
    status: 'success',
    date: '2026-02-24T15:30:00Z',
    referenceId: 'POS2402250035',
    category: 'POS',
    mdr: 85.00,
    netAmount: 8415.00,
    paymentMode: 'UPI',
  },
  {
    id: 'txn_009',
    type: 'BBPS',
    description: 'Water Bill - Delhi Jal Board',
    amount: 780.00,
    status: 'success',
    date: '2026-02-24T14:00:00Z',
    referenceId: 'BBP2402250005',
    category: 'Utility Bills',
    paymentMode: 'Wallet',
  },
  {
    id: 'txn_010',
    type: 'Commission',
    description: 'Commission Credit - BBPS',
    amount: 125.50,
    status: 'success',
    date: '2026-02-24T12:00:00Z',
    referenceId: 'COM2402250001',
    category: 'Commission',
    paymentMode: 'System',
  },
];

export const walletTransactions: WalletTransaction[] = [
  {
    id: 'wt_001',
    type: 'debit',
    description: 'BBPS - Electricity Bill Payment',
    amount: 3450.00,
    balance: 45672.50,
    date: '2026-02-25T14:30:00Z',
    referenceId: 'BBP2602250001',
    serviceType: 'BBPS',
  },
  {
    id: 'wt_002',
    type: 'credit',
    description: 'POS Settlement Credit',
    amount: 14850.00,
    balance: 49122.50,
    date: '2026-02-25T13:15:00Z',
    referenceId: 'POS2602250042',
    serviceType: 'POS',
  },
  {
    id: 'wt_003',
    type: 'debit',
    description: 'Mobile Recharge - Airtel',
    amount: 599.00,
    balance: 34272.50,
    date: '2026-02-25T12:45:00Z',
    referenceId: 'BBP2602250002',
    serviceType: 'BBPS',
  },
  {
    id: 'wt_004',
    type: 'credit',
    description: 'Commission Credit - BBPS',
    amount: 125.50,
    balance: 34871.50,
    date: '2026-02-25T12:00:00Z',
    referenceId: 'COM2602250001',
    serviceType: 'Commission',
  },
  {
    id: 'wt_005',
    type: 'debit',
    description: 'Settlement to Bank - SBI',
    amount: 25000.00,
    balance: 34746.00,
    date: '2026-02-25T10:00:00Z',
    referenceId: 'PAY2602250005',
    serviceType: 'Settlement',
  },
  {
    id: 'wt_006',
    type: 'debit',
    description: 'DTH Recharge - Tata Play',
    amount: 450.00,
    balance: 59746.00,
    date: '2026-02-25T09:20:00Z',
    referenceId: 'BBP2602250003',
    serviceType: 'BBPS',
  },
  {
    id: 'wt_007',
    type: 'credit',
    description: 'Wallet Top-up by Distributor',
    amount: 50000.00,
    balance: 60196.00,
    date: '2026-02-24T18:00:00Z',
    referenceId: 'WTC2402250001',
    serviceType: 'Wallet Credit',
  },
  {
    id: 'wt_008',
    type: 'credit',
    description: 'Reversal - Gas Bill Failed',
    amount: 1890.00,
    balance: 12086.00,
    date: '2026-02-24T16:50:00Z',
    referenceId: 'REV2402250001',
    serviceType: 'Reversal',
  },
  {
    id: 'wt_009',
    type: 'credit',
    description: 'POS Settlement Credit',
    amount: 8415.00,
    balance: 10196.00,
    date: '2026-02-24T15:30:00Z',
    referenceId: 'POS2402250035',
    serviceType: 'POS',
  },
  {
    id: 'wt_010',
    type: 'debit',
    description: 'Water Bill - Delhi Jal Board',
    amount: 780.00,
    balance: 1781.00,
    date: '2026-02-24T14:00:00Z',
    referenceId: 'BBP2402250005',
    serviceType: 'BBPS',
  },
];

export const settlements: Settlement[] = [
  {
    id: 'stl_001',
    amount: 25000.00,
    charges: 5.90,
    netAmount: 24994.10,
    status: 'processing',
    bankName: 'State Bank of India',
    accountNumber: '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u20221234',
    utr: '',
    createdAt: '2026-02-25T10:00:00Z',
  },
  {
    id: 'stl_002',
    amount: 50000.00,
    charges: 11.80,
    netAmount: 49988.20,
    status: 'completed',
    bankName: 'State Bank of India',
    accountNumber: '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u20221234',
    utr: 'SBIN26055123456',
    createdAt: '2026-02-24T09:30:00Z',
    completedAt: '2026-02-24T10:15:00Z',
  },
  {
    id: 'stl_003',
    amount: 30000.00,
    charges: 7.08,
    netAmount: 29992.92,
    status: 'completed',
    bankName: 'State Bank of India',
    accountNumber: '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u20221234',
    utr: 'SBIN26054987654',
    createdAt: '2026-02-23T11:00:00Z',
    completedAt: '2026-02-23T11:45:00Z',
  },
  {
    id: 'stl_004',
    amount: 15000.00,
    charges: 3.54,
    netAmount: 14996.46,
    status: 'completed',
    bankName: 'State Bank of India',
    accountNumber: '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u20221234',
    utr: 'SBIN26053654321',
    createdAt: '2026-02-22T14:00:00Z',
    completedAt: '2026-02-22T14:30:00Z',
  },
  {
    id: 'stl_005',
    amount: 10000.00,
    charges: 2.36,
    netAmount: 9997.64,
    status: 'failed',
    bankName: 'State Bank of India',
    accountNumber: '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u20221234',
    utr: '',
    createdAt: '2026-02-21T16:30:00Z',
  },
  {
    id: 'stl_006',
    amount: 40000.00,
    charges: 9.44,
    netAmount: 39990.56,
    status: 'completed',
    bankName: 'State Bank of India',
    accountNumber: '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u20221234',
    utr: 'SBIN26051234567',
    createdAt: '2026-02-20T10:00:00Z',
    completedAt: '2026-02-20T10:20:00Z',
  },
];

export const settlementSummary = {
  totalSettled: 170000.00,
  pendingAmount: 25000.00,
  thisMonthSettled: 145000.00,
  totalCharges: 40.12,
};
