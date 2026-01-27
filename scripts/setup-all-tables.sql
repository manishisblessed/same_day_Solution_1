-- ============================================================================
-- COMPLETE DATABASE SETUP SCRIPT
-- Run this ONCE in Supabase SQL Editor to set up all tables
-- This handles all dependencies in the correct order
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. BASE TABLES (No dependencies)
-- ============================================================================

-- Admin Users Table
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'admin' CHECK (role IN ('admin', 'super_admin', 'sub_admin')),
  permissions JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Master Distributors Table
CREATE TABLE IF NOT EXISTS master_distributors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  business_name TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  gst_number TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  commission_rate DECIMAL(5,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Distributors Table
CREATE TABLE IF NOT EXISTS distributors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  business_name TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  gst_number TEXT,
  master_distributor_id TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  commission_rate DECIMAL(5,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  FOREIGN KEY (master_distributor_id) REFERENCES master_distributors(partner_id) ON DELETE SET NULL
);

-- Retailers Table
CREATE TABLE IF NOT EXISTS retailers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  business_name TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  gst_number TEXT,
  distributor_id TEXT,
  master_distributor_id TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  commission_rate DECIMAL(5,2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  FOREIGN KEY (distributor_id) REFERENCES distributors(partner_id) ON DELETE SET NULL,
  FOREIGN KEY (master_distributor_id) REFERENCES master_distributors(partner_id) ON DELETE SET NULL
);

-- ============================================================================
-- 2. POS MACHINES TABLE (Depends on retailers, distributors, master_distributors)
-- ============================================================================

CREATE TABLE IF NOT EXISTS pos_machines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  machine_id TEXT UNIQUE NOT NULL,
  serial_number TEXT UNIQUE,
  retailer_id TEXT NOT NULL,
  distributor_id TEXT,
  master_distributor_id TEXT,
  machine_type TEXT DEFAULT 'POS' CHECK (machine_type IN ('POS', 'WPOS', 'Mini-ATM')),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance', 'damaged', 'returned')),
  delivery_date DATE,
  installation_date DATE,
  location TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  FOREIGN KEY (retailer_id) REFERENCES retailers(partner_id) ON DELETE CASCADE,
  FOREIGN KEY (distributor_id) REFERENCES distributors(partner_id) ON DELETE SET NULL,
  FOREIGN KEY (master_distributor_id) REFERENCES master_distributors(partner_id) ON DELETE SET NULL
);

-- ============================================================================
-- 3. POS TERMINALS TABLE (Depends on pos_machines)
-- ============================================================================

CREATE TABLE IF NOT EXISTS pos_terminals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tid TEXT UNIQUE NOT NULL,
  machine_id TEXT,
  retailer_id TEXT NOT NULL,
  distributor_id TEXT,
  master_distributor_id TEXT,
  razorpay_terminal_id TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  FOREIGN KEY (retailer_id) REFERENCES retailers(partner_id) ON DELETE CASCADE,
  FOREIGN KEY (distributor_id) REFERENCES distributors(partner_id) ON DELETE SET NULL,
  FOREIGN KEY (master_distributor_id) REFERENCES master_distributors(partner_id) ON DELETE SET NULL
);

-- ============================================================================
-- 4. RAZORPAY TRANSACTIONS TABLE (Depends on pos_terminals)
-- ============================================================================

CREATE TABLE IF NOT EXISTS razorpay_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  razorpay_payment_id TEXT UNIQUE,
  tid TEXT,
  rrn TEXT,
  retailer_id TEXT NOT NULL,
  distributor_id TEXT,
  master_distributor_id TEXT,
  gross_amount DECIMAL(12, 2) NOT NULL,
  mdr DECIMAL(12, 2) NOT NULL DEFAULT 0,
  net_amount DECIMAL(12, 2) NOT NULL,
  payment_mode TEXT,
  auth_code TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded')),
  razorpay_status TEXT,
  wallet_credited BOOLEAN DEFAULT FALSE,
  wallet_credit_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  transaction_timestamp TIMESTAMP WITH TIME ZONE,
  metadata JSONB,
  FOREIGN KEY (retailer_id) REFERENCES retailers(partner_id) ON DELETE RESTRICT,
  FOREIGN KEY (distributor_id) REFERENCES distributors(partner_id) ON DELETE SET NULL,
  FOREIGN KEY (master_distributor_id) REFERENCES master_distributors(partner_id) ON DELETE SET NULL
);

