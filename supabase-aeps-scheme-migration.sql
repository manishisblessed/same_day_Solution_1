-- ============================================================================
-- AEPS SCHEME MANAGEMENT MIGRATION (PR1)
-- ============================================================================
-- Brings AEPS into the unified scheme engine (alongside BBPS / Payout / MDR).
--
-- Model (confirmed):
--   * Commission-based: API Partner pays the company a commission POOL per txn.
--   * Company profit is taken FIRST off the pool (fixed by Admin).
--   * Remainder cascades down: MD margin -> DT margin -> RT commission.
--   * RT commission -> AEPS wallet; DT/MD margins -> primary wallet.
--   * TDS deducted from RT/DT/MD commission (rate configurable per slab).
--
-- Hierarchy assignment reuses scheme_mappings + resolve_scheme_for_user:
--   Admin -> MD -> DT -> RT  (most-specific mapping wins).
--
-- RUN IN: Supabase Dashboard -> SQL Editor -> New Query -> Paste -> Run
-- Safe to re-run (idempotent).
-- ============================================================================

-- ============================================================================
-- 1. EXTEND schemes.service_scope TO INCLUDE 'aeps'
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
    CHECK (service_scope IN ('all', 'bbps', 'payout', 'mdr', 'settlement', 'aeps'));
END $$;

-- ============================================================================
-- 2. AEPS COMMISSION CONFIGURATION TABLE
-- ============================================================================
-- One slab row per (scheme, transaction_type, amount range).
-- base_commission       = partner -> company pool (e.g. 0.25% or flat).
-- company_earning       = company profit taken first off the pool.
-- md_commission         = MD margin   -> primary wallet.
-- distributor_commission= DT margin   -> primary wallet.
-- retailer_commission   = RT earning  -> AEPS wallet.
-- tds_percentage        = TDS deducted from RT/DT/MD credit.
-- ============================================================================
CREATE TABLE IF NOT EXISTS scheme_aeps_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheme_id UUID NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,

  -- AEPS transaction type this slab applies to
  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
    'cash_withdrawal', 'cash_deposit', 'balance_inquiry', 'mini_statement', 'aadhaar_to_aadhaar'
  )),

  -- Amount slab
  min_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  max_amount DECIMAL(12, 2) NOT NULL DEFAULT 999999999,

  -- Partner -> Company pool
  base_commission DECIMAL(12, 4) NOT NULL DEFAULT 0,
  base_commission_type TEXT NOT NULL DEFAULT 'percentage' CHECK (base_commission_type IN ('flat', 'percentage')),

  -- Company profit (taken first off pool)
  company_earning DECIMAL(12, 4) NOT NULL DEFAULT 0,
  company_earning_type TEXT NOT NULL DEFAULT 'flat' CHECK (company_earning_type IN ('flat', 'percentage')),

  -- MD margin -> primary wallet
  md_commission DECIMAL(12, 4) NOT NULL DEFAULT 0,
  md_commission_type TEXT NOT NULL DEFAULT 'flat' CHECK (md_commission_type IN ('flat', 'percentage')),

  -- DT margin -> primary wallet
  distributor_commission DECIMAL(12, 4) NOT NULL DEFAULT 0,
  distributor_commission_type TEXT NOT NULL DEFAULT 'flat' CHECK (distributor_commission_type IN ('flat', 'percentage')),

  -- RT earning -> AEPS wallet
  retailer_commission DECIMAL(12, 4) NOT NULL DEFAULT 0,
  retailer_commission_type TEXT NOT NULL DEFAULT 'flat' CHECK (retailer_commission_type IN ('flat', 'percentage')),

  -- TDS applied to RT/DT/MD credit
  tds_percentage DECIMAL(5, 2) NOT NULL DEFAULT 0,

  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  CONSTRAINT aeps_slab_range_valid CHECK (max_amount >= min_amount)
);

CREATE INDEX IF NOT EXISTS idx_scheme_aeps_scheme ON scheme_aeps_commissions(scheme_id);
CREATE INDEX IF NOT EXISTS idx_scheme_aeps_txn_type ON scheme_aeps_commissions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_scheme_aeps_slab ON scheme_aeps_commissions(min_amount, max_amount);
CREATE UNIQUE INDEX IF NOT EXISTS uq_scheme_aeps_slab
  ON scheme_aeps_commissions(scheme_id, transaction_type, min_amount, max_amount);

COMMENT ON TABLE scheme_aeps_commissions IS 'AEPS commission distribution per scheme: partner pool -> company/MD/DT/RT, with amount slabs and per-txn-type granularity';

-- ============================================================================
-- 3. updated_at TRIGGER
-- ============================================================================
CREATE OR REPLACE FUNCTION update_scheme_aeps_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS scheme_aeps_updated_at ON scheme_aeps_commissions;
CREATE TRIGGER scheme_aeps_updated_at
  BEFORE UPDATE ON scheme_aeps_commissions
  FOR EACH ROW EXECUTE FUNCTION update_scheme_aeps_updated_at();

