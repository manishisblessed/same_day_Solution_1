-- ============================================================================
-- SHADVAL SETTLEMENT (Settlement-2) MIGRATION
-- ============================================================================
-- Creates:
--   1. shadval_settlement           – Transaction records
--   2. shadval_settlement_accounts  – Verified bank accounts per retailer
--   3. scheme_shadval_settlement_charges – Scheme-based charge slabs
--   4. Extends schemes.service_scope CHECK to include 'shadval_settlement'
--   5. RPC: calculate_shadval_settlement_charge_from_scheme
--
-- RUN IN: Supabase Dashboard → SQL Editor → New Query → Paste → Run
-- Safe to re-run (idempotent).
-- ============================================================================

-- ============================================================================
-- 1. EXTEND schemes.service_scope TO INCLUDE 'shadval_settlement'
-- ============================================================================
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT con.conname INTO v_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'schemes'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%service_scope%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE schemes DROP CONSTRAINT %I', v_constraint_name);
  END IF;

  ALTER TABLE schemes
    ADD CONSTRAINT schemes_service_scope_check
    CHECK (service_scope IN ('all', 'bbps', 'payout', 'mdr', 'settlement', 'aeps', 'aeps_settlement', 'shadval_settlement'));
END $$;

-- ============================================================================
-- 2. SHADVAL SETTLEMENT TRANSACTIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS shadval_settlement (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_id TEXT NOT NULL,

  -- Bank account details
  account_number TEXT NOT NULL,
  ifsc_code TEXT NOT NULL,
  account_holder_name TEXT NOT NULL,

  -- Transaction amounts
  amount DECIMAL(12, 2) NOT NULL,
  charges DECIMAL(12, 2) NOT NULL DEFAULT 0,
  total_debit DECIMAL(12, 2) NOT NULL DEFAULT 0,
  mode TEXT NOT NULL CHECK (mode IN ('IMPS', 'NEFT', 'RTGS')),

  -- Shadval API response fields
  reference_id TEXT NOT NULL UNIQUE,
  order_id TEXT,
  internal_ref_id TEXT,
  utr TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('SUCCESS', 'FAILED', 'PENDING')),
  status_message TEXT,

  -- Contact info
  contact_name TEXT,
  contact_email TEXT,
  contact_mobile TEXT,
  narration TEXT,

  -- Scheme tracking
  scheme_id UUID,
  scheme_name TEXT,
  resolved_via TEXT,

  -- Commission split tracking
  distributor_commission DECIMAL(12, 4) DEFAULT 0,
  md_commission DECIMAL(12, 4) DEFAULT 0,
  company_earning DECIMAL(12, 4) DEFAULT 0,

  -- Wallet ledger references
  transfer_ledger_id TEXT,
  charge_ledger_id TEXT,
  revenue_ledger_id TEXT,

  -- Exact amount debited from wallet (source of truth for refunds)
  actual_wallet_debit DECIMAL(12, 2),

  -- Provider timestamp
  provider_timestamp TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shadval_settlement_retailer ON shadval_settlement(retailer_id);
CREATE INDEX IF NOT EXISTS idx_shadval_settlement_status ON shadval_settlement(status);
CREATE INDEX IF NOT EXISTS idx_shadval_settlement_ref ON shadval_settlement(reference_id);
CREATE INDEX IF NOT EXISTS idx_shadval_settlement_created ON shadval_settlement(created_at DESC);

-- ============================================================================
-- 3. SHADVAL SETTLEMENT ACCOUNTS TABLE (Verified Bank Accounts)
-- ============================================================================
CREATE TABLE IF NOT EXISTS shadval_settlement_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_id TEXT NOT NULL,

  account_number TEXT NOT NULL,
  ifsc_code TEXT NOT NULL,
  account_holder_name TEXT NOT NULL,

  -- Verification
  is_verified BOOLEAN DEFAULT FALSE,
  verification_ref_id TEXT,
  verification_order_id TEXT,
  verification_utr TEXT,
  verification_status TEXT CHECK (verification_status IN ('SUCCESS', 'FAILED', 'PENDING')),
  verification_charges DECIMAL(12, 2) DEFAULT 4.00,
  verification_ledger_id TEXT,
  verification_revenue_id TEXT,
  verified_name TEXT,
  verified_at TIMESTAMP WITH TIME ZONE,

  -- Contact
  contact_name TEXT,
  contact_email TEXT,
  contact_mobile TEXT,

  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(retailer_id, account_number, ifsc_code)
);

CREATE INDEX IF NOT EXISTS idx_shadval_acct_retailer ON shadval_settlement_accounts(retailer_id);
CREATE INDEX IF NOT EXISTS idx_shadval_acct_verified ON shadval_settlement_accounts(is_verified, is_active);