-- ============================================================================
-- 5. WALLETS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL CHECK (user_role IN ('retailer', 'distributor', 'master_distributor')),
  wallet_type TEXT NOT NULL CHECK (wallet_type IN ('primary', 'aeps')),
  balance DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  is_frozen BOOLEAN DEFAULT FALSE,
  is_settlement_held BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, wallet_type)
);

-- ============================================================================
-- 6. WALLET LEDGER TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  retailer_id TEXT NOT NULL,
  user_role TEXT DEFAULT 'retailer',
  wallet_type TEXT DEFAULT 'primary',
  fund_category TEXT,
  service_type TEXT,
  transaction_id UUID,
  transaction_type TEXT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  credit DECIMAL(12, 2) DEFAULT 0,
  debit DECIMAL(12, 2) DEFAULT 0,
  opening_balance DECIMAL(12, 2) DEFAULT 0,
  closing_balance DECIMAL(12, 2) DEFAULT 0,
  balance_after DECIMAL(12, 2),
  description TEXT,
  reference_id TEXT,
  status TEXT DEFAULT 'completed',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- 7. BBPS TABLES
-- ============================================================================

-- BBPS Billers Cache
CREATE TABLE IF NOT EXISTS bbps_billers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  biller_id TEXT UNIQUE NOT NULL,
  biller_name TEXT NOT NULL,
  category TEXT,
  category_name TEXT,
  biller_alias TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  params TEXT[],
  amount_exactness TEXT,
  support_bill_fetch BOOLEAN DEFAULT TRUE,
  support_partial_payment BOOLEAN DEFAULT FALSE,
  support_additional_info BOOLEAN DEFAULT FALSE,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- BBPS Transactions
CREATE TABLE IF NOT EXISTS bbps_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  retailer_id TEXT NOT NULL,
  distributor_id TEXT,
  master_distributor_id TEXT,
  biller_id TEXT NOT NULL,
  biller_name TEXT,
  consumer_number TEXT NOT NULL,
  consumer_name TEXT,
  bill_amount DECIMAL(12, 2) NOT NULL,
  amount_paid DECIMAL(12, 2) NOT NULL,
  transaction_id TEXT UNIQUE,
  agent_transaction_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'initiated', 'success', 'failed', 'reversed', 'refunded')),
  payment_status TEXT,
  bill_fetch_status TEXT,
  due_date DATE,
  bill_date DATE,
  bill_number TEXT,
  additional_info JSONB,
  error_code TEXT,
  error_message TEXT,
  wallet_debited BOOLEAN DEFAULT FALSE,
  wallet_debit_id UUID,
  commission_rate DECIMAL(5, 2),
  commission_amount DECIMAL(12, 2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  FOREIGN KEY (retailer_id) REFERENCES retailers(partner_id) ON DELETE RESTRICT
);

-- ============================================================================
-- 8. COMMISSIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS commissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id UUID,
  retailer_id TEXT NOT NULL,
  distributor_id TEXT,
  master_distributor_id TEXT,
  commission_type TEXT CHECK (commission_type IN ('retailer', 'distributor', 'master_distributor')),
  commission_rate DECIMAL(5, 2),
  commission_amount DECIMAL(12, 2) NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'credited', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- 9. SETTLEMENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS settlements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL CHECK (user_role IN ('retailer', 'distributor', 'master_distributor')),
  settlement_mode TEXT NOT NULL CHECK (settlement_mode IN ('instant', 't+1')),
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  charge DECIMAL(12, 2) NOT NULL DEFAULT 0,
  net_amount DECIMAL(12, 2) NOT NULL,
  bank_account_number TEXT NOT NULL,
  bank_ifsc TEXT NOT NULL,
  bank_account_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'success', 'failed', 'reversed', 'hold')),
  payout_reference_id TEXT UNIQUE,
  failure_reason TEXT,
  ledger_entry_id UUID,
  reversal_ledger_id UUID,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE
);

-- ============================================================================
-- 10. CREATE INDEXES
-- ============================================================================

