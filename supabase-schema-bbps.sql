-- BBPS (Bharat Bill Payment System) Schema Extension
-- Run this SQL in your Supabase SQL Editor after the base schema and razorpay schema

-- BBPS Billers Table (cache of available billers)
CREATE TABLE IF NOT EXISTS bbps_billers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  biller_id TEXT UNIQUE NOT NULL,
  biller_name TEXT NOT NULL,
  category TEXT,
  category_name TEXT,
  biller_alias TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  params TEXT[], -- Array of required parameters (e.g., ['consumer_number', 'mobile_number'])
  amount_exactness TEXT, -- 'EXACT', 'INEXACT', 'ANY'
  support_bill_fetch BOOLEAN DEFAULT TRUE,
  support_partial_payment BOOLEAN DEFAULT FALSE,
  support_additional_info BOOLEAN DEFAULT FALSE,
  payment_mode TEXT DEFAULT 'Cash', -- Payment mode (e.g., 'Cash', 'Wallet', 'UPI', etc.)
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- BBPS Transactions Table
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
  transaction_id TEXT UNIQUE, -- BBPS transaction ID
  agent_transaction_id TEXT UNIQUE, -- Our internal transaction ID
  status TEXT NOT NULL CHECK (status IN ('pending', 'initiated', 'success', 'failed', 'reversed', 'refunded')),
  payment_status TEXT, -- BBPS payment status
  bill_fetch_status TEXT, -- Bill fetch status
  payment_mode TEXT DEFAULT 'Cash', -- Payment mode used (e.g., 'Cash', 'Wallet', 'UPI', etc.)
  due_date DATE,
  bill_date DATE,
  bill_number TEXT,
  additional_info JSONB, -- Additional bill details
  error_code TEXT,
  error_message TEXT,
  wallet_debited BOOLEAN DEFAULT FALSE,
  wallet_debit_id UUID,
  commission_rate DECIMAL(5, 2),
  commission_amount DECIMAL(12, 2),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  FOREIGN KEY (retailer_id) REFERENCES retailers(partner_id) ON DELETE RESTRICT,
  FOREIGN KEY (distributor_id) REFERENCES distributors(partner_id) ON DELETE SET NULL,
  FOREIGN KEY (master_distributor_id) REFERENCES master_distributors(partner_id) ON DELETE SET NULL
);

-- Update wallet_ledger transaction_type to include BBPS types
-- First, drop the existing constraint if it exists
ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_transaction_type_check;

-- Add new constraint with BBPS transaction types
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_transaction_type_check 
  CHECK (transaction_type IN (
    'POS_CREDIT', 
    'PAYOUT', 
    'REFUND', 
    'ADJUSTMENT', 
    'COMMISSION',
    'BBPS_DEBIT',
    'BBPS_REFUND'
  ));

-- Create indexes for BBPS tables
CREATE INDEX IF NOT EXISTS idx_bbps_billers_biller_id ON bbps_billers(biller_id);
CREATE INDEX IF NOT EXISTS idx_bbps_billers_category ON bbps_billers(category);
CREATE INDEX IF NOT EXISTS idx_bbps_billers_is_active ON bbps_billers(is_active);

CREATE INDEX IF NOT EXISTS idx_bbps_transactions_retailer_id ON bbps_transactions(retailer_id);
CREATE INDEX IF NOT EXISTS idx_bbps_transactions_distributor_id ON bbps_transactions(distributor_id);
CREATE INDEX IF NOT EXISTS idx_bbps_transactions_master_distributor_id ON bbps_transactions(master_distributor_id);
CREATE INDEX IF NOT EXISTS idx_bbps_transactions_biller_id ON bbps_transactions(biller_id);
CREATE INDEX IF NOT EXISTS idx_bbps_transactions_status ON bbps_transactions(status);
CREATE INDEX IF NOT EXISTS idx_bbps_transactions_transaction_id ON bbps_transactions(transaction_id);
CREATE INDEX IF NOT EXISTS idx_bbps_transactions_agent_transaction_id ON bbps_transactions(agent_transaction_id);
CREATE INDEX IF NOT EXISTS idx_bbps_transactions_created_at ON bbps_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_bbps_transactions_wallet_debited ON bbps_transactions(wallet_debited);

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS update_bbps_billers_updated_at ON bbps_billers;
CREATE TRIGGER update_bbps_billers_updated_at BEFORE UPDATE ON bbps_billers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_bbps_transactions_updated_at ON bbps_transactions;
CREATE TRIGGER update_bbps_transactions_updated_at BEFORE UPDATE ON bbps_transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to debit wallet for BBPS transaction (idempotent)
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
    balance_after,
    description,
    reference_id
  ) VALUES (
    p_retailer_id,
    p_transaction_id,
    'BBPS_DEBIT',
    -p_amount, -- Negative amount for debit
    v_balance_after,
    p_description,
    p_reference_id
  ) RETURNING id INTO v_ledger_id;

  -- Update transaction wallet_debited flag
  UPDATE bbps_transactions
  SET wallet_debited = TRUE,
      wallet_debit_id = v_ledger_id
  WHERE id = p_transaction_id;

  RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql;

-- Function to refund wallet for BBPS transaction
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
    balance_after,
    description,
    reference_id
  ) VALUES (
    p_retailer_id,
    p_transaction_id,
    'BBPS_REFUND',
    p_amount,
    v_balance_after,
    p_description,
    p_reference_id
  ) RETURNING id INTO v_ledger_id;

  RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS
ALTER TABLE bbps_billers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bbps_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Anyone can read bbps_billers" ON bbps_billers;
DROP POLICY IF EXISTS "Admins can manage bbps_billers" ON bbps_billers;

CREATE POLICY "Anyone can read bbps_billers" ON bbps_billers
  FOR SELECT USING (true);

CREATE POLICY "Admins can manage bbps_billers" ON bbps_billers
  FOR ALL USING (true);

DROP POLICY IF EXISTS "Anyone can read bbps_transactions" ON bbps_transactions;
DROP POLICY IF EXISTS "Admins can manage bbps_transactions" ON bbps_transactions;

CREATE POLICY "Anyone can read bbps_transactions" ON bbps_transactions
  FOR SELECT USING (true);

CREATE POLICY "Admins can manage bbps_transactions" ON bbps_transactions
  FOR ALL USING (true);

