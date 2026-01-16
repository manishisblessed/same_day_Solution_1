-- Razorpay POS Transaction System Schema Extension
-- Run this SQL in your Supabase SQL Editor after the base schema

-- POS Terminals Table (TID mapping)
-- Maps Razorpay TID to our internal POS machine and retailer
CREATE TABLE IF NOT EXISTS pos_terminals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tid TEXT UNIQUE NOT NULL,
  machine_id TEXT NOT NULL,
  retailer_id TEXT NOT NULL,
  distributor_id TEXT,
  master_distributor_id TEXT,
  razorpay_terminal_id TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  FOREIGN KEY (machine_id) REFERENCES pos_machines(machine_id) ON DELETE CASCADE,
  FOREIGN KEY (retailer_id) REFERENCES retailers(partner_id) ON DELETE CASCADE,
  FOREIGN KEY (distributor_id) REFERENCES distributors(partner_id) ON DELETE SET NULL,
  FOREIGN KEY (master_distributor_id) REFERENCES master_distributors(partner_id) ON DELETE SET NULL
);

-- Razorpay Transactions Table
CREATE TABLE IF NOT EXISTS razorpay_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  razorpay_payment_id TEXT UNIQUE,
  tid TEXT NOT NULL,
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
  FOREIGN KEY (tid) REFERENCES pos_terminals(tid) ON DELETE RESTRICT,
  FOREIGN KEY (retailer_id) REFERENCES retailers(partner_id) ON DELETE RESTRICT,
  FOREIGN KEY (distributor_id) REFERENCES distributors(partner_id) ON DELETE SET NULL,
  FOREIGN KEY (master_distributor_id) REFERENCES master_distributors(partner_id) ON DELETE SET NULL
);

-- Wallet Ledger Table
-- Single source of truth for wallet balance
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  retailer_id TEXT NOT NULL,
  transaction_id UUID,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('POS_CREDIT', 'PAYOUT', 'REFUND', 'ADJUSTMENT', 'COMMISSION')),
  amount DECIMAL(12, 2) NOT NULL,
  balance_after DECIMAL(12, 2) NOT NULL,
  description TEXT,
  reference_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  FOREIGN KEY (retailer_id) REFERENCES retailers(partner_id) ON DELETE CASCADE,
  FOREIGN KEY (transaction_id) REFERENCES razorpay_transactions(id) ON DELETE SET NULL
);

-- Commissions Table (for future use)
CREATE TABLE IF NOT EXISTS commissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id UUID NOT NULL,
  retailer_id TEXT NOT NULL,
  distributor_id TEXT,
  master_distributor_id TEXT,
  commission_type TEXT CHECK (commission_type IN ('retailer', 'distributor', 'master_distributor')),
  commission_rate DECIMAL(5, 2),
  commission_amount DECIMAL(12, 2) NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'credited', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  FOREIGN KEY (transaction_id) REFERENCES razorpay_transactions(id) ON DELETE CASCADE,
  FOREIGN KEY (retailer_id) REFERENCES retailers(partner_id) ON DELETE CASCADE,
  FOREIGN KEY (distributor_id) REFERENCES distributors(partner_id) ON DELETE SET NULL,
  FOREIGN KEY (master_distributor_id) REFERENCES master_distributors(partner_id) ON DELETE SET NULL
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_pos_terminals_tid ON pos_terminals(tid);
CREATE INDEX IF NOT EXISTS idx_pos_terminals_retailer_id ON pos_terminals(retailer_id);
CREATE INDEX IF NOT EXISTS idx_pos_terminals_machine_id ON pos_terminals(machine_id);

