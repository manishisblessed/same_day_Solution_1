-- ============================================================================
-- WALLET, LEDGER, LIMITS, SETTLEMENT & ADMIN CONTROLS INTEGRATION
-- ============================================================================
-- This schema integrates wallets, unified ledger, limits, settlement, and
-- admin controls AROUND the existing BBPS implementation.
-- DO NOT modify existing BBPS tables or logic.
-- ============================================================================

-- ============================================================================
-- 1. WALLETS TABLE
-- ============================================================================
-- Two wallets per user: PRIMARY and AEPS
-- PRIMARY wallet holds ALL balances (cash/online/commission are fund categories)
-- AEPS wallet is isolated for AEPS transactions only
-- ============================================================================

CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL, -- Can be retailer_id, distributor_id, master_distributor_id
  user_role TEXT NOT NULL CHECK (user_role IN ('retailer', 'distributor', 'master_distributor')),
  wallet_type TEXT NOT NULL CHECK (wallet_type IN ('primary', 'aeps')),
  balance DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  is_frozen BOOLEAN DEFAULT FALSE,
  is_settlement_held BOOLEAN DEFAULT FALSE, -- Only for primary wallet
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, wallet_type)
);

CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wallets_wallet_type ON wallets(wallet_type);
CREATE INDEX IF NOT EXISTS idx_wallets_user_role ON wallets(user_role);

-- ============================================================================
-- 2. UNIFIED LEDGER TABLE (EXTENDS EXISTING wallet_ledger)
-- ============================================================================
-- Single unified ledger for all transactions
-- Stores wallet_type, fund_category, and all transaction details
-- ============================================================================

-- First, drop the foreign key constraint on retailer_id if it exists
-- This is needed because retailer_id is now used as a generic user_id for all user types
-- (retailers, distributors, master_distributors) for backward compatibility
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'wallet_ledger_retailer_id_fkey' 
    AND table_name = 'wallet_ledger'
  ) THEN
    ALTER TABLE wallet_ledger DROP CONSTRAINT wallet_ledger_retailer_id_fkey;
  END IF;
END $$;

-- Add new columns to existing wallet_ledger if they don't exist
DO $$ 
BEGIN
  -- Add wallet_type column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'wallet_ledger' AND column_name = 'wallet_type') THEN
    ALTER TABLE wallet_ledger ADD COLUMN wallet_type TEXT DEFAULT 'primary' 
      CHECK (wallet_type IN ('primary', 'aeps'));
  END IF;

  -- Add fund_category column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'wallet_ledger' AND column_name = 'fund_category') THEN
    ALTER TABLE wallet_ledger ADD COLUMN fund_category TEXT 
      CHECK (fund_category IN ('cash', 'online', 'commission', 'settlement', 'adjustment', 'aeps', 'bbps', 'other'));
  END IF;

  -- Add credit and debit columns if they don't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'wallet_ledger' AND column_name = 'credit') THEN
    ALTER TABLE wallet_ledger ADD COLUMN credit DECIMAL(12, 2) DEFAULT 0 CHECK (credit >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'wallet_ledger' AND column_name = 'debit') THEN
    ALTER TABLE wallet_ledger ADD COLUMN debit DECIMAL(12, 2) DEFAULT 0 CHECK (debit >= 0);
  END IF;

  -- Add opening_balance if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'wallet_ledger' AND column_name = 'opening_balance') THEN
    ALTER TABLE wallet_ledger ADD COLUMN opening_balance DECIMAL(12, 2) DEFAULT 0;
  END IF;

  -- Handle balance_after to closing_balance migration
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'wallet_ledger' AND column_name = 'balance_after') THEN
    -- balance_after exists, add closing_balance and copy values
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'wallet_ledger' AND column_name = 'closing_balance') THEN
      ALTER TABLE wallet_ledger ADD COLUMN closing_balance DECIMAL(12, 2);
      -- Copy values from balance_after
      UPDATE wallet_ledger SET closing_balance = balance_after;
    END IF;
    -- Rename old column and make it nullable (it's a migration artifact)
    ALTER TABLE wallet_ledger RENAME COLUMN balance_after TO balance_after_old;
    -- Make it nullable (drop NOT NULL constraint if it exists)
    -- Check if column has NOT NULL constraint before trying to drop it
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'wallet_ledger' 
      AND column_name = 'balance_after_old' 
      AND is_nullable = 'NO'
    ) THEN
      ALTER TABLE wallet_ledger ALTER COLUMN balance_after_old DROP NOT NULL;
    END IF;
  ELSE
    -- balance_after doesn't exist, just add closing_balance if needed
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'wallet_ledger' AND column_name = 'closing_balance') THEN
      ALTER TABLE wallet_ledger ADD COLUMN closing_balance DECIMAL(12, 2) DEFAULT 0;
    END IF;
    -- If balance_after_old exists but balance_after doesn't, make it nullable
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'wallet_ledger' 
      AND column_name = 'balance_after_old' 
      AND is_nullable = 'NO'
    ) THEN
      ALTER TABLE wallet_ledger ALTER COLUMN balance_after_old DROP NOT NULL;
    END IF;
  END IF;

  -- Add status column if it doesn't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'wallet_ledger' AND column_name = 'status') THEN
    ALTER TABLE wallet_ledger ADD COLUMN status TEXT DEFAULT 'completed' 
      CHECK (status IN ('pending', 'completed', 'failed', 'reversed', 'hold'));
  END IF;

  -- Add service_type column for tracking BBPS/AEPS/Settlement
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'wallet_ledger' AND column_name = 'service_type') THEN
    ALTER TABLE wallet_ledger ADD COLUMN service_type TEXT 
      CHECK (service_type IN ('bbps', 'aeps', 'settlement', 'pos', 'admin', 'other'));
  END IF;

  -- Add user_role column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'wallet_ledger' AND column_name = 'user_role') THEN
    ALTER TABLE wallet_ledger ADD COLUMN user_role TEXT 
      CHECK (user_role IN ('retailer', 'distributor', 'master_distributor'));
  END IF;