-- Retailers indexes
CREATE INDEX IF NOT EXISTS idx_retailers_distributor_id ON retailers(distributor_id);
CREATE INDEX IF NOT EXISTS idx_retailers_master_distributor_id ON retailers(master_distributor_id);
CREATE INDEX IF NOT EXISTS idx_retailers_status ON retailers(status);

-- POS Machines indexes
CREATE INDEX IF NOT EXISTS idx_pos_machines_retailer_id ON pos_machines(retailer_id);
CREATE INDEX IF NOT EXISTS idx_pos_machines_machine_id ON pos_machines(machine_id);
CREATE INDEX IF NOT EXISTS idx_pos_machines_status ON pos_machines(status);

-- POS Terminals indexes
CREATE INDEX IF NOT EXISTS idx_pos_terminals_tid ON pos_terminals(tid);
CREATE INDEX IF NOT EXISTS idx_pos_terminals_retailer_id ON pos_terminals(retailer_id);

-- Razorpay Transactions indexes
CREATE INDEX IF NOT EXISTS idx_razorpay_transactions_retailer_id ON razorpay_transactions(retailer_id);
CREATE INDEX IF NOT EXISTS idx_razorpay_transactions_status ON razorpay_transactions(status);
CREATE INDEX IF NOT EXISTS idx_razorpay_transactions_created_at ON razorpay_transactions(created_at);

-- Wallet Ledger indexes
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_retailer_id ON wallet_ledger(retailer_id);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_created_at ON wallet_ledger(created_at);

-- Wallets indexes
CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wallets_wallet_type ON wallets(wallet_type);

-- BBPS Transactions indexes
CREATE INDEX IF NOT EXISTS idx_bbps_transactions_retailer_id ON bbps_transactions(retailer_id);
CREATE INDEX IF NOT EXISTS idx_bbps_transactions_status ON bbps_transactions(status);
CREATE INDEX IF NOT EXISTS idx_bbps_transactions_created_at ON bbps_transactions(created_at);

-- Settlements indexes
CREATE INDEX IF NOT EXISTS idx_settlements_user_id ON settlements(user_id);
CREATE INDEX IF NOT EXISTS idx_settlements_status ON settlements(status);

-- ============================================================================
-- 11. CREATE HELPER FUNCTIONS
-- ============================================================================

-- Updated at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Get wallet balance function (legacy - for retailers)
CREATE OR REPLACE FUNCTION get_wallet_balance(p_retailer_id TEXT)
RETURNS DECIMAL(12, 2) AS $$
DECLARE
  v_balance DECIMAL(12, 2);
BEGIN
  -- First try wallets table
  SELECT balance INTO v_balance
  FROM wallets
  WHERE user_id = p_retailer_id AND wallet_type = 'primary';
  
  IF v_balance IS NOT NULL THEN
    RETURN v_balance;
  END IF;
  
  -- Fallback to wallet_ledger
  RETURN COALESCE(
    (SELECT COALESCE(closing_balance, balance_after)
     FROM wallet_ledger 
     WHERE retailer_id = p_retailer_id 
     ORDER BY created_at DESC 
     LIMIT 1),
    0
  );
END;
$$ LANGUAGE plpgsql;

-- Get wallet balance v2 (unified)
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

-- Credit wallet function
CREATE OR REPLACE FUNCTION credit_wallet(
  p_retailer_id TEXT,
  p_transaction_id UUID,
  p_amount DECIMAL(12, 2),
  p_description TEXT,
  p_reference_id TEXT
)
RETURNS UUID AS $$
DECLARE
  v_balance_before DECIMAL(12, 2);
  v_balance_after DECIMAL(12, 2);
  v_ledger_id UUID;
BEGIN
  -- Check if already credited (idempotency)
  SELECT id INTO v_ledger_id
  FROM wallet_ledger
  WHERE transaction_id = p_transaction_id
    AND transaction_type = 'POS_CREDIT'
    AND retailer_id = p_retailer_id
  LIMIT 1;

  IF v_ledger_id IS NOT NULL THEN
    RETURN v_ledger_id;
  END IF;

  -- Get current balance
  v_balance_before := get_wallet_balance(p_retailer_id);
  v_balance_after := v_balance_before + p_amount;

  -- Insert ledger entry
  INSERT INTO wallet_ledger (
    retailer_id,
    transaction_id,
    transaction_type,
    amount,
    credit,
    opening_balance,
    closing_balance,
    balance_after,
    description,
    reference_id
  ) VALUES (
    p_retailer_id,
    p_transaction_id,
    'POS_CREDIT',
    p_amount,
    p_amount,
    v_balance_before,
    v_balance_after,
    v_balance_after,
    p_description,
    p_reference_id
  ) RETURNING id INTO v_ledger_id;

  -- Update or insert wallet balance
  INSERT INTO wallets (user_id, user_role, wallet_type, balance)
  VALUES (p_retailer_id, 'retailer', 'primary', v_balance_after)
  ON CONFLICT (user_id, wallet_type) 
  DO UPDATE SET balance = v_balance_after, updated_at = NOW();

  RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql;

