-- Razorpay POS Transaction System Schema Extension
-- Run this SQL in your Supabase SQL Editor after the base schema (supabase-schema.sql)
-- OR use the unified setup script: scripts/setup-all-tables.sql

-- ============================================================================
-- IMPORTANT: Make sure you've run supabase-schema.sql FIRST!
-- It creates: retailers, distributors, master_distributors, pos_machines tables
-- ============================================================================

-- POS Terminals Table (TID mapping)
-- Maps Razorpay TID to our internal POS machine and retailer
CREATE TABLE IF NOT EXISTS pos_terminals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tid TEXT UNIQUE NOT NULL,
  machine_id TEXT,  -- Optional reference to pos_machines
  retailer_id TEXT NOT NULL,
  distributor_id TEXT,
  master_distributor_id TEXT,
  razorpay_terminal_id TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  -- Note: Foreign keys removed for flexibility. Add them after base tables exist if needed.
);

-- Razorpay Transactions Table
CREATE TABLE IF NOT EXISTS razorpay_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  razorpay_payment_id TEXT UNIQUE,
  tid TEXT,  -- Made optional (can be NULL)
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
  metadata JSONB
  -- Note: Foreign keys removed for flexibility. The application handles data integrity.
);

-- Wallet Ledger Table
-- Single source of truth for wallet balance
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

-- Commissions Table (for future use)
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
-- CREATE INDEXES FOR PERFORMANCE
-- ============================================================================

-- POS Terminals indexes
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_pos_terminals_tid ON pos_terminals(tid);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_pos_terminals_retailer_id ON pos_terminals(retailer_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Razorpay Transactions indexes
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_razorpay_transactions_retailer_id ON razorpay_transactions(retailer_id);
  CREATE INDEX IF NOT EXISTS idx_razorpay_transactions_status ON razorpay_transactions(status);
  CREATE INDEX IF NOT EXISTS idx_razorpay_transactions_created_at ON razorpay_transactions(created_at);
  CREATE INDEX IF NOT EXISTS idx_razorpay_transactions_rrn ON razorpay_transactions(rrn);
  CREATE INDEX IF NOT EXISTS idx_razorpay_transactions_razorpay_payment_id ON razorpay_transactions(razorpay_payment_id);
  CREATE INDEX IF NOT EXISTS idx_razorpay_transactions_wallet_credited ON razorpay_transactions(wallet_credited);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Wallet Ledger indexes
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_wallet_ledger_retailer_id ON wallet_ledger(retailer_id);
  CREATE INDEX IF NOT EXISTS idx_wallet_ledger_transaction_id ON wallet_ledger(transaction_id);
  CREATE INDEX IF NOT EXISTS idx_wallet_ledger_created_at ON wallet_ledger(created_at);
  CREATE INDEX IF NOT EXISTS idx_wallet_ledger_transaction_type ON wallet_ledger(transaction_type);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Commissions indexes
DO $$ BEGIN
  CREATE INDEX IF NOT EXISTS idx_commissions_transaction_id ON commissions(transaction_id);
  CREATE INDEX IF NOT EXISTS idx_commissions_retailer_id ON commissions(retailer_id);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ============================================================================
-- CREATE TRIGGERS FOR UPDATED_AT
-- ============================================================================

-- First ensure the update_updated_at_column function exists
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers (safe - will not error if table doesn't exist)
DO $$ BEGIN
  DROP TRIGGER IF EXISTS update_pos_terminals_updated_at ON pos_terminals;
  CREATE TRIGGER update_pos_terminals_updated_at BEFORE UPDATE ON pos_terminals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP TRIGGER IF EXISTS update_razorpay_transactions_updated_at ON razorpay_transactions;
  CREATE TRIGGER update_razorpay_transactions_updated_at BEFORE UPDATE ON razorpay_transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ============================================================================
-- WALLET HELPER FUNCTIONS
-- ============================================================================

-- Function to get wallet balance (derived from ledger)
CREATE OR REPLACE FUNCTION get_wallet_balance(p_retailer_id TEXT)
RETURNS DECIMAL(12, 2) AS $$
BEGIN
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

-- Function to credit wallet (idempotent)
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

  -- Update transaction wallet_credited flag
  UPDATE razorpay_transactions
  SET wallet_credited = TRUE,
      wallet_credit_id = v_ledger_id
  WHERE id = p_transaction_id;

  RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql;

-- Function to debit wallet for BBPS (idempotent)
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

  RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql;

-- Function to refund wallet for BBPS
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

  RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql;

-- Calculate transaction charge function
CREATE OR REPLACE FUNCTION calculate_transaction_charge(
  p_amount DECIMAL(12, 2),
  p_transaction_type TEXT
)
RETURNS DECIMAL(12, 2) AS $$
BEGIN
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
  RETURN 20;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ENABLE ROW LEVEL SECURITY AND CREATE POLICIES
-- ============================================================================

-- Enable RLS (safe - ignores if table doesn't exist)
DO $$ BEGIN ALTER TABLE pos_terminals ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE razorpay_transactions ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE wallet_ledger ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE commissions ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- Create permissive RLS policies (safe)
DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow all" ON pos_terminals;
  CREATE POLICY "Allow all" ON pos_terminals FOR ALL USING (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow all" ON razorpay_transactions;
  CREATE POLICY "Allow all" ON razorpay_transactions FOR ALL USING (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow all" ON wallet_ledger;
  CREATE POLICY "Allow all" ON wallet_ledger FOR ALL USING (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow all" ON commissions;
  CREATE POLICY "Allow all" ON commissions FOR ALL USING (true);
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- ============================================================================
-- SCHEMA SETUP COMPLETE
-- ============================================================================

SELECT 'Razorpay schema setup complete!' as status;
