END $$;

-- Update existing wallet_ledger rows to have default values
-- Handle balance_after_old if it exists (from rename)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns 
             WHERE table_name = 'wallet_ledger' AND column_name = 'balance_after_old') THEN
    UPDATE wallet_ledger 
    SET closing_balance = COALESCE(balance_after_old, closing_balance, 0)
    WHERE closing_balance IS NULL;
  END IF;
END $$;

-- Now update all rows with default values
UPDATE wallet_ledger 
SET 
  wallet_type = COALESCE(wallet_type, 'primary'),
  fund_category = COALESCE(fund_category, CASE 
    WHEN transaction_type = 'COMMISSION' THEN 'commission'
    WHEN transaction_type = 'POS_CREDIT' THEN 'online'
    WHEN transaction_type IN ('BBPS_DEBIT', 'BBPS_REFUND') THEN 'bbps'
    ELSE 'cash'
  END),
  credit = COALESCE(credit, CASE WHEN amount > 0 THEN amount ELSE 0 END),
  debit = COALESCE(debit, CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END),
  opening_balance = COALESCE(opening_balance, 
    COALESCE(
      (SELECT closing_balance FROM wallet_ledger wl2 
       WHERE wl2.retailer_id = wallet_ledger.retailer_id 
         AND wl2.created_at < wallet_ledger.created_at 
       ORDER BY wl2.created_at DESC LIMIT 1),
      0
    )
  ),
  closing_balance = COALESCE(closing_balance,
    COALESCE(opening_balance, 0) + 
    COALESCE(credit, CASE WHEN amount > 0 THEN amount ELSE 0 END) - 
    COALESCE(debit, CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END)
  ),
  status = COALESCE(status, 'completed'),
  service_type = COALESCE(service_type, CASE 
    WHEN transaction_type IN ('BBPS_DEBIT', 'BBPS_REFUND') THEN 'bbps'
    WHEN transaction_type = 'POS_CREDIT' THEN 'pos'
    ELSE 'other'
  END),
  user_role = COALESCE(user_role, 'retailer')
WHERE wallet_type IS NULL OR fund_category IS NULL;

-- Create indexes for new columns
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_wallet_type ON wallet_ledger(wallet_type);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_fund_category ON wallet_ledger(fund_category);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_service_type ON wallet_ledger(service_type);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_status ON wallet_ledger(status);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user_role ON wallet_ledger(user_role);