-- ============================================================================
-- 4. FUNCTION: calculate_aeps_commission_from_scheme
-- SECURITY DEFINER - runs as postgres, bypasses RLS (mirrors BBPS pattern)
-- Resolves flat/percentage values against the transaction amount.
-- ============================================================================
DROP FUNCTION IF EXISTS calculate_aeps_commission_from_scheme(UUID, DECIMAL, TEXT);

CREATE OR REPLACE FUNCTION calculate_aeps_commission_from_scheme(
  p_scheme_id UUID,
  p_amount DECIMAL(12, 2),
  p_transaction_type TEXT
)
RETURNS TABLE (
  base_commission DECIMAL(12, 2),
  company_earning DECIMAL(12, 2),
  md_commission DECIMAL(12, 2),
  distributor_commission DECIMAL(12, 2),
  retailer_commission DECIMAL(12, 2),
  tds_percentage DECIMAL(5, 2)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
BEGIN
  SELECT * INTO v_rec
  FROM scheme_aeps_commissions sac
  WHERE sac.scheme_id = p_scheme_id
    AND sac.transaction_type = p_transaction_type
    AND sac.status = 'active'
    AND sac.min_amount <= COALESCE(p_amount, 0)
    AND sac.max_amount >= COALESCE(p_amount, 0)
  ORDER BY sac.min_amount DESC
  LIMIT 1;

  IF NOT FOUND THEN
    -- Non-financial types (balance_inquiry/mini_statement) ignore amount range
    SELECT * INTO v_rec
    FROM scheme_aeps_commissions sac
    WHERE sac.scheme_id = p_scheme_id
      AND sac.transaction_type = p_transaction_type
      AND sac.status = 'active'
    ORDER BY sac.min_amount DESC
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2),
                        0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(5,2);
    RETURN;
  END IF;

  RETURN QUERY SELECT
    CASE WHEN v_rec.base_commission_type = 'percentage'
      THEN ROUND(COALESCE(p_amount,0) * v_rec.base_commission / 100, 2)
      ELSE ROUND(v_rec.base_commission, 2) END,
    CASE WHEN v_rec.company_earning_type = 'percentage'
      THEN ROUND(COALESCE(p_amount,0) * v_rec.company_earning / 100, 2)
      ELSE ROUND(v_rec.company_earning, 2) END,
    CASE WHEN v_rec.md_commission_type = 'percentage'
      THEN ROUND(COALESCE(p_amount,0) * v_rec.md_commission / 100, 2)
      ELSE ROUND(v_rec.md_commission, 2) END,
    CASE WHEN v_rec.distributor_commission_type = 'percentage'
      THEN ROUND(COALESCE(p_amount,0) * v_rec.distributor_commission / 100, 2)
      ELSE ROUND(v_rec.distributor_commission, 2) END,
    CASE WHEN v_rec.retailer_commission_type = 'percentage'
      THEN ROUND(COALESCE(p_amount,0) * v_rec.retailer_commission / 100, 2)
      ELSE ROUND(v_rec.retailer_commission, 2) END,
    v_rec.tds_percentage;
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_aeps_commission_from_scheme(UUID, DECIMAL, TEXT) TO anon, authenticated, service_role;

-- ============================================================================
-- 5. RLS POLICIES
-- ============================================================================
-- Mirrors scheme_bbps_commissions policies: authenticated users manage,
-- service_role bypasses RLS automatically. Keeps the admin/MD/DT UIs (browser
-- client, authenticated JWT) working with direct table writes like BBPS.
ALTER TABLE scheme_aeps_commissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scheme_aeps_select_policy" ON scheme_aeps_commissions;
CREATE POLICY "scheme_aeps_select_policy" ON scheme_aeps_commissions
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "scheme_aeps_insert_policy" ON scheme_aeps_commissions;
CREATE POLICY "scheme_aeps_insert_policy" ON scheme_aeps_commissions
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "scheme_aeps_update_policy" ON scheme_aeps_commissions;
CREATE POLICY "scheme_aeps_update_policy" ON scheme_aeps_commissions
  FOR UPDATE USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "scheme_aeps_delete_policy" ON scheme_aeps_commissions;
CREATE POLICY "scheme_aeps_delete_policy" ON scheme_aeps_commissions
  FOR DELETE USING (auth.role() = 'authenticated');

-- ============================================================================
-- 6. SLAB CREATION PERMISSION KEYS (Admin RBAC)
-- ============================================================================
-- Adds permission keys used by the scheme slab APIs. Master Admin can toggle
-- these per role via admin_role_permissions.
INSERT INTO admin_permissions (permission_key, permission_name, description, category) VALUES
  ('scheme.view', 'View Schemes', 'Can view schemes and slabs', 'settings'),
  ('scheme.create', 'Create Scheme', 'Can create schemes', 'settings'),
  ('scheme.slabs.create', 'Create Slabs', 'Can create commission/charge slabs', 'settings'),
  ('scheme.slabs.edit', 'Edit Slabs', 'Can edit commission/charge slabs', 'settings'),
  ('scheme.assign', 'Assign Schemes', 'Can assign schemes to entities', 'settings')
ON CONFLICT (permission_key) DO NOTHING;

