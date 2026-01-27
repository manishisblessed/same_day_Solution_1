-- =============================================
-- Express Pay Payout Schema
-- Bank transfer functionality via IMPS/NEFT
-- =============================================

-- Payout Transactions Table
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
  client_ref_id TEXT UNIQUE NOT NULL, -- Our internal reference
  transaction_id TEXT, -- SparkUp transaction ID
  rrn TEXT, -- Bank RRN
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'success', 'failed', 'refunded')),
  failure_reason TEXT,
  remarks TEXT,
  
  -- Wallet
  wallet_debited BOOLEAN DEFAULT FALSE,
  wallet_debit_id UUID,
  
  -- Commission (for distributors)
  commission_rate DECIMAL(5, 2),
  commission_amount DECIMAL(12, 2),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  
  -- Foreign Keys
  FOREIGN KEY (retailer_id) REFERENCES retailers(partner_id) ON DELETE RESTRICT
);

-- Create indexes for payout transactions
CREATE INDEX IF NOT EXISTS idx_payout_transactions_retailer_id ON payout_transactions(retailer_id);
CREATE INDEX IF NOT EXISTS idx_payout_transactions_status ON payout_transactions(status);
CREATE INDEX IF NOT EXISTS idx_payout_transactions_client_ref_id ON payout_transactions(client_ref_id);
CREATE INDEX IF NOT EXISTS idx_payout_transactions_transaction_id ON payout_transactions(transaction_id);
CREATE INDEX IF NOT EXISTS idx_payout_transactions_created_at ON payout_transactions(created_at DESC);

-- Update wallet_ledger transaction_type to include PAYOUT types (if not already)
-- First check if the constraint exists and drop it
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'wallet_ledger_transaction_type_check'
  ) THEN
    ALTER TABLE wallet_ledger DROP CONSTRAINT wallet_ledger_transaction_type_check;
  END IF;
END $$;

-- Add updated constraint with PAYOUT transaction type
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_transaction_type_check 
  CHECK (transaction_type IN (
    'POS_CREDIT', 
    'PAYOUT', 
    'REFUND', 
    'ADJUSTMENT', 
    'COMMISSION',
    'BBPS_DEBIT',
    'BBPS_REFUND',
    'AEPS_CREDIT',
    'AEPS_DEBIT',
    'FUND_TRANSFER',
    'SETTLEMENT'
  ));

-- Enable RLS
ALTER TABLE payout_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for payout_transactions
-- Admin can see all
CREATE POLICY "Admin can view all payout transactions" ON payout_transactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM auth.users 
      WHERE auth.uid() = id 
      AND raw_user_meta_data->>'role' IN ('admin', 'super_admin')
    )
  );

-- Retailers can see their own
CREATE POLICY "Retailers can view their payout transactions" ON payout_transactions
  FOR SELECT USING (
    retailer_id = (SELECT raw_user_meta_data->>'partner_id' FROM auth.users WHERE auth.uid() = id)
  );

-- Retailers can insert their own
CREATE POLICY "Retailers can create payout transactions" ON payout_transactions
  FOR INSERT WITH CHECK (
    retailer_id = (SELECT raw_user_meta_data->>'partner_id' FROM auth.users WHERE auth.uid() = id)
  );

-- Service role can do everything (for API routes)
CREATE POLICY "Service role full access to payout transactions" ON payout_transactions
  FOR ALL USING (auth.role() = 'service_role');

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON payout_transactions TO authenticated;
GRANT ALL ON payout_transactions TO service_role;

-- Add trigger for updated_at
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

-- =============================================
-- Views for reporting
-- =============================================

-- Payout summary view
CREATE OR REPLACE VIEW payout_summary AS
SELECT 
  retailer_id,
  COUNT(*) as total_transactions,
  COUNT(*) FILTER (WHERE status = 'success') as successful_transactions,
  COUNT(*) FILTER (WHERE status = 'failed') as failed_transactions,
  COUNT(*) FILTER (WHERE status = 'pending' OR status = 'processing') as pending_transactions,
  SUM(amount) FILTER (WHERE status = 'success') as total_amount_transferred,
  SUM(charges) FILTER (WHERE status = 'success') as total_charges_paid,
  SUM(amount) FILTER (WHERE status = 'success') as total_successful_amount,
  SUM(amount) FILTER (WHERE status = 'failed') as total_failed_amount
FROM payout_transactions
GROUP BY retailer_id;

GRANT SELECT ON payout_summary TO authenticated;

-- =============================================
-- Sample comment explaining the flow
-- =============================================
/*
PAYOUT FLOW:

1. Retailer initiates transfer with bank details
2. System validates:
   - Account number format
   - IFSC code format
   - Transfer amount within limits
   - Retailer wallet balance sufficient
   - Provider balance sufficient
3. Create payout_transactions record (status: pending)
4. Debit retailer wallet via add_ledger_entry
5. Update payout_transactions (wallet_debited: true, status: processing)
6. Call SparkUp expressPay2 API
7. On success: Update transaction with provider details
8. On failure: Auto-refund wallet, mark transaction as failed
9. Background job polls for pending transactions to update final status
10. If status becomes 'failed' later, auto-refund is processed
*/

