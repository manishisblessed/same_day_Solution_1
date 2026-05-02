-- ============================================================================
-- AEPS (AADHAAR ENABLED PAYMENT SYSTEM) SCHEMA - SAFE MIGRATION
-- ============================================================================
-- This migration safely creates or updates AEPS tables
-- ============================================================================

-- Drop existing tables if they exist (safe to run multiple times)
DROP TABLE IF EXISTS aeps_transactions CASCADE;
DROP TABLE IF EXISTS aeps_merchants CASCADE;
DROP TABLE IF EXISTS aeps_banks CASCADE;

-- ============================================================================
-- 1. AEPS TRANSACTIONS TABLE
-- ============================================================================
CREATE TABLE aeps_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL CHECK (user_role IN ('retailer', 'distributor', 'master_distributor')),
  merchant_id TEXT,
  
  -- Transaction details
  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
    'balance_inquiry', 'cash_withdrawal', 'cash_deposit', 
    'mini_statement', 'aadhaar_to_aadhaar'
  )),
  is_financial BOOLEAN NOT NULL DEFAULT FALSE,
  amount DECIMAL(12, 2),
  
  -- Customer details (masked for security)
  aadhaar_number_masked TEXT,
  bank_iin TEXT,
  bank_name TEXT,
  account_number_masked TEXT,
  
  -- Transaction identifiers
  rrn TEXT,
  stan TEXT,
  utr TEXT,
  order_id TEXT,
  txn_id TEXT,
  
  -- Status and result
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'processing', 'success', 'failed', 'reversed', 'under_reconciliation'
  )),
  error_message TEXT,
  balance_after DECIMAL(12, 2),
  mini_statement JSONB,
  
  -- Wallet tracking
  wallet_debited BOOLEAN DEFAULT FALSE,
  wallet_debit_id TEXT,
  wallet_credited BOOLEAN DEFAULT FALSE,
  wallet_credit_id TEXT,
  
  -- Idempotency
  idempotency_key TEXT UNIQUE,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_aeps_transactions_user_id ON aeps_transactions(user_id);
CREATE INDEX idx_aeps_transactions_status ON aeps_transactions(status);
CREATE INDEX idx_aeps_transactions_type ON aeps_transactions(transaction_type);
CREATE INDEX idx_aeps_transactions_created_at ON aeps_transactions(created_at DESC);
CREATE INDEX idx_aeps_transactions_order_id ON aeps_transactions(order_id);
CREATE INDEX idx_aeps_transactions_merchant_id ON aeps_transactions(merchant_id);

-- ============================================================================
-- 2. AEPS MERCHANTS TABLE
-- ============================================================================
CREATE TABLE aeps_merchants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL UNIQUE,
  merchant_id TEXT NOT NULL,
  
  -- Personal details
  name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  email TEXT,
  pan TEXT,
  aadhaar_masked TEXT,
  date_of_birth DATE,
  gender TEXT CHECK (gender IN ('M', 'F')),
  
  -- KYC status
  kyc_status TEXT NOT NULL DEFAULT 'pending' CHECK (kyc_status IN (
    'pending', 'validated', 'rejected', 'expired'
  )),
  bank_pipe TEXT,
  route TEXT,
  kyc_provider_response TEXT,
  
  -- Address
  address_full TEXT,
  address_city TEXT,
  address_pincode TEXT,
  latitude DECIMAL(10, 6),
  longitude DECIMAL(10, 6),
  
  -- Bank details (masked)
  bank_account_masked TEXT,
  bank_ifsc TEXT,
  bank_name TEXT,
  
  -- Device info (for real transactions)
  device_serial TEXT,
  device_type TEXT,
  rd_service_version TEXT,
  
  -- API tracking
  api_error TEXT,
  last_login_at TIMESTAMP WITH TIME ZONE,
  login_wadh TEXT,
  device_fingerprint TEXT,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_aeps_merchants_user_id ON aeps_merchants(user_id);
CREATE INDEX idx_aeps_merchants_merchant_id ON aeps_merchants(merchant_id);
CREATE INDEX idx_aeps_merchants_mobile ON aeps_merchants(mobile);
CREATE INDEX idx_aeps_merchants_kyc_status ON aeps_merchants(kyc_status);