-- ============================================================================
-- 3. LIMITS SYSTEM
-- ============================================================================
-- Per user, per wallet limits for transactions and settlements
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_limits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL CHECK (user_role IN ('retailer', 'distributor', 'master_distributor')),
  wallet_type TEXT NOT NULL CHECK (wallet_type IN ('primary', 'aeps')),
  limit_type TEXT NOT NULL CHECK (limit_type IN ('per_transaction', 'daily_transaction', 'daily_settlement')),
  limit_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  is_enabled BOOLEAN DEFAULT TRUE,
  is_overridden BOOLEAN DEFAULT FALSE, -- Admin override
  override_by UUID, -- admin_users.id
  override_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, wallet_type, limit_type)
);

CREATE INDEX IF NOT EXISTS idx_user_limits_user_id ON user_limits(user_id);
CREATE INDEX IF NOT EXISTS idx_user_limits_wallet_type ON user_limits(wallet_type);
CREATE INDEX IF NOT EXISTS idx_user_limits_limit_type ON user_limits(limit_type);

-- Default limits for BBPS (₹49,999 max payment, higher slabs disabled)
CREATE TABLE IF NOT EXISTS bbps_limit_slabs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slab_name TEXT NOT NULL UNIQUE,
  min_amount DECIMAL(12, 2) NOT NULL,
  max_amount DECIMAL(12, 2) NOT NULL,
  is_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default BBPS limit slabs
INSERT INTO bbps_limit_slabs (slab_name, min_amount, max_amount, is_enabled) VALUES
  ('slab_1', 0, 49999, TRUE), -- Only this slab enabled by default
  ('slab_2', 50000, 99999, FALSE),
  ('slab_3', 100000, 199999, FALSE),
  ('slab_4', 200000, 499999, FALSE),
  ('slab_5', 500000, 999999, FALSE)
ON CONFLICT (slab_name) DO NOTHING;

-- ============================================================================
-- 4. SETTLEMENT SYSTEM
-- ============================================================================
-- Settlement from PRIMARY wallet to bank
-- Supports instant and T+1 modes
-- ============================================================================

CREATE TABLE IF NOT EXISTS settlements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL CHECK (user_role IN ('retailer', 'distributor', 'master_distributor')),
  settlement_mode TEXT NOT NULL CHECK (settlement_mode IN ('instant', 't+1')),
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  charge DECIMAL(12, 2) NOT NULL DEFAULT 0,
  net_amount DECIMAL(12, 2) NOT NULL, -- amount - charge
  bank_account_number TEXT NOT NULL,
  bank_ifsc TEXT NOT NULL,
  bank_account_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'success', 'failed', 'reversed', 'hold')),
  payout_reference_id TEXT UNIQUE, -- From payout API
  failure_reason TEXT,
  ledger_entry_id UUID, -- Reference to wallet_ledger
  reversal_ledger_id UUID, -- If reversed
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_settlements_user_id ON settlements(user_id);
CREATE INDEX IF NOT EXISTS idx_settlements_status ON settlements(status);
CREATE INDEX IF NOT EXISTS idx_settlements_idempotency_key ON settlements(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_settlements_created_at ON settlements(created_at);

-- Settlement charge slabs (final charges, no GST calculation)
CREATE TABLE IF NOT EXISTS settlement_charge_slabs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  min_amount DECIMAL(12, 2) NOT NULL,
  max_amount DECIMAL(12, 2) NOT NULL,
  charge DECIMAL(12, 2) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default settlement charge slabs
INSERT INTO settlement_charge_slabs (min_amount, max_amount, charge, is_active) VALUES
  (0, 49999, 20, TRUE),
  (50000, 99999, 30, TRUE),
  (100000, 149999, 50, TRUE),
  (150000, 184999, 70, TRUE)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 5. MDR & COMMISSION CONFIGURATION
-- ============================================================================
-- MDR values are FINAL and INCLUDE GST
-- Commission hierarchy: Retailer ≥ Distributor ≥ Master Distributor ≥ Admin
-- ============================================================================

CREATE TABLE IF NOT EXISTS mdr_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_type TEXT NOT NULL CHECK (service_type IN ('bbps', 'aeps', 'pos', 'other')),
  user_role TEXT NOT NULL CHECK (user_role IN ('retailer', 'distributor', 'master_distributor')),
  mdr_rate DECIMAL(8, 4) NOT NULL, -- Final MDR including GST
  is_active BOOLEAN DEFAULT TRUE,
  effective_from TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  effective_to TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mdr_config_service_type ON mdr_config(service_type);
CREATE INDEX IF NOT EXISTS idx_mdr_config_user_role ON mdr_config(user_role);

-- Commission tracking (commission credited to PRIMARY wallet with fund_category = commission)
CREATE TABLE IF NOT EXISTS commission_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id UUID NOT NULL, -- Reference to bbps_transactions, aeps_transactions, or razorpay_transactions
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('bbps', 'aeps', 'pos')),
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL CHECK (user_role IN ('retailer', 'distributor', 'master_distributor')),
  mdr_amount DECIMAL(12, 2) NOT NULL, -- MDR charged
  commission_rate DECIMAL(8, 4) NOT NULL, -- Commission rate for this user
  commission_amount DECIMAL(12, 2) NOT NULL, -- Commission earned
  is_locked BOOLEAN DEFAULT FALSE, -- Admin can lock commission
  ledger_entry_id UUID, -- Reference to wallet_ledger
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commission_ledger_user_id ON commission_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_commission_ledger_transaction_id ON commission_ledger(transaction_id);
CREATE INDEX IF NOT EXISTS idx_commission_ledger_transaction_type ON commission_ledger(transaction_type);

