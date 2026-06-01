-- ============================================================================
-- AEPS SETTLEMENT ACCOUNTS MIGRATION
-- ============================================================================
-- Implements the 6-step AEPS wallet settlement account flow:
--   1. Retailer adds bank account details
--   2. System performs account verification (penny-drop)
--   3. Account moves to Pending Admin Approval
--   4. Admin reviews and approves/rejects
--   5. Approved account becomes available for AEPS settlement
--   6. Settlement only allowed to approved accounts
--
-- RUN IN: Supabase Dashboard → SQL Editor → New Query → Paste → Run
-- Safe to re-run (idempotent).
-- ============================================================================

-- ============================================================================
-- 1. AEPS SETTLEMENT ACCOUNTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS aeps_settlement_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL CHECK (user_role IN ('retailer', 'distributor', 'master_distributor')),

  -- Bank details
  account_number TEXT NOT NULL,
  ifsc_code TEXT NOT NULL,
  account_holder_name TEXT NOT NULL,
  bank_name TEXT,

  -- Verification (penny-drop)
  verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'failed')),
  verified_account_name TEXT,
  verification_reference_id TEXT,
  verified_at TIMESTAMP WITH TIME ZONE,

  -- Admin approval
  admin_status TEXT NOT NULL DEFAULT 'pending_approval'
    CHECK (admin_status IN ('pending_approval', 'approved', 'rejected')),
  admin_remarks TEXT,
  approved_by TEXT,
  approved_at TIMESTAMP WITH TIME ZONE,
  rejected_at TIMESTAMP WITH TIME ZONE,

  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT uq_aeps_settle_acct UNIQUE (user_id, account_number, ifsc_code)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_aeps_settle_acct_user ON aeps_settlement_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_aeps_settle_acct_admin_status ON aeps_settlement_accounts(admin_status);
CREATE INDEX IF NOT EXISTS idx_aeps_settle_acct_created ON aeps_settlement_accounts(created_at DESC);

COMMENT ON TABLE aeps_settlement_accounts IS 'Retailer bank accounts for AEPS settlement — requires verification + admin approval before use';

-- ============================================================================
-- 2. updated_at TRIGGER
-- ============================================================================
CREATE OR REPLACE FUNCTION update_aeps_settlement_accounts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS aeps_settlement_accounts_updated_at ON aeps_settlement_accounts;
CREATE TRIGGER aeps_settlement_accounts_updated_at
  BEFORE UPDATE ON aeps_settlement_accounts
  FOR EACH ROW EXECUTE FUNCTION update_aeps_settlement_accounts_updated_at();

-- ============================================================================
-- 3. RLS POLICIES
-- ============================================================================
ALTER TABLE aeps_settlement_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "aeps_settle_acct_select" ON aeps_settlement_accounts;
CREATE POLICY "aeps_settle_acct_select" ON aeps_settlement_accounts
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "aeps_settle_acct_insert" ON aeps_settlement_accounts;
CREATE POLICY "aeps_settle_acct_insert" ON aeps_settlement_accounts
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "aeps_settle_acct_update" ON aeps_settlement_accounts;
CREATE POLICY "aeps_settle_acct_update" ON aeps_settlement_accounts
  FOR UPDATE USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "aeps_settle_acct_delete" ON aeps_settlement_accounts;
CREATE POLICY "aeps_settle_acct_delete" ON aeps_settlement_accounts
  FOR DELETE USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "aeps_settle_acct_service_role" ON aeps_settlement_accounts;
CREATE POLICY "aeps_settle_acct_service_role" ON aeps_settlement_accounts
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- Grants
GRANT ALL ON aeps_settlement_accounts TO authenticated;
GRANT ALL ON aeps_settlement_accounts TO service_role;

-- ============================================================================
-- DONE
-- ============================================================================
