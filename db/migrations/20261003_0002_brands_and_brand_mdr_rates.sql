-- ============================================================================
-- Brands + per-brand MDR rate card (vendor cost + minimum MDR floor)
-- ============================================================================
-- Ports the NEXTGEN "Brand" concept into sameday (Supabase).
--
-- A Brand is a vendor / acquiring identity (ashvam, teachway, lagoon, …) that
-- groups POS machines and owns a RATE CARD. Each rate card row (brand_mdr_rates)
-- is keyed by dimensions (provider / mode / card_type / brand_type /
-- card_classification) + an amount band, and carries:
--
--   * mdr_value / mdr_value_t0      — VENDOR / acquirer COST the company pays
--                                     upstream (T+1 and T+0 legs).
--   * min_mdr_value / min_mdr_value_t0 — MINIMUM MDR the company will offer
--                                     downstream = vendor cost + guaranteed
--                                     company margin. A scheme's POS service
--                                     charge can never be priced below this, so
--                                     the company never books a loss.
--
-- Per-transaction economics this unlocks:
--   company margin (guaranteed) = min_mdr_value − mdr_value
--   revenue per txn             = scheme service charge − vendor cost (mdr_value)
--   commission pool to chain    = scheme service − min_mdr_value
--
-- All MDR values are stored as a PERCENT number in [0,100] (e.g. 1.5 = 1.5%),
-- matching the existing scheme_mdr_rates / vendor_rate convention in sameday.
--
-- "*" (or NULL) is a wildcard dimension; an exact match beats a wildcard when
-- the app resolver picks the most specific rate.
--
-- brands.key aligns with scheme_mdr_rates.merchant_slug, so a scheme's POS slab
-- resolves its authoritative vendor cost + floor from the matching brand.
--
-- Idempotent + safe to re-run.
-- ============================================================================

-- ── 1. Brands ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brands (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable slug; aligns with scheme_mdr_rates.merchant_slug + merchant-companies.ts
  key             TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,                 -- legal / display name
  short_name      TEXT,                          -- compact label for tables
  description     TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  -- Default settlement timing for this brand's captures. A per-user instant
  -- override still forces INSTANT for that user. BOTH = follow global default.
  settlement_mode TEXT NOT NULL DEFAULT 'T1'
                    CHECK (settlement_mode IN ('INSTANT', 'T1', 'BOTH')),
  -- Per-brand T+1 settlement cutoff (IST hour, 0-23). A capture at/after this
  -- hour settles T+2 instead of T+1. NULL = no early cutoff (platform default).
  t1_cutoff_hour  INT CHECK (t1_cutoff_hour IS NULL OR (t1_cutoff_hour >= 0 AND t1_cutoff_hour <= 23)),
  created_by      UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brands_active ON brands (active);

-- ── 2. Brand MDR rate card ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brand_mdr_rates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id       UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,

  -- Dimensions. '*' (or NULL for the card dims) = wildcard; an exact match
  -- beats a wildcard. Mirrors scheme_mdr_rates naming so the resolver maps
  -- 1:1 against a live capture / scheme slab.
  provider            TEXT NOT NULL DEFAULT '*',               -- RAZORPAY | PAYTM | PINELAB | *
  mode                TEXT NOT NULL DEFAULT '*'
                        CHECK (mode IN ('CARD', 'UPI', '*')),  -- payment mode
  card_type           TEXT CHECK (card_type IS NULL OR card_type IN ('CREDIT', 'DEBIT', 'PREPAID')),
  brand_type          TEXT,                                    -- VISA | MASTERCARD | RUPAY | AMEX | ... | NULL (any)
  card_classification TEXT,                                    -- PLATINUM | SIGNATURE | ... | NULL (any)

  -- Amount band (inclusive).
  min_amount     NUMERIC(14, 2) NOT NULL DEFAULT 0    CHECK (min_amount >= 0),
  max_amount     NUMERIC(14, 2) NOT NULL DEFAULT 999999999 CHECK (max_amount > 0),

  -- POS acquiring MDR is always a percentage of the transaction.
  mdr_type       TEXT NOT NULL DEFAULT 'PERCENT' CHECK (mdr_type IN ('PERCENT')),

  -- Vendor / acquirer COST (T+1 standard, T+0 instant). T0 falls back to T1
  -- when 0. Stored as a percent in [0,100].
  mdr_value      NUMERIC(6, 4) NOT NULL DEFAULT 0 CHECK (mdr_value >= 0 AND mdr_value <= 100),
  mdr_value_t0   NUMERIC(6, 4) NOT NULL DEFAULT 0 CHECK (mdr_value_t0 >= 0 AND mdr_value_t0 <= 100),

  -- Minimum MDR offered downstream = vendor cost + company margin. 0 = unset.
  -- A scheme POS service charge can never be priced below this.
  min_mdr_value    NUMERIC(6, 4) NOT NULL DEFAULT 0 CHECK (min_mdr_value >= 0 AND min_mdr_value <= 100),
  min_mdr_value_t0 NUMERIC(6, 4) NOT NULL DEFAULT 0 CHECK (min_mdr_value_t0 >= 0 AND min_mdr_value_t0 <= 100),

  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Band sanity.
  CONSTRAINT chk_brand_mdr_band CHECK (min_amount <= max_amount),
  -- Guardrail (T+1 leg): the minimum MDR must cover the vendor cost so the
  -- company never books a loss. 0 = unset (skipped). The T+0 leg is enforced in
  -- app code (validateMinMdrVsVendor) because of the T0->T1 fallback semantics.
  CONSTRAINT chk_brand_min_vs_vendor CHECK (min_mdr_value = 0 OR min_mdr_value >= mdr_value)
);

