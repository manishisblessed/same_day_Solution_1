export type Role =
  | 'retailer' | 'distributor' | 'master_distributor' | 'admin'
  | 'partner' | 'master_partner' | 'sub_partner' | 'finance_executive';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  name?: string;
  partner_id?: string;
  phone?: string;
  permissions?: Record<string, any>;
}

export type ServiceKey =
  | 'banking_payments' | 'mini_atm_pos' | 'aeps' | 'aadhaar_pay' | 'dmt'
  | 'bbps' | 'bbps2' | 'credit_card1' | 'credit_card1_plus' | 'credit_card2'
  | 'recharge' | 'travel' | 'cash_management' | 'lic' | 'insurance'
  | 'government' | 'doorstep_banking' | 'settlement' | 'settlement2' | 'api_payment';

export type EnabledServices = Partial<Record<ServiceKey, boolean>>;

export interface EnabledServicesResponse {
  services: EnabledServices;
  hasAnyEnabled: boolean;
}

export interface WalletBalanceResponse {
  success: boolean;
  balance: number;
  user_id: string;
  user_role: string;
  wallet_type: string;
  warning?: string;
}

export interface WalletLedgerRow {
  id: string;
  created_at: string;
  transaction_type?: string;
  amount: number;
  before_balance?: number;
  after_balance?: number;
  description?: string;
  reference_id?: string;
  status?: string;
  service_type?: string;
}

export interface Paginated<T> {
  success: boolean;
  data: T[];
  summary?: any;
  pagination?: {
    total: number; limit: number; offset: number; page?: number; totalPages?: number;
    hasNextPage?: boolean; hasPrevPage?: boolean;
  };
}

export interface ServiceTxnRow {
  id: string;
  service_type: string;
  transaction_id?: string;
  tid?: string;
  amount: number;
  status: string;
  commission?: number;
  mdr?: number;
  payment_mode?: string;
  card_type?: string;
  device_serial?: string;
  description?: string;
  created_at: string;
}

export interface Bank {
  id?: string;
  name: string;
  ifsc_prefix?: string;
}

export interface Beneficiary {
  id: string;
  account_number: string;
  ifsc_code: string;
  account_holder_name?: string;
  bank_name: string;
  nickname?: string;
  is_default?: boolean;
}
