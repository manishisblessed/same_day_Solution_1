-- Razorpay POS Transactions Table Migration
-- This table stores Razorpay POS transaction notifications from webhook
-- DO NOT modify existing razorpay_pos_transactions or other tables

-- Check if old razorpay_transactions table exists and drop it if it has different schema
-- (The old table has razorpay_payment_id, tid, retailer_id, etc. but not txn_id)
DO $$
BEGIN
  -- Check if table exists and has the old schema (has razorpay_payment_id column)
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'razorpay_transactions' 
    AND column_name = 'razorpay_payment_id'
  ) THEN
    -- Old table exists with different schema - drop it
    -- WARNING: This will delete all data in the old table
    DROP TABLE IF EXISTS razorpay_transactions CASCADE;
    RAISE NOTICE 'Dropped old razorpay_transactions table with different schema';
  END IF;
END $$;

-- Create razorpay_transactions table with new schema
CREATE TABLE IF NOT EXISTS razorpay_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_id TEXT UNIQUE NOT NULL,
  order_number TEXT,
  amount NUMERIC,
  currency TEXT,
  payment_mode TEXT,
  status TEXT NOT NULL, -- Mapped status: CAPTURED, FAILED, PENDING
  settlement_status TEXT,
  merchant_name TEXT,
  rr_number TEXT,
  acquirer_code TEXT,
  created_time TIMESTAMPTZ,
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create unique index on txn_id for idempotency (UPSERT logic)
CREATE UNIQUE INDEX IF NOT EXISTS idx_razorpay_transactions_txn_id ON razorpay_transactions(txn_id);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_razorpay_transactions_status ON razorpay_transactions(status);
CREATE INDEX IF NOT EXISTS idx_razorpay_transactions_created_time ON razorpay_transactions(created_time DESC);
CREATE INDEX IF NOT EXISTS idx_razorpay_transactions_payment_mode ON razorpay_transactions(payment_mode);
CREATE INDEX IF NOT EXISTS idx_razorpay_transactions_settlement_status ON razorpay_transactions(settlement_status);
CREATE INDEX IF NOT EXISTS idx_razorpay_transactions_created_at ON razorpay_transactions(created_at DESC);

-- Enable RLS (Row Level Security)
ALTER TABLE razorpay_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Allow all reads (API handles admin authentication)
DROP POLICY IF EXISTS "Allow read razorpay_transactions" ON razorpay_transactions;
CREATE POLICY "Allow read razorpay_transactions" ON razorpay_transactions
  FOR SELECT USING (true);

-- Comment explaining the table purpose
COMMENT ON TABLE razorpay_transactions IS 'Razorpay POS transaction notifications from webhook. Stores full raw payload for audit.';

