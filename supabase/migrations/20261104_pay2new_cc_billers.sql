-- ============================================================
-- Pay2New CC Billers — Admin-controlled allowlist
-- Run once in Supabase SQL editor (or via supabase db push)
-- ============================================================

-- Table stores every credit-card biller returned by Pay2New's
-- productList API (service_id = 34). The `enabled` column is the
-- single source of truth for whether a bank is shown to users on
-- the Credit Card payment tab.
--
-- Workflow:
--   1. Admin clicks "Refresh from Pay2New" → upserts all API billers,
--      preserving existing enabled state, new billers default to FALSE.
--   2. Admin toggles individual banks on/off via the Pay2New Banks page.
--   3. /api/pay2new/billers and /api/partner/pay2new/billers filter by
--      enabled = TRUE. If the table is empty (not yet seeded), those
--      routes fall back to the previous hardcoded blocklist.

CREATE TABLE IF NOT EXISTS pay2new_cc_billers (
  product_code   TEXT        PRIMARY KEY,
  product_name   TEXT        NOT NULL,
  service_id     TEXT        NOT NULL DEFAULT '34',
  enabled        BOOLEAN     NOT NULL DEFAULT FALSE,
  updated_by     TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_p2n_cc_billers_enabled
  ON pay2new_cc_billers (enabled);

-- ─── RLS — service role (backend) has full access ────────────────────────────
ALTER TABLE pay2new_cc_billers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_p2n_cc_billers"
  ON pay2new_cc_billers
  FOR ALL
  USING (TRUE)
  WITH CHECK (TRUE);

-- ─── updated_at trigger ──────────────────────────────────────────────────────
-- Reuse the function created by earlier migrations if it already exists.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS p2n_cc_billers_updated_at ON pay2new_cc_billers;
CREATE TRIGGER p2n_cc_billers_updated_at
  BEFORE UPDATE ON pay2new_cc_billers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
