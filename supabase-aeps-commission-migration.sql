-- ============================================================================
-- AEPS COMMISSION ENGINE — Service Slabs + Distribution
-- ============================================================================
-- Supports slab-based commission (AEPS) and charge-based (BBPS future).
-- Run this migration on your Supabase/PostgreSQL database.
-- ============================================================================

-- 1. SERVICE SLABS TABLE
DROP TABLE IF EXISTS service_slabs CASCADE;
CREATE TABLE service_slabs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type TEXT NOT NULL,
  model_type TEXT NOT NULL DEFAULT 'commission' CHECK (model_type IN ('commission', 'charge')),
  slab_min DECIMAL(12, 2) NOT NULL DEFAULT 0,
  slab_max DECIMAL(12, 2) NOT NULL DEFAULT 999999,
  value DECIMAL(12, 4) NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN ('percentage', 'flat')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT slab_range_valid CHECK (slab_max > slab_min)
);

CREATE INDEX IF NOT EXISTS idx_service_slabs_type ON service_slabs(service_type, is_active);
CREATE INDEX IF NOT EXISTS idx_service_slabs_range ON service_slabs(service_type, slab_min, slab_max);

-- 2. COMMISSION DISTRIBUTION CONFIG
DROP TABLE IF EXISTS commission_distribution CASCADE;
CREATE TABLE commission_distribution (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_type TEXT NOT NULL UNIQUE,
  admin_margin_pct DECIMAL(5, 2) NOT NULL DEFAULT 20.00,
  md_share_pct DECIMAL(5, 2) NOT NULL DEFAULT 10.00,
  dt_share_pct DECIMAL(5, 2) NOT NULL DEFAULT 15.00,
  rt_share_pct DECIMAL(5, 2) NOT NULL DEFAULT 65.00,
  company_extra_pct DECIMAL(5, 2) NOT NULL DEFAULT 10.00,
  tds_pct DECIMAL(5, 2) NOT NULL DEFAULT 10.00,
  rt_wallet_type TEXT NOT NULL DEFAULT 'aeps',
  md_wallet_type TEXT NOT NULL DEFAULT 'primary',
  dt_wallet_type TEXT NOT NULL DEFAULT 'primary',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT distribution_total_check CHECK (
    md_share_pct + dt_share_pct + rt_share_pct + company_extra_pct = 100
  )
);

-- 3. COMMISSION LEDGER (tracks per-transaction distribution)
DROP TABLE IF EXISTS commission_ledger CASCADE;
CREATE TABLE commission_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL,
  service_type TEXT NOT NULL,
  total_commission DECIMAL(12, 4) NOT NULL,
  admin_amount DECIMAL(12, 4) NOT NULL DEFAULT 0,
  md_amount DECIMAL(12, 4) NOT NULL DEFAULT 0,
  dt_amount DECIMAL(12, 4) NOT NULL DEFAULT 0,
  rt_amount DECIMAL(12, 4) NOT NULL DEFAULT 0,
  company_extra_amount DECIMAL(12, 4) NOT NULL DEFAULT 0,
  tds_amount DECIMAL(12, 4) NOT NULL DEFAULT 0,
  md_user_id TEXT,
  dt_user_id TEXT,
  rt_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'distributed', 'failed', 'reversed')),
  distributed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commission_ledger_txn ON commission_ledger(transaction_id);
CREATE INDEX IF NOT EXISTS idx_commission_ledger_rt ON commission_ledger(rt_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commission_ledger_status ON commission_ledger(status);

-- 4. INSERT DEFAULT AEPS SLABS
INSERT INTO service_slabs (service_type, model_type, slab_min, slab_max, value, value_type) VALUES
  ('aeps_withdrawal', 'commission', 100, 500, 0.20, 'percentage'),
  ('aeps_withdrawal', 'commission', 501, 2000, 0.25, 'percentage'),
  ('aeps_withdrawal', 'commission', 2001, 3000, 0.26, 'percentage'),
  ('aeps_withdrawal', 'commission', 3001, 10000, 12.00, 'flat'),
  ('aeps_deposit', 'commission', 100, 500, 0.20, 'percentage'),
  ('aeps_deposit', 'commission', 501, 2000, 0.25, 'percentage'),
  ('aeps_deposit', 'commission', 2001, 3000, 0.26, 'percentage'),
  ('aeps_deposit', 'commission', 3001, 10000, 12.00, 'flat'),
  ('aeps_mini_statement', 'commission', 0, 999999, 0.50, 'flat'),
  ('aeps_balance_inquiry', 'commission', 0, 999999, 0.00, 'flat')
ON CONFLICT DO NOTHING;

-- 5. INSERT DEFAULT DISTRIBUTION CONFIG
INSERT INTO commission_distribution (
  service_type, admin_margin_pct, md_share_pct, dt_share_pct, rt_share_pct, company_extra_pct, tds_pct, rt_wallet_type
) VALUES
  ('aeps_withdrawal', 20.00, 10.00, 15.00, 65.00, 10.00, 10.00, 'aeps'),
  ('aeps_deposit', 20.00, 10.00, 15.00, 65.00, 10.00, 10.00, 'aeps'),
  ('aeps_mini_statement', 20.00, 10.00, 15.00, 65.00, 10.00, 10.00, 'aeps'),
  ('aeps_balance_inquiry', 20.00, 10.00, 15.00, 65.00, 10.00, 10.00, 'aeps')
ON CONFLICT (service_type) DO NOTHING;

-- 6. ADD commission_id COLUMN TO aeps_transactions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'aeps_transactions' AND column_name = 'commission_id'
  ) THEN
    ALTER TABLE aeps_transactions ADD COLUMN commission_id UUID;
  END IF;
END $$;

-- 7. DROP balance_after AND mini_statement COLUMNS (compliance: no bank data storage)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'aeps_transactions' AND column_name = 'balance_after'
  ) THEN
    ALTER TABLE aeps_transactions DROP COLUMN balance_after;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'aeps_transactions' AND column_name = 'mini_statement'
  ) THEN
    ALTER TABLE aeps_transactions DROP COLUMN mini_statement;
  END IF;
END $$;

-- 8. ADD rrn AND stan COLUMNS IF MISSING
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'aeps_transactions' AND column_name = 'rrn'
  ) THEN
    ALTER TABLE aeps_transactions ADD COLUMN rrn TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'aeps_transactions' AND column_name = 'stan'
  ) THEN
    ALTER TABLE aeps_transactions ADD COLUMN stan TEXT;
  END IF;
END $$;

-- 9. RLS POLICIES
ALTER TABLE service_slabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_distribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages slabs"
  ON service_slabs FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role manages distribution"
  ON commission_distribution FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Service role manages commission ledger"
  ON commission_ledger FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

CREATE POLICY "Users can view own commission"
  ON commission_ledger FOR SELECT
  USING (
    auth.uid()::text = rt_user_id
    OR auth.uid()::text = dt_user_id
    OR auth.uid()::text = md_user_id
  );

-- 10. TRIGGERS
CREATE OR REPLACE FUNCTION update_service_slabs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS service_slabs_updated_at ON service_slabs;
CREATE TRIGGER service_slabs_updated_at
  BEFORE UPDATE ON service_slabs
  FOR EACH ROW EXECUTE FUNCTION update_service_slabs_updated_at();

-- ============================================================================
-- DONE
-- ============================================================================
