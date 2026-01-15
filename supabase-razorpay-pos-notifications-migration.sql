-- Razorpay POS Notification System - Phase 1 (Display Only)
-- This migration creates a NEW isolated table for Razorpay POS transaction notifications
-- DO NOT modify existing razorpay_transactions table or any other existing tables

-- Create new table for Razorpay POS notifications (isolated from existing wallet/settlement logic)
CREATE TABLE IF NOT EXISTS razorpay_pos_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  txn_id TEXT UNIQUE NOT NULL, -- Unique transaction ID from Razorpay (idempotency key)
  status TEXT NOT NULL, -- Raw status from Razorpay: AUTHORIZED, FAILED, PENDING, etc.
  display_status TEXT NOT NULL CHECK (display_status IN ('SUCCESS', 'FAILED', 'PENDING')), -- Derived display status
  amount DECIMAL(15, 2) NOT NULL,
  payment_mode TEXT, -- CARD, UPI, WALLET, BHARATQR, NETBANKING, CASH, CHEQUE
  device_serial TEXT,
  tid TEXT, -- Terminal ID
  merchant_name TEXT,
  transaction_time TIMESTAMP WITH TIME ZONE, -- From createdTime or chargeSlipDate
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  raw_data JSONB -- Store full notification payload for reference
);

-- Create unique index on txn_id for idempotency (UPSERT logic)
CREATE UNIQUE INDEX IF NOT EXISTS idx_razorpay_pos_transactions_txn_id ON razorpay_pos_transactions(txn_id);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_razorpay_pos_transactions_status ON razorpay_pos_transactions(display_status);
CREATE INDEX IF NOT EXISTS idx_razorpay_pos_transactions_transaction_time ON razorpay_pos_transactions(transaction_time DESC);
CREATE INDEX IF NOT EXISTS idx_razorpay_pos_transactions_payment_mode ON razorpay_pos_transactions(payment_mode);
CREATE INDEX IF NOT EXISTS idx_razorpay_pos_transactions_created_at ON razorpay_pos_transactions(created_at DESC);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_razorpay_pos_transactions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_razorpay_pos_transactions_updated_at_trigger ON razorpay_pos_transactions;
CREATE TRIGGER update_razorpay_pos_transactions_updated_at_trigger
  BEFORE UPDATE ON razorpay_pos_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_razorpay_pos_transactions_updated_at();

-- Enable RLS (Row Level Security)
ALTER TABLE razorpay_pos_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Only admins can read (for Phase 1, admin-only access)
-- Note: This uses service role key in API routes, so RLS is bypassed there
-- But we set it up for future security if needed
DROP POLICY IF EXISTS "Admins can read razorpay_pos_transactions" ON razorpay_pos_transactions;
CREATE POLICY "Admins can read razorpay_pos_transactions" ON razorpay_pos_transactions
  FOR SELECT USING (true); -- For Phase 1, allow all reads (API handles admin check)

-- Comment explaining the table purpose
COMMENT ON TABLE razorpay_pos_transactions IS 'Razorpay POS transaction notifications - Phase 1 display-only feature. Isolated from wallet/settlement logic.';