CREATE INDEX IF NOT EXISTS idx_brand_mdr_brand_provider_active
  ON brand_mdr_rates (brand_id, provider, active);
CREATE INDEX IF NOT EXISTS idx_brand_mdr_brand_active
  ON brand_mdr_rates (brand_id, active);

-- Prevent exact-duplicate rows (same dimension tuple + band). Overlapping (but
-- not identical) bands are validated in app code (validateBrandRate).
CREATE UNIQUE INDEX IF NOT EXISTS uq_brand_mdr_dims_band
  ON brand_mdr_rates (
    brand_id, provider, mode,
    COALESCE(card_type, ''), COALESCE(brand_type, ''), COALESCE(card_classification, ''),
    min_amount, max_amount
  )
  WHERE active;

-- ── 3. Link POS machines to a brand (keep legacy free-text `brand` column) ───
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pos_machines' AND column_name = 'brand_id'
  ) THEN
    ALTER TABLE pos_machines
      ADD COLUMN brand_id UUID REFERENCES brands(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pos_machines_brand_id ON pos_machines (brand_id);

-- ── 4. updated_at triggers (reuse the shared helper) ─────────────────────────
DROP TRIGGER IF EXISTS update_brands_updated_at ON brands;
CREATE TRIGGER update_brands_updated_at BEFORE UPDATE ON brands
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_brand_mdr_rates_updated_at ON brand_mdr_rates;
CREATE TRIGGER update_brand_mdr_rates_updated_at BEFORE UPDATE ON brand_mdr_rates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 5. Seed brands from the existing merchant-companies registry ─────────────
--      (lib/merchant-companies.ts). No rate cards are seeded — rates are added
--      per brand from the admin UI so vendor cost / minimum are deliberate.
INSERT INTO brands (key, name, short_name) VALUES
  ('ashvam',      'ASHVAM LEARNING PRIVATE LIMITED',                 'ASHVAM'),
  ('teachway',    'Teachway Education Private Limited',               'Teachway'),
  ('newscenaric', 'New Scenaric Travels',                            'New Scenaric'),
  ('lagoon',      'LAGOON CRAFT LABS SOLUTIONS PRIVATE LIMITED',     'Lagoon'),
  ('avika',       'Avika Departmental Private Limited',               'Avika'),
  ('samedaytours','SAMEDAY TOUR AND TRAVELS PRIVATE LIMITED',         'Sameday Tours')
ON CONFLICT (key) DO NOTHING;

-- ── 6. Enable RLS (service-role writes; mirror existing scheme tables) ───────
ALTER TABLE brands          ENABLE ROW LEVEL SECURITY;
ALTER TABLE brand_mdr_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin all brands"          ON brands;
DROP POLICY IF EXISTS "Admin all brand_mdr_rates" ON brand_mdr_rates;
CREATE POLICY "Admin all brands"          ON brands          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admin all brand_mdr_rates" ON brand_mdr_rates FOR ALL USING (true) WITH CHECK (true);