-- ============================================================================
-- 3. AEPS BANK LIST TABLE
-- ============================================================================
CREATE TABLE aeps_banks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  iin TEXT NOT NULL UNIQUE,
  bank_name TEXT NOT NULL,
  short_name TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  supports_withdrawal BOOLEAN DEFAULT TRUE,
  supports_deposit BOOLEAN DEFAULT TRUE,
  supports_balance BOOLEAN DEFAULT TRUE,
  supports_statement BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert common banks
INSERT INTO aeps_banks (iin, bank_name, short_name) VALUES
  ('607094', 'HDFC Bank', 'HDFC'),
  ('607152', 'State Bank of India', 'SBI'),
  ('505290', 'Axis Bank', 'AXIS'),
  ('607095', 'ICICI Bank', 'ICICI'),
  ('607161', 'Punjab National Bank', 'PNB'),
  ('607389', 'Bank of Baroda', 'BOB'),
  ('607027', 'Canara Bank', 'CANARA'),
  ('607105', 'Union Bank of India', 'UNION'),
  ('607039', 'Bank of India', 'BOI'),
  ('607026', 'Central Bank of India', 'CBI');

-- ============================================================================
-- 4. ENABLE ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE aeps_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE aeps_merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE aeps_banks ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view own AEPS transactions" ON aeps_transactions;
DROP POLICY IF EXISTS "Service can insert AEPS transactions" ON aeps_transactions;
DROP POLICY IF EXISTS "Service can update AEPS transactions" ON aeps_transactions;
DROP POLICY IF EXISTS "Users can view own merchant" ON aeps_merchants;
DROP POLICY IF EXISTS "Service can manage merchants" ON aeps_merchants;
DROP POLICY IF EXISTS "Anyone can view banks" ON aeps_banks;

-- Policies for aeps_transactions
CREATE POLICY "Users can view own AEPS transactions"
  ON aeps_transactions FOR SELECT
  USING (auth.uid()::text = user_id OR auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service can insert AEPS transactions"
  ON aeps_transactions FOR INSERT
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service can update AEPS transactions"
  ON aeps_transactions FOR UPDATE
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Policies for aeps_merchants
CREATE POLICY "Users can view own merchant"
  ON aeps_merchants FOR SELECT
  USING (auth.uid()::text = user_id OR auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service can manage merchants"
  ON aeps_merchants FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- Policies for aeps_banks (public read)
CREATE POLICY "Anyone can view banks"
  ON aeps_banks FOR SELECT
  USING (true);

-- ============================================================================
-- 5. TRIGGERS FOR UPDATED_AT
-- ============================================================================
CREATE OR REPLACE FUNCTION update_aeps_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS aeps_transactions_updated_at ON aeps_transactions;
CREATE TRIGGER aeps_transactions_updated_at
  BEFORE UPDATE ON aeps_transactions
  FOR EACH ROW EXECUTE FUNCTION update_aeps_updated_at();

DROP TRIGGER IF EXISTS aeps_merchants_updated_at ON aeps_merchants;
CREATE TRIGGER aeps_merchants_updated_at
  BEFORE UPDATE ON aeps_merchants
  FOR EACH ROW EXECUTE FUNCTION update_aeps_updated_at();

-- ============================================================================
-- 6. HELPER FUNCTIONS
-- ============================================================================

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS get_aeps_stats(TEXT);

-- Get AEPS transaction stats for a user
CREATE OR REPLACE FUNCTION get_aeps_stats(p_user_id TEXT)
RETURNS TABLE (
  total_transactions BIGINT,
  successful_transactions BIGINT,
  failed_transactions BIGINT,
  total_volume DECIMAL,
  today_transactions BIGINT,
  today_volume DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT as total_transactions,
    COUNT(*) FILTER (WHERE status = 'success')::BIGINT as successful_transactions,
    COUNT(*) FILTER (WHERE status = 'failed')::BIGINT as failed_transactions,
    COALESCE(SUM(amount) FILTER (WHERE status = 'success'), 0) as total_volume,
    COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::BIGINT as today_transactions,
    COALESCE(SUM(amount) FILTER (WHERE status = 'success' AND created_at >= CURRENT_DATE), 0) as today_volume
  FROM aeps_transactions
  WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- DONE - AEPS tables created successfully!
-- ============================================================================