-- Debit wallet for BBPS function
CREATE OR REPLACE FUNCTION debit_wallet_bbps(
  p_retailer_id TEXT,
  p_transaction_id UUID,
  p_amount DECIMAL(12, 2),
  p_description TEXT,
  p_reference_id TEXT
)
RETURNS UUID AS $$
DECLARE
  v_balance_before DECIMAL(12, 2);
  v_balance_after DECIMAL(12, 2);
  v_ledger_id UUID;
BEGIN
  -- Check if already debited (idempotency)
  SELECT id INTO v_ledger_id
  FROM wallet_ledger
  WHERE transaction_id = p_transaction_id
    AND transaction_type = 'BBPS_DEBIT'
    AND retailer_id = p_retailer_id
  LIMIT 1;

  IF v_ledger_id IS NOT NULL THEN
    RETURN v_ledger_id;
  END IF;

  -- Get current balance
  v_balance_before := get_wallet_balance(p_retailer_id);
  
  -- Check if sufficient balance
  IF v_balance_before < p_amount THEN
    RAISE EXCEPTION 'Insufficient wallet balance. Required: %, Available: %', p_amount, v_balance_before;
  END IF;

  v_balance_after := v_balance_before - p_amount;

  -- Insert ledger entry
  INSERT INTO wallet_ledger (
    retailer_id,
    transaction_id,
    transaction_type,
    amount,
    debit,
    opening_balance,
    closing_balance,
    balance_after,
    description,
    reference_id,
    wallet_type,
    fund_category,
    service_type
  ) VALUES (
    p_retailer_id,
    p_transaction_id,
    'BBPS_DEBIT',
    -p_amount,
    p_amount,
    v_balance_before,
    v_balance_after,
    v_balance_after,
    p_description,
    p_reference_id,
    'primary',
    'bbps',
    'bbps'
  ) RETURNING id INTO v_ledger_id;

  -- Update wallet balance
  UPDATE wallets
  SET balance = v_balance_after, updated_at = NOW()
  WHERE user_id = p_retailer_id AND wallet_type = 'primary';

  -- If wallet doesn't exist, create it
  IF NOT FOUND THEN
    INSERT INTO wallets (user_id, user_role, wallet_type, balance)
    VALUES (p_retailer_id, 'retailer', 'primary', v_balance_after);
  END IF;

  -- Update BBPS transaction
  UPDATE bbps_transactions
  SET wallet_debited = TRUE,
      wallet_debit_id = v_ledger_id
  WHERE id = p_transaction_id;

  RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql;

-- Refund wallet for BBPS function
CREATE OR REPLACE FUNCTION refund_wallet_bbps(
  p_retailer_id TEXT,
  p_transaction_id UUID,
  p_amount DECIMAL(12, 2),
  p_description TEXT,
  p_reference_id TEXT
)
RETURNS UUID AS $$
DECLARE
  v_balance_before DECIMAL(12, 2);
  v_balance_after DECIMAL(12, 2);
  v_ledger_id UUID;