-- ============================================================================
-- 4. SCHEME-BASED SHADVAL SETTLEMENT CHARGES
-- ============================================================================
CREATE TABLE IF NOT EXISTS scheme_shadval_settlement_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id UUID NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,

  transfer_mode TEXT NOT NULL CHECK (transfer_mode IN ('IMPS', 'NEFT', 'RTGS')),

  min_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  max_amount DECIMAL(12, 2) NOT NULL DEFAULT 999999999,

  retailer_charge DECIMAL(12, 4) NOT NULL DEFAULT 0,
  retailer_charge_type TEXT NOT NULL DEFAULT 'flat' CHECK (retailer_charge_type IN ('flat', 'percentage')),

  distributor_commission DECIMAL(12, 4) NOT NULL DEFAULT 0,
  distributor_commission_type TEXT NOT NULL DEFAULT 'flat' CHECK (distributor_commission_type IN ('flat', 'percentage')),

  md_commission DECIMAL(12, 4) NOT NULL DEFAULT 0,
  md_commission_type TEXT NOT NULL DEFAULT 'flat' CHECK (md_commission_type IN ('flat', 'percentage')),

  company_charge DECIMAL(12, 4) NOT NULL DEFAULT 0,
  company_charge_type TEXT NOT NULL DEFAULT 'flat' CHECK (company_charge_type IN ('flat', 'percentage')),

  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT shadval_settle_slab_range_valid CHECK (max_amount >= min_amount)
);

CREATE INDEX IF NOT EXISTS idx_shadval_settle_scheme ON scheme_shadval_settlement_charges(scheme_id);
CREATE INDEX IF NOT EXISTS idx_shadval_settle_mode ON scheme_shadval_settlement_charges(transfer_mode);
CREATE INDEX IF NOT EXISTS idx_shadval_settle_slab ON scheme_shadval_settlement_charges(min_amount, max_amount);
CREATE UNIQUE INDEX IF NOT EXISTS uq_shadval_settle_slab
  ON scheme_shadval_settlement_charges(scheme_id, transfer_mode, min_amount, max_amount);

-- ============================================================================
-- 5. updated_at TRIGGERS
-- ============================================================================
CREATE OR REPLACE FUNCTION update_shadval_settlement_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shadval_settlement_updated_at ON shadval_settlement;
CREATE TRIGGER shadval_settlement_updated_at
  BEFORE UPDATE ON shadval_settlement
  FOR EACH ROW EXECUTE FUNCTION update_shadval_settlement_updated_at();

DROP TRIGGER IF EXISTS shadval_settlement_accounts_updated_at ON shadval_settlement_accounts;
CREATE TRIGGER shadval_settlement_accounts_updated_at
  BEFORE UPDATE ON shadval_settlement_accounts
  FOR EACH ROW EXECUTE FUNCTION update_shadval_settlement_updated_at();

DROP TRIGGER IF EXISTS shadval_settle_charges_updated_at ON scheme_shadval_settlement_charges;
CREATE TRIGGER shadval_settle_charges_updated_at
  BEFORE UPDATE ON scheme_shadval_settlement_charges
  FOR EACH ROW EXECUTE FUNCTION update_shadval_settlement_updated_at();

-- ============================================================================
-- 6. RPC: calculate_shadval_settlement_charge_from_scheme
-- ============================================================================
CREATE OR REPLACE FUNCTION calculate_shadval_settlement_charge_from_scheme(
  p_scheme_id UUID,
  p_amount NUMERIC,
  p_transfer_mode TEXT DEFAULT 'IMPS'
)
RETURNS TABLE (
  retailer_charge NUMERIC,
  distributor_commission NUMERIC,
  md_commission NUMERIC,
  company_charge NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_slab RECORD;
BEGIN
  SELECT * INTO v_slab
  FROM scheme_shadval_settlement_charges s
  WHERE s.scheme_id = p_scheme_id
    AND s.status = 'active'
    AND UPPER(s.transfer_mode) = UPPER(p_transfer_mode)
    AND s.min_amount <= p_amount
    AND s.max_amount >= p_amount
  ORDER BY s.min_amount DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    CASE WHEN v_slab.retailer_charge_type = 'percentage'
         THEN ROUND(p_amount * v_slab.retailer_charge / 100, 2)
         ELSE v_slab.retailer_charge END,
    CASE WHEN v_slab.distributor_commission_type = 'percentage'
         THEN ROUND(p_amount * v_slab.distributor_commission / 100, 2)
         ELSE v_slab.distributor_commission END,
    CASE WHEN v_slab.md_commission_type = 'percentage'
         THEN ROUND(p_amount * v_slab.md_commission / 100, 2)
         ELSE v_slab.md_commission END,
    CASE WHEN v_slab.company_charge_type = 'percentage'
         THEN ROUND(p_amount * v_slab.company_charge / 100, 2)
         ELSE v_slab.company_charge END;
END;
$$;

-- ============================================================================
-- 7. ENABLE RLS (basic policies)
-- ============================================================================
ALTER TABLE shadval_settlement ENABLE ROW LEVEL SECURITY;
ALTER TABLE shadval_settlement_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheme_shadval_settlement_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access shadval_settlement" ON shadval_settlement;
CREATE POLICY "Service role full access shadval_settlement"
  ON shadval_settlement FOR ALL
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access shadval_settlement_accounts" ON shadval_settlement_accounts;
CREATE POLICY "Service role full access shadval_settlement_accounts"
  ON shadval_settlement_accounts FOR ALL
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access scheme_shadval_settlement_charges" ON scheme_shadval_settlement_charges;
CREATE POLICY "Service role full access scheme_shadval_settlement_charges"
  ON scheme_shadval_settlement_charges FOR ALL
  USING (true) WITH CHECK (true);

-- ============================================================================
-- DONE
-- ============================================================================