-- ============================================================================
-- 6. AEPS TRANSACTIONS
-- ============================================================================
-- AEPS uses AEPS wallet ONLY
-- Financial transactions debit/credit AEPS wallet
-- Non-financial transactions don't touch wallet
-- ============================================================================

CREATE TABLE IF NOT EXISTS aeps_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL CHECK (user_role IN ('retailer', 'distributor', 'master_distributor')),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('balance_inquiry', 'cash_withdrawal', 'aadhaar_to_aadhaar', 'mini_statement')),
  is_financial BOOLEAN NOT NULL, -- true for cash_withdrawal, aadhaar_to_aadhaar
  amount DECIMAL(12, 2), -- Only for financial transactions
  rrn TEXT UNIQUE, -- Retrieval Reference Number
  stan TEXT, -- System Trace Audit Number
  aadhaar_number_masked TEXT, -- Masked Aadhaar (last 4 digits)
  bank_iin TEXT, -- Bank IIN
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'reversed', 'under_reconciliation')),
  error_code TEXT,
  error_message TEXT,
  wallet_debited BOOLEAN DEFAULT FALSE,
  wallet_debit_id UUID, -- Reference to wallet_ledger
  wallet_credited BOOLEAN DEFAULT FALSE,
  wallet_credit_id UUID, -- Reference to wallet_ledger
  mdr_amount DECIMAL(12, 2),
  commission_rate DECIMAL(8, 4),
  commission_amount DECIMAL(12, 2),
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_aeps_transactions_user_id ON aeps_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_aeps_transactions_status ON aeps_transactions(status);
CREATE INDEX IF NOT EXISTS idx_aeps_transactions_rrn ON aeps_transactions(rrn);
CREATE INDEX IF NOT EXISTS idx_aeps_transactions_idempotency_key ON aeps_transactions(idempotency_key);

-- ============================================================================
-- 7. REVERSAL ENGINE
-- ============================================================================
-- Supports BBPS, AEPS, Settlement, and Admin reversals
-- Includes dispute handling with HOLD state
-- ============================================================================

CREATE TABLE IF NOT EXISTS reversals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  original_transaction_id UUID NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('bbps', 'aeps', 'settlement', 'admin', 'pos')),
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL,
  original_amount DECIMAL(12, 2) NOT NULL,
  reversal_amount DECIMAL(12, 2) NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'hold')),
  original_ledger_id UUID, -- Original ledger entry
  reversal_ledger_id UUID, -- Reversal ledger entry
  admin_id UUID, -- Admin who initiated reversal
  ip_address TEXT,
  remarks TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_reversals_original_transaction_id ON reversals(original_transaction_id);
CREATE INDEX IF NOT EXISTS idx_reversals_status ON reversals(status);
CREATE INDEX IF NOT EXISTS idx_reversals_user_id ON reversals(user_id);