-- Grant to master_admin + admin + finance by default
INSERT INTO admin_role_permissions (admin_role, permission_key, is_granted)
SELECT r.role, p.permission_key, TRUE
FROM (VALUES ('master_admin'), ('admin'), ('finance')) AS r(role)
CROSS JOIN (VALUES ('scheme.view'), ('scheme.create'), ('scheme.slabs.create'), ('scheme.slabs.edit'), ('scheme.assign')) AS p(permission_key)
ON CONFLICT (admin_role, permission_key) DO NOTHING;

-- ============================================================================
-- 7. SEED: GLOBAL AEPS SCHEME + DEFAULT SLABS (from image / legacy slabs)
-- ============================================================================
-- Creates a Global AEPS Scheme if none exists, then seeds default commission
-- slabs matching the documented structure. Distribution below is an EXAMPLE
-- split of the partner pool (company-first) and should be tuned by Finance.
DO $$
DECLARE
  v_scheme_id UUID;
BEGIN
  SELECT id INTO v_scheme_id
  FROM schemes
  WHERE scheme_type = 'global' AND service_scope = 'aeps' AND status = 'active'
  LIMIT 1;

  IF v_scheme_id IS NULL THEN
    INSERT INTO schemes (name, description, scheme_type, service_scope, status, priority, created_by_role)
    VALUES ('Global AEPS Scheme', 'Default AEPS commission scheme (seeded)', 'global', 'aeps', 'active', 1000, 'admin')
    RETURNING id INTO v_scheme_id;
  END IF;

  -- Withdrawal + Deposit slabs (base = partner pool % of amount; splits as % of amount).
  -- Distribution example: RT 65%, DT 15%, MD 10%, Company 10% of the pool.
  -- Expressed directly as % of amount for each role (pool% * share).
  INSERT INTO scheme_aeps_commissions
    (scheme_id, transaction_type, min_amount, max_amount,
     base_commission, base_commission_type,
     company_earning, company_earning_type,
     md_commission, md_commission_type,
     distributor_commission, distributor_commission_type,
     retailer_commission, retailer_commission_type,
     tds_percentage)
  VALUES
    -- cash_withdrawal
    (v_scheme_id, 'cash_withdrawal', 100, 500,    0.20, 'percentage', 0.020, 'percentage', 0.020, 'percentage', 0.030, 'percentage', 0.130, 'percentage', 5.00),
    (v_scheme_id, 'cash_withdrawal', 501, 2000,   0.25, 'percentage', 0.025, 'percentage', 0.025, 'percentage', 0.0375,'percentage', 0.1625,'percentage', 5.00),
    (v_scheme_id, 'cash_withdrawal', 2001, 3000,  0.26, 'percentage', 0.026, 'percentage', 0.026, 'percentage', 0.039, 'percentage', 0.169, 'percentage', 5.00),
    (v_scheme_id, 'cash_withdrawal', 3001, 10000, 12.00,'flat',       1.20,  'flat',       1.20,  'flat',       1.80,  'flat',       7.80,  'flat',       5.00),
    -- cash_deposit (same structure)
    (v_scheme_id, 'cash_deposit', 100, 500,    0.20, 'percentage', 0.020, 'percentage', 0.020, 'percentage', 0.030, 'percentage', 0.130, 'percentage', 5.00),
    (v_scheme_id, 'cash_deposit', 501, 2000,   0.25, 'percentage', 0.025, 'percentage', 0.025, 'percentage', 0.0375,'percentage', 0.1625,'percentage', 5.00),
    (v_scheme_id, 'cash_deposit', 2001, 3000,  0.26, 'percentage', 0.026, 'percentage', 0.026, 'percentage', 0.039, 'percentage', 0.169, 'percentage', 5.00),
    (v_scheme_id, 'cash_deposit', 3001, 10000, 12.00,'flat',       1.20,  'flat',       1.20,  'flat',       1.80,  'flat',       7.80,  'flat',       5.00),
    -- balance_inquiry (no commission)
    (v_scheme_id, 'balance_inquiry', 0, 999999999, 0, 'flat', 0, 'flat', 0, 'flat', 0, 'flat', 0, 'flat', 0),
    -- mini_statement (flat 0.50 pool, all to RT for example)
    (v_scheme_id, 'mini_statement', 0, 999999999, 0.50, 'flat', 0.05, 'flat', 0.05, 'flat', 0.05, 'flat', 0.35, 'flat', 5.00)
  ON CONFLICT (scheme_id, transaction_type, min_amount, max_amount) DO NOTHING;
END $$;

-- ============================================================================
-- 8. VERIFICATION
-- ============================================================================
-- SELECT * FROM scheme_aeps_commissions ORDER BY transaction_type, min_amount;
-- SELECT * FROM calculate_aeps_commission_from_scheme(
--   (SELECT id FROM schemes WHERE service_scope='aeps' AND scheme_type='global' LIMIT 1),
--   2000, 'cash_withdrawal');
-- Expected on 2000: base 5.00, company 0.50, md 0.50, dt 0.75, rt 3.25, tds 5%

-- ============================================================================
-- DONE
-- ============================================================================
