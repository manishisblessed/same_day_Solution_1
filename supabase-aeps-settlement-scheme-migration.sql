-- ============================================================================
-- AEPS SETTLEMENT CHARGE SCHEME MIGRATION
-- ============================================================================
-- Adds scheme-based AEPS settlement charges (hierarchical: Admin→MD→DT→RT).
-- Follows the same pattern as BBPS / Payout / MDR scheme tables.
--
-- RUN IN: Supabase Dashboard → SQL Editor → New Query → Paste → Run
-- Safe to re-run (idempotent).
-- ============================================================================

-- ============================================================================
-- 1. EXTEND schemes.service_scope TO INCLUDE 'aeps_settlement'
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
    CHECK (service_scope IN ('all', 'bbps', 'payout', 'mdr', 'settlement', 'aeps', 'aeps_settlement'));
END $$;

-- ============================================================================
-- 2. AEPS SETTLEMENT CHARGE TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS scheme_aeps_settlement_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id UUID NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,

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

  CONSTRAINT aeps_settle_slab_range_valid CHECK (max_amount >= min_amount)
);

CREATE INDEX IF NOT EXISTS idx_aeps_settle_scheme ON scheme_aeps_settlement_charges(scheme_id);
CREATE INDEX IF NOT EXISTS idx_aeps_settle_slab ON scheme_aeps_settlement_charges(min_amount, max_amount);
CREATE UNIQUE INDEX IF NOT EXISTS uq_aeps_settle_slab
  ON scheme_aeps_settlement_charges(scheme_id, min_amount, max_amount);

COMMENT ON TABLE scheme_aeps_settlement_charges IS 'AEPS settlement charge slabs per scheme: retailer_charge deducted from wallet, company/MD/DT earn from the charge';

-- ============================================================================
-- 3. updated_at TRIGGER
-- ============================================================================
CREATE OR REPLACE FUNCTION update_aeps_settle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS aeps_settle_updated_at ON scheme_aeps_settlement_charges;
CREATE TRIGGER aeps_settle_updated_at
  BEFORE UPDATE ON scheme_aeps_settlement_charges
  FOR EACH ROW EXECUTE FUNCTION update_aeps_settle_updated_at();

-- ============================================================================
-- 4. FUNCTION: calculate_aeps_settlement_charge_from_scheme
-- ============================================================================
DROP FUNCTION IF EXISTS calculate_aeps_settlement_charge_from_scheme(UUID, DECIMAL);

CREATE OR REPLACE FUNCTION calculate_aeps_settlement_charge_from_scheme(
  p_scheme_id UUID,
  p_amount DECIMAL(12, 2)
)
RETURNS TABLE (
  retailer_charge DECIMAL(12, 2),
  distributor_commission DECIMAL(12, 2),
  md_commission DECIMAL(12, 2),
  company_charge DECIMAL(12, 2)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
BEGIN
  SELECT * INTO v_rec
  FROM scheme_aeps_settlement_charges sac
  WHERE sac.scheme_id = p_scheme_id
    AND sac.status = 'active'
    AND sac.min_amount <= COALESCE(p_amount, 0)
    AND sac.max_amount >= COALESCE(p_amount, 0)
  ORDER BY sac.min_amount DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2);
    RETURN;
  END IF;

  RETURN QUERY SELECT
    CASE WHEN v_rec.retailer_charge_type = 'percentage'
      THEN ROUND(COALESCE(p_amount,0) * v_rec.retailer_charge / 100, 2)
      ELSE ROUND(v_rec.retailer_charge, 2) END,
    CASE WHEN v_rec.distributor_commission_type = 'percentage'
      THEN ROUND(COALESCE(p_amount,0) * v_rec.distributor_commission / 100, 2)
      ELSE ROUND(v_rec.distributor_commission, 2) END,
    CASE WHEN v_rec.md_commission_type = 'percentage'
      THEN ROUND(COALESCE(p_amount,0) * v_rec.md_commission / 100, 2)
      ELSE ROUND(v_rec.md_commission, 2) END,
    CASE WHEN v_rec.company_charge_type = 'percentage'
      THEN ROUND(COALESCE(p_amount,0) * v_rec.company_charge / 100, 2)
      ELSE ROUND(v_rec.company_charge, 2) END;
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_aeps_settlement_charge_from_scheme(UUID, DECIMAL) TO anon, authenticated, service_role;

-- ============================================================================
-- 5. RLS POLICIES
-- ============================================================================
ALTER TABLE scheme_aeps_settlement_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "aeps_settle_select_policy" ON scheme_aeps_settlement_charges;
CREATE POLICY "aeps_settle_select_policy" ON scheme_aeps_settlement_charges
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "aeps_settle_insert_policy" ON scheme_aeps_settlement_charges;
CREATE POLICY "aeps_settle_insert_policy" ON scheme_aeps_settlement_charges
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "aeps_settle_update_policy" ON scheme_aeps_settlement_charges;
CREATE POLICY "aeps_settle_update_policy" ON scheme_aeps_settlement_charges
  FOR UPDATE USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "aeps_settle_delete_policy" ON scheme_aeps_settlement_charges;