-- Dispute handling
CREATE TABLE IF NOT EXISTS disputes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id UUID NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('bbps', 'aeps', 'settlement', 'pos')),
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL,
  dispute_type TEXT NOT NULL CHECK (dispute_type IN ('transaction_failure', 'amount_mismatch', 'duplicate_charge', 'unauthorized', 'other')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'under_review', 'resolved', 'rejected')),
  description TEXT NOT NULL,
  resolution TEXT,
  resolved_by UUID, -- admin_users.id
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disputes_transaction_id ON disputes(transaction_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);
CREATE INDEX IF NOT EXISTS idx_disputes_user_id ON disputes(user_id);

-- ============================================================================
-- 8. ADMIN AUDIT LOG
-- ============================================================================
-- Logs all admin actions with IP address, before/after balances, etc.
-- ============================================================================

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID NOT NULL REFERENCES admin_users(id),
  action_type TEXT NOT NULL CHECK (action_type IN (
    'wallet_push', 'wallet_pull', 'wallet_freeze', 'wallet_unfreeze',
    'settlement_hold', 'settlement_release', 'commission_lock', 'commission_unlock',
    'limit_override', 'limit_update', 'transaction_reverse', 'user_enable', 'user_disable',
    'aeps_enable', 'aeps_disable', 'bbps_slab_enable', 'bbps_slab_disable'
  )),
  target_user_id TEXT,
  target_user_role TEXT,
  wallet_type TEXT CHECK (wallet_type IN ('primary', 'aeps')),
  fund_category TEXT,
  amount DECIMAL(12, 2),
  before_balance DECIMAL(12, 2),
  after_balance DECIMAL(12, 2),
  ip_address TEXT,
  user_agent TEXT,
  remarks TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin_id ON admin_audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action_type ON admin_audit_log(action_type);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target_user_id ON admin_audit_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at ON admin_audit_log(created_at);

-- ============================================================================
-- 9. FUNCTIONS FOR WALLET OPERATIONS
-- ============================================================================

-- Function to get wallet balance (supports both wallet types)
CREATE OR REPLACE FUNCTION get_wallet_balance_v2(
  p_user_id TEXT,
  p_wallet_type TEXT DEFAULT 'primary'
)
RETURNS DECIMAL(12, 2) AS $$
DECLARE
  v_balance DECIMAL(12, 2);
BEGIN
  SELECT balance INTO v_balance
  FROM wallets
  WHERE user_id = p_user_id AND wallet_type = p_wallet_type;
  
  RETURN COALESCE(v_balance, 0);
END;
$$ LANGUAGE plpgsql;

-- Function to create or get wallet
CREATE OR REPLACE FUNCTION ensure_wallet(
  p_user_id TEXT,
  p_user_role TEXT,
  p_wallet_type TEXT
)
RETURNS UUID AS $$
DECLARE
  v_wallet_id UUID;
BEGIN
  INSERT INTO wallets (user_id, user_role, wallet_type, balance)
  VALUES (p_user_id, p_user_role, p_wallet_type, 0)
  ON CONFLICT (user_id, wallet_type) DO UPDATE SET updated_at = NOW()
  RETURNING id INTO v_wallet_id;
  
  RETURN v_wallet_id;
END;
$$ LANGUAGE plpgsql;

