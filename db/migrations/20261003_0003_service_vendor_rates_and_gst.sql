-- ============================================================================
-- Service vendor/minimum rate cards (BBPS + Settlement/Payout) + platform floor
-- + GST handling on the POS brand rate card.
-- ============================================================================
-- Extends the NEXTGEN "vendor cost + minimum" concept beyond POS (brands) to the
-- service rails (BBPS, Account Transfer / Payout), so every service shares ONE
-- revenue flow:
--
--   company revenue per txn = customer charge − ex-GST vendor cost
--   company margin (floor)  = minimum charge − ex-GST vendor cost (never a loss)
--
-- GST: when gst_inclusive = true the entered vendor cost ALREADY includes 18%
-- GST, so the real (ex-GST) cost = value / 1.18 (GST is an input credit / pass
-- through). When false the entered value is already ex-GST.
--
-- All percent values are stored as a PERCENT number in [0,100]. FLAT values are
-- absolute ₹. Idempotent + safe to re-run.
-- ============================================================================

-- ── 1. GST flag on the POS brand rate card ──────────────────────────────────
ALTER TABLE brand_mdr_rates
  ADD COLUMN IF NOT EXISTS gst_inclusive BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN brand_mdr_rates.gst_inclusive IS
  'When true the vendor cost (mdr_value/_t0) includes 18% GST; ex-GST cost = value/1.18';

-- ── 2. Central service vendor/minimum rate card (BBPS, PAYOUT) ──────────────
CREATE TABLE IF NOT EXISTS service_vendor_rates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Which rail this card prices.
  service_kind  TEXT NOT NULL CHECK (service_kind IN ('BBPS', 'PAYOUT')),
  -- Sub-dimension within the rail (wildcard '*' = any):
  --   BBPS   -> bbps_type  (bbps_1 | bbps_2 | *)
  --   PAYOUT -> transfer_mode (IMPS | NEFT | *)
  scope_key     TEXT NOT NULL DEFAULT '*',
  -- BBPS biller category (null/any). Ignored for PAYOUT.
  category      TEXT,

  min_amount    NUMERIC(14, 2) NOT NULL DEFAULT 0        CHECK (min_amount >= 0),
  max_amount    NUMERIC(14, 2) NOT NULL DEFAULT 999999999 CHECK (max_amount > 0),

  -- Vendor/acquirer cost the company pays upstream.
  vendor_rate_type TEXT NOT NULL DEFAULT 'PERCENT' CHECK (vendor_rate_type IN ('PERCENT', 'FLAT')),
  vendor_rate      NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (vendor_rate >= 0),

  -- Minimum charge the company offers downstream (vendor cost + company margin).
  -- A scheme's customer charge for this rail can never be priced below this.
  min_charge_type  TEXT NOT NULL DEFAULT 'PERCENT' CHECK (min_charge_type IN ('PERCENT', 'FLAT')),
  min_charge       NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (min_charge >= 0),

  -- When true the vendor cost includes 18% GST (ex-GST = value/1.18).
  gst_inclusive BOOLEAN NOT NULL DEFAULT FALSE,

  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_svr_band CHECK (min_amount <= max_amount)
);

CREATE INDEX IF NOT EXISTS idx_service_vendor_rates_kind_active
  ON service_vendor_rates (service_kind, active);

-- Prevent exact-duplicate rows (same dimensions + band).
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_vendor_rates_dims_band
  ON service_vendor_rates (
    service_kind, scope_key, COALESCE(category, ''), min_amount, max_amount
  )
  WHERE active;

-- ── 3. Platform-wide minimum floor (optional guardrail beneath all cards) ────
-- No brand/service/scheme rate may price a vendor/minimum below this.
CREATE TABLE IF NOT EXISTS company_mdr_floor (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_kind  TEXT NOT NULL CHECK (service_kind IN ('POS', 'BBPS', 'PAYOUT')),
  scope_key     TEXT NOT NULL DEFAULT '*',   -- provider/mode/transfer_mode or '*'
  min_amount    NUMERIC(14, 2) NOT NULL DEFAULT 0        CHECK (min_amount >= 0),
  max_amount    NUMERIC(14, 2) NOT NULL DEFAULT 999999999 CHECK (max_amount > 0),
  rate_type     TEXT NOT NULL DEFAULT 'PERCENT' CHECK (rate_type IN ('PERCENT', 'FLAT')),
  floor_value   NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (floor_value >= 0),
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_cmf_band CHECK (min_amount <= max_amount)
);

CREATE INDEX IF NOT EXISTS idx_company_mdr_floor_kind_active
  ON company_mdr_floor (service_kind, active);
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_mdr_floor_dims_band
  ON company_mdr_floor (service_kind, scope_key, min_amount, max_amount)
  WHERE active;

-- ── 4. updated_at triggers ──────────────────────────────────────────────────
DROP TRIGGER IF EXISTS update_service_vendor_rates_updated_at ON service_vendor_rates;
CREATE TRIGGER update_service_vendor_rates_updated_at BEFORE UPDATE ON service_vendor_rates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_company_mdr_floor_updated_at ON company_mdr_floor;
CREATE TRIGGER update_company_mdr_floor_updated_at BEFORE UPDATE ON company_mdr_floor
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 5. RLS (service-role writes; mirror existing scheme tables) ─────────────
ALTER TABLE service_vendor_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_mdr_floor    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin all service_vendor_rates" ON service_vendor_rates;
DROP POLICY IF EXISTS "Admin all company_mdr_floor"    ON company_mdr_floor;
CREATE POLICY "Admin all service_vendor_rates" ON service_vendor_rates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admin all company_mdr_floor"    ON company_mdr_floor    FOR ALL USING (true) WITH CHECK (true);