CREATE POLICY "aeps_settle_delete_policy" ON scheme_aeps_settlement_charges
  FOR DELETE USING (auth.role() = 'authenticated');

-- ============================================================================
-- 6. SEED: GLOBAL AEPS SETTLEMENT SCHEME + DEFAULT SLABS
-- ============================================================================
DO $$
DECLARE
  v_scheme_id UUID;
BEGIN
  SELECT id INTO v_scheme_id
  FROM schemes
  WHERE scheme_type = 'global' AND service_scope = 'aeps_settlement' AND status = 'active'
  LIMIT 1;

  IF v_scheme_id IS NULL THEN
    INSERT INTO schemes (name, description, scheme_type, service_scope, status, priority, created_by_role)
    VALUES ('Global AEPS Settlement Charges', 'Default AEPS settlement charge scheme (seeded)', 'global', 'aeps_settlement', 'active', 1000, 'admin')
    RETURNING id INTO v_scheme_id;
  END IF;

  INSERT INTO scheme_aeps_settlement_charges
    (scheme_id, min_amount, max_amount,
     retailer_charge, retailer_charge_type,
     distributor_commission, distributor_commission_type,
     md_commission, md_commission_type,
     company_charge, company_charge_type)
  VALUES
    (v_scheme_id, 100,    49999,   20, 'flat', 2, 'flat', 3, 'flat', 15, 'flat'),
    (v_scheme_id, 50000,  99999,   30, 'flat', 3, 'flat', 5, 'flat', 22, 'flat'),
    (v_scheme_id, 100000, 149999,  50, 'flat', 5, 'flat', 8, 'flat', 37, 'flat'),
    (v_scheme_id, 150000, 999999999, 70, 'flat', 7, 'flat', 10, 'flat', 53, 'flat')
  ON CONFLICT (scheme_id, min_amount, max_amount) DO NOTHING;
END $$;

-- ============================================================================
-- 7. WALLET TRANSFERS TABLE (AEPS → Primary)
-- ============================================================================
CREATE TABLE IF NOT EXISTS wallet_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL,
  source_wallet TEXT NOT NULL DEFAULT 'aeps',
  target_wallet TEXT NOT NULL DEFAULT 'primary',
  amount DECIMAL(12, 2) NOT NULL,
  source_ledger_id TEXT,
  target_ledger_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed', 'reversed')),
  remarks TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_transfers_user ON wallet_transfers(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transfers_created ON wallet_transfers(created_at DESC);

COMMENT ON TABLE wallet_transfers IS 'Tracks inter-wallet transfers (e.g. AEPS wallet → Primary wallet)';

-- ============================================================================
-- 8. AEPS SETTLEMENTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS aeps_settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  charge DECIMAL(12, 2) NOT NULL DEFAULT 0,
  net_amount DECIMAL(12, 2) NOT NULL,
  bank_account_number TEXT NOT NULL,
  bank_ifsc TEXT NOT NULL,
  bank_account_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'success', 'failed', 'reversed')),
  payout_reference_id TEXT,
  failure_reason TEXT,
  ledger_entry_id TEXT,
  idempotency_key TEXT UNIQUE,
  scheme_id UUID,
  charge_breakdown JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_aeps_settlements_user ON aeps_settlements(user_id);
CREATE INDEX IF NOT EXISTS idx_aeps_settlements_status ON aeps_settlements(status);
CREATE INDEX IF NOT EXISTS idx_aeps_settlements_created ON aeps_settlements(created_at DESC);

COMMENT ON TABLE aeps_settlements IS 'AEPS wallet settlement to bank account via Spark Up';

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_aeps_settlements_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS aeps_settlements_updated_at ON aeps_settlements;
CREATE TRIGGER aeps_settlements_updated_at
  BEFORE UPDATE ON aeps_settlements
  FOR EACH ROW EXECUTE FUNCTION update_aeps_settlements_updated_at();

-- RLS
ALTER TABLE aeps_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "aeps_settlements_select" ON aeps_settlements;
CREATE POLICY "aeps_settlements_select" ON aeps_settlements
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "aeps_settlements_insert" ON aeps_settlements;
CREATE POLICY "aeps_settlements_insert" ON aeps_settlements
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "aeps_settlements_update" ON aeps_settlements;
CREATE POLICY "aeps_settlements_update" ON aeps_settlements
  FOR UPDATE USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "wallet_transfers_select" ON wallet_transfers;
CREATE POLICY "wallet_transfers_select" ON wallet_transfers
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "wallet_transfers_insert" ON wallet_transfers;
CREATE POLICY "wallet_transfers_insert" ON wallet_transfers
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ============================================================================
-- DONE
-- ============================================================================