-- Function to add ledger entry and update wallet balance (with row-level locking)
CREATE OR REPLACE FUNCTION add_ledger_entry(
  p_user_id TEXT,
  p_user_role TEXT,
  p_wallet_type TEXT,
  p_fund_category TEXT,
  p_service_type TEXT,
  p_tx_type TEXT,
  p_credit DECIMAL(12, 2) DEFAULT 0,
  p_debit DECIMAL(12, 2) DEFAULT 0,
  p_reference_id TEXT DEFAULT NULL,
  p_transaction_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT 'completed',
  p_remarks TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_wallet_id UUID;
  v_opening_balance DECIMAL(12, 2);
  v_closing_balance DECIMAL(12, 2);
  v_ledger_id UUID;
BEGIN
  -- Ensure wallet exists
  SELECT ensure_wallet(p_user_id, p_user_role, p_wallet_type) INTO v_wallet_id;
  
  -- Lock wallet row for update
  SELECT balance INTO v_opening_balance
  FROM wallets
  WHERE user_id = p_user_id AND wallet_type = p_wallet_type
  FOR UPDATE;
  
  -- Calculate closing balance
  v_closing_balance := v_opening_balance + p_credit - p_debit;
  
  -- Insert ledger entry
  -- Note: balance_after_old is a migration artifact column that may exist
  INSERT INTO wallet_ledger (
    retailer_id, -- Keep for backward compatibility
    user_role,
    wallet_type,
    fund_category,
    service_type,
    transaction_type,
    transaction_id,
    amount, -- Net transaction amount (credit - debit)
    credit,
    debit,
    opening_balance,
    closing_balance,
    reference_id,
    status,
    description,
    balance_after_old, -- Migration artifact, set to NULL if column exists
    created_at
  ) VALUES (
    p_user_id,
    p_user_role,
    p_wallet_type,
    p_fund_category,
    p_service_type,
    p_tx_type,
    p_transaction_id,
    p_credit - p_debit, -- Net amount: positive for credits, negative for debits
    p_credit,
    p_debit,
    v_opening_balance,
    v_closing_balance,
    p_reference_id,
    p_status,
    p_remarks,
    NULL, -- balance_after_old is a migration artifact, set to NULL
    NOW()
  ) RETURNING id INTO v_ledger_id;
  
  -- Update wallet balance
  UPDATE wallets
  SET balance = v_closing_balance, updated_at = NOW()
  WHERE user_id = p_user_id AND wallet_type = p_wallet_type;
  
  RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 10. TRIGGERS
-- ============================================================================

-- Trigger to update updated_at
DROP TRIGGER IF EXISTS update_wallets_updated_at ON wallets;
CREATE TRIGGER update_wallets_updated_at BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_limits_updated_at ON user_limits;
CREATE TRIGGER update_user_limits_updated_at BEFORE UPDATE ON user_limits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_settlements_updated_at ON settlements;
CREATE TRIGGER update_settlements_updated_at BEFORE UPDATE ON settlements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_aeps_transactions_updated_at ON aeps_transactions;
CREATE TRIGGER update_aeps_transactions_updated_at BEFORE UPDATE ON aeps_transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_reversals_updated_at ON reversals;
CREATE TRIGGER update_reversals_updated_at BEFORE UPDATE ON reversals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_disputes_updated_at ON disputes;
CREATE TRIGGER update_disputes_updated_at BEFORE UPDATE ON disputes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 11. RLS POLICIES
-- ============================================================================

ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE aeps_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE mdr_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE bbps_limit_slabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_charge_slabs ENABLE ROW LEVEL SECURITY;

-- Basic RLS policies (adjust based on your security requirements)
DROP POLICY IF EXISTS "Anyone can read wallets" ON wallets;
CREATE POLICY "Anyone can read wallets" ON wallets FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins can manage wallets" ON wallets;
CREATE POLICY "Admins can manage wallets" ON wallets FOR ALL USING (true);

-- Similar policies for other tables (simplified for now)
-- In production, implement proper role-based access control

-- ============================================================================
-- 12. MIGRATION: Initialize wallets for existing retailers
-- ============================================================================

-- Create PRIMARY wallets for all existing retailers
INSERT INTO wallets (user_id, user_role, wallet_type, balance)
SELECT 
  partner_id,
  'retailer',
  'primary',
  COALESCE((SELECT closing_balance FROM wallet_ledger 
            WHERE retailer_id = retailers.partner_id 
            ORDER BY created_at DESC LIMIT 1), 0)
FROM retailers
ON CONFLICT (user_id, wallet_type) DO NOTHING;

-- Create PRIMARY wallets for all existing distributors
INSERT INTO wallets (user_id, user_role, wallet_type, balance)
SELECT 
  partner_id,
  'distributor',
  'primary',
  0 -- Distributors start with 0 balance
FROM distributors
ON CONFLICT (user_id, wallet_type) DO NOTHING;

-- Create PRIMARY wallets for all existing master distributors
INSERT INTO wallets (user_id, user_role, wallet_type, balance)
SELECT 
  partner_id,
  'master_distributor',
  'primary',
  0 -- Master distributors start with 0 balance
FROM master_distributors
ON CONFLICT (user_id, wallet_type) DO NOTHING;

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================