CREATE INDEX IF NOT EXISTS idx_razorpay_transactions_tid ON razorpay_transactions(tid);
CREATE INDEX IF NOT EXISTS idx_razorpay_transactions_retailer_id ON razorpay_transactions(retailer_id);
CREATE INDEX IF NOT EXISTS idx_razorpay_transactions_distributor_id ON razorpay_transactions(distributor_id);
CREATE INDEX IF NOT EXISTS idx_razorpay_transactions_master_distributor_id ON razorpay_transactions(master_distributor_id);
CREATE INDEX IF NOT EXISTS idx_razorpay_transactions_status ON razorpay_transactions(status);
CREATE INDEX IF NOT EXISTS idx_razorpay_transactions_created_at ON razorpay_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_razorpay_transactions_rrn ON razorpay_transactions(rrn);
CREATE INDEX IF NOT EXISTS idx_razorpay_transactions_razorpay_payment_id ON razorpay_transactions(razorpay_payment_id);
CREATE INDEX IF NOT EXISTS idx_razorpay_transactions_wallet_credited ON razorpay_transactions(wallet_credited);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_retailer_id ON wallet_ledger(retailer_id);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_transaction_id ON wallet_ledger(transaction_id);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_created_at ON wallet_ledger(created_at);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_transaction_type ON wallet_ledger(transaction_type);

CREATE INDEX IF NOT EXISTS idx_commissions_transaction_id ON commissions(transaction_id);
CREATE INDEX IF NOT EXISTS idx_commissions_retailer_id ON commissions(retailer_id);

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS update_pos_terminals_updated_at ON pos_terminals;
CREATE TRIGGER update_pos_terminals_updated_at BEFORE UPDATE ON pos_terminals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_razorpay_transactions_updated_at ON razorpay_transactions;
CREATE TRIGGER update_razorpay_transactions_updated_at BEFORE UPDATE ON razorpay_transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to get wallet balance (derived from ledger)
CREATE OR REPLACE FUNCTION get_wallet_balance(p_retailer_id TEXT)
RETURNS DECIMAL(12, 2) AS $$
BEGIN
  RETURN COALESCE(
    (SELECT balance_after 
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
    balance_after,
    description,
    reference_id
  ) VALUES (
    p_retailer_id,
    p_transaction_id,
    'POS_CREDIT',
    p_amount,
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

-- Enable RLS
ALTER TABLE pos_terminals ENABLE ROW LEVEL SECURITY;
ALTER TABLE razorpay_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;

-- RLS Policies (basic - adjust based on your needs)
-- Note: These are permissive for now. Tighten based on your security requirements.

-- POS Terminals Policies
DROP POLICY IF EXISTS "Anyone can read pos_terminals" ON pos_terminals;
DROP POLICY IF EXISTS "Admins can manage pos_terminals" ON pos_terminals;

CREATE POLICY "Anyone can read pos_terminals" ON pos_terminals
  FOR SELECT USING (true);

CREATE POLICY "Admins can manage pos_terminals" ON pos_terminals
  FOR ALL USING (true);

-- Razorpay Transactions Policies
DROP POLICY IF EXISTS "Anyone can read razorpay_transactions" ON razorpay_transactions;
DROP POLICY IF EXISTS "Admins can manage razorpay_transactions" ON razorpay_transactions;

CREATE POLICY "Anyone can read razorpay_transactions" ON razorpay_transactions
  FOR SELECT USING (true);

CREATE POLICY "Admins can manage razorpay_transactions" ON razorpay_transactions
  FOR ALL USING (true);

-- Wallet Ledger Policies
DROP POLICY IF EXISTS "Anyone can read wallet_ledger" ON wallet_ledger;
DROP POLICY IF EXISTS "Admins can manage wallet_ledger" ON wallet_ledger;

CREATE POLICY "Anyone can read wallet_ledger" ON wallet_ledger
  FOR SELECT USING (true);

CREATE POLICY "Admins can manage wallet_ledger" ON wallet_ledger
  FOR ALL USING (true);

-- Commissions Policies
DROP POLICY IF EXISTS "Anyone can read commissions" ON commissions;
DROP POLICY IF EXISTS "Admins can manage commissions" ON commissions;

CREATE POLICY "Anyone can read commissions" ON commissions
  FOR SELECT USING (true);

CREATE POLICY "Admins can manage commissions" ON commissions
  FOR ALL USING (true);