BEGIN
  -- Get current balance
  v_balance_before := get_wallet_balance(p_retailer_id);
  v_balance_after := v_balance_before + p_amount;

  -- Insert ledger entry
  INSERT INTO wallet_ledger (
    retailer_id,
    transaction_id,
    transaction_type,
    amount,
    credit,
    opening_balance,
    closing_balance,
    balance_after,
    description,
    reference_id,
    wallet_type,
    fund_category,
    service_type
  ) VALUES (
    p_retailer_id,
    p_transaction_id,
    'BBPS_REFUND',
    p_amount,
    p_amount,
    v_balance_before,
    v_balance_after,
    v_balance_after,
    p_description,
    p_reference_id,
    'primary',
    'bbps',
    'bbps'
  ) RETURNING id INTO v_ledger_id;

  -- Update wallet balance
  UPDATE wallets
  SET balance = v_balance_after, updated_at = NOW()
  WHERE user_id = p_retailer_id AND wallet_type = 'primary';

  -- If wallet doesn't exist, create it
  IF NOT FOUND THEN
    INSERT INTO wallets (user_id, user_role, wallet_type, balance)
    VALUES (p_retailer_id, 'retailer', 'primary', v_balance_after);
  END IF;

  RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql;

-- Calculate transaction charge function (placeholder)
CREATE OR REPLACE FUNCTION calculate_transaction_charge(
  p_amount DECIMAL(12, 2),
  p_transaction_type TEXT
)
RETURNS DECIMAL(12, 2) AS $$
BEGIN
  -- Default charge logic - customize as needed
  IF p_transaction_type = 'bbps' THEN
    IF p_amount <= 1000 THEN
      RETURN 10;
    ELSIF p_amount <= 5000 THEN
      RETURN 15;
    ELSIF p_amount <= 10000 THEN
      RETURN 20;
    ELSE
      RETURN 25;
    END IF;
  END IF;
  
  RETURN 20; -- Default charge
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 12. CREATE TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS update_admin_users_updated_at ON admin_users;
CREATE TRIGGER update_admin_users_updated_at BEFORE UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_master_distributors_updated_at ON master_distributors;
CREATE TRIGGER update_master_distributors_updated_at BEFORE UPDATE ON master_distributors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_distributors_updated_at ON distributors;
CREATE TRIGGER update_distributors_updated_at BEFORE UPDATE ON distributors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_retailers_updated_at ON retailers;
CREATE TRIGGER update_retailers_updated_at BEFORE UPDATE ON retailers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_pos_machines_updated_at ON pos_machines;
CREATE TRIGGER update_pos_machines_updated_at BEFORE UPDATE ON pos_machines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_pos_terminals_updated_at ON pos_terminals;
CREATE TRIGGER update_pos_terminals_updated_at BEFORE UPDATE ON pos_terminals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_wallets_updated_at ON wallets;
CREATE TRIGGER update_wallets_updated_at BEFORE UPDATE ON wallets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_bbps_transactions_updated_at ON bbps_transactions;
CREATE TRIGGER update_bbps_transactions_updated_at BEFORE UPDATE ON bbps_transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_settlements_updated_at ON settlements;
CREATE TRIGGER update_settlements_updated_at BEFORE UPDATE ON settlements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 13. ENABLE ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_distributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE distributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE retailers ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_terminals ENABLE ROW LEVEL SECURITY;
ALTER TABLE razorpay_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE bbps_billers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bbps_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 14. CREATE RLS POLICIES (Permissive for now - tighten for production)
-- ============================================================================

-- Drop all existing policies first
DO $$ 
DECLARE
  r RECORD;
BEGIN
  FOR r IN (SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public') LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Create permissive policies for all tables
CREATE POLICY "Allow all" ON admin_users FOR ALL USING (true);
CREATE POLICY "Allow all" ON master_distributors FOR ALL USING (true);
CREATE POLICY "Allow all" ON distributors FOR ALL USING (true);
CREATE POLICY "Allow all" ON retailers FOR ALL USING (true);
CREATE POLICY "Allow all" ON pos_machines FOR ALL USING (true);
CREATE POLICY "Allow all" ON pos_terminals FOR ALL USING (true);
CREATE POLICY "Allow all" ON razorpay_transactions FOR ALL USING (true);
CREATE POLICY "Allow all" ON wallets FOR ALL USING (true);
CREATE POLICY "Allow all" ON wallet_ledger FOR ALL USING (true);
CREATE POLICY "Allow all" ON bbps_billers FOR ALL USING (true);
CREATE POLICY "Allow all" ON bbps_transactions FOR ALL USING (true);
CREATE POLICY "Allow all" ON commissions FOR ALL USING (true);
CREATE POLICY "Allow all" ON settlements FOR ALL USING (true);

-- ============================================================================
-- SETUP COMPLETE!
-- ============================================================================

SELECT 'Database setup complete!' as status;

