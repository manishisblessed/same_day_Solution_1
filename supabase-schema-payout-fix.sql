-- =============================================
-- Express Pay Payout Schema - FIXED VERSION
-- Bank transfer functionality via IMPS/NEFT
-- =============================================

-- Step 1: Create payout_transactions table (this should work fine)
CREATE TABLE IF NOT EXISTS payout_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  retailer_id TEXT NOT NULL,
  distributor_id TEXT,
  master_distributor_id TEXT,
  
  -- Bank Account Details
  account_number TEXT NOT NULL,
  ifsc_code TEXT NOT NULL,
  account_holder_name TEXT NOT NULL,
  bank_name TEXT,
  
  -- Amount Details
  amount DECIMAL(12, 2) NOT NULL,
  charges DECIMAL(12, 2) NOT NULL DEFAULT 0,
  
  -- Transfer Details
  transfer_mode TEXT NOT NULL CHECK (transfer_mode IN ('IMPS', 'NEFT')),
  client_ref_id TEXT UNIQUE NOT NULL,
  transaction_id TEXT,
  rrn TEXT,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'success', 'failed', 'refunded')),
  failure_reason TEXT,
  remarks TEXT,
  
  -- Wallet
  wallet_debited BOOLEAN DEFAULT FALSE,
  wallet_debit_id UUID,
  
  -- Commission
  commission_rate DECIMAL(5, 2),
  commission_amount DECIMAL(12, 2),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Step 2: Create indexes
CREATE INDEX IF NOT EXISTS idx_payout_transactions_retailer_id ON payout_transactions(retailer_id);
CREATE INDEX IF NOT EXISTS idx_payout_transactions_status ON payout_transactions(status);
CREATE INDEX IF NOT EXISTS idx_payout_transactions_client_ref_id ON payout_transactions(client_ref_id);
CREATE INDEX IF NOT EXISTS idx_payout_transactions_transaction_id ON payout_transactions(transaction_id);
CREATE INDEX IF NOT EXISTS idx_payout_transactions_created_at ON payout_transactions(created_at DESC);

-- Step 3: Check existing transaction_types in wallet_ledger
-- Run this SELECT first to see what types exist:
-- SELECT DISTINCT transaction_type FROM wallet_ledger;

-- Step 4: Drop and recreate constraint with ALL existing types
-- First drop the constraint
ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_transaction_type_check;

-- Add constraint that includes ALL transaction types (existing + new)
-- NOTE: If you get an error, run the SELECT above to see what types exist
-- and add them to this list
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_transaction_type_check 
  CHECK (transaction_type IN (
    -- Original types
    'POS_CREDIT', 
    'PAYOUT', 
    'REFUND', 
    'ADJUSTMENT', 
    'COMMISSION',
    'BBPS_DEBIT',
    'BBPS_REFUND',
    -- AEPS types
    'AEPS_CREDIT',
    'AEPS_DEBIT',
    -- Transfer types
    'FUND_TRANSFER',
    'SETTLEMENT',
    -- Admin types
    'ADMIN_CREDIT',
    'ADMIN_DEBIT',
    -- Generic types (add any others you find)
    'CREDIT',
    'DEBIT',
    'DEPOSIT',
    'WITHDRAWAL',
    'TRANSFER',
    'FEE',
    'CHARGE',
    'REVERSAL'
  ));

-- Step 5: Enable RLS on payout_transactions
ALTER TABLE payout_transactions ENABLE ROW LEVEL SECURITY;

-- Step 6: Create RLS policies
DROP POLICY IF EXISTS "Admin can view all payout transactions" ON payout_transactions;
CREATE POLICY "Admin can view all payout transactions" ON payout_transactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM auth.users 
      WHERE auth.uid() = id 
      AND raw_user_meta_data->>'role' IN ('admin', 'super_admin')
    )
  );

DROP POLICY IF EXISTS "Retailers can view their payout transactions" ON payout_transactions;
CREATE POLICY "Retailers can view their payout transactions" ON payout_transactions
  FOR SELECT USING (
    retailer_id = (SELECT raw_user_meta_data->>'partner_id' FROM auth.users WHERE auth.uid() = id)
  );

DROP POLICY IF EXISTS "Service role full access to payout transactions" ON payout_transactions;
CREATE POLICY "Service role full access to payout transactions" ON payout_transactions
  FOR ALL USING (auth.role() = 'service_role');

-- Step 7: Grant permissions
GRANT SELECT, INSERT, UPDATE ON payout_transactions TO authenticated;
GRANT ALL ON payout_transactions TO service_role;

-- Step 8: Create update trigger
CREATE OR REPLACE FUNCTION update_payout_transactions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_payout_transactions_updated_at ON payout_transactions;
CREATE TRIGGER trigger_update_payout_transactions_updated_at
  BEFORE UPDATE ON payout_transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_payout_transactions_updated_at();

-- Done!
SELECT 'Payout schema created successfully!' as result;

