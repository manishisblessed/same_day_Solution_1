-- ============================================================================
-- CA Billing System
-- ============================================================================
-- Three-table system for Chartered Accountant billing workflow:
--
--  1. ca_users              — CA portal user accounts (auth)
--  2. ca_bank_mdr_config    — What the bank charges per TID / Brand
--  3. ca_company_config     — Margin % and GST details per Brand
--  4. ca_reimbursement_invoices — Auto-created per POS transaction (internal)
--  5. ca_transaction_invoices   — Monthly GST filing document per Brand
--
-- Economics per transaction (₹X):
--   bank_mdr_amount        = X × bank_mdr_percent / 100
--   margin_amount          = bank_mdr_total × margin_percent / 100  (monthly)
--   service_charge_total   = bank_mdr_total + margin_amount
--   gst_amount             = service_charge_total × 18%             (GSTR-1 output)
--
-- Reimbursement invoices are auto-created by a trigger on pos_transactions.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── 1. CA Users ──────────────────────────────────────────────────────────────
-- CA portal user accounts (separate from finance_users / admin_users).
CREATE TABLE IF NOT EXISTS ca_users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  phone      TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ca_users_email ON ca_users (email) WHERE is_active;

-- ── 2. Bank MDR Config ───────────────────────────────────────────────────────
-- What the acquiring bank charges the company per TID / Brand.
-- Lookup precedence: TID + mode + card_type (most specific) → brand-level wildcard.
CREATE TABLE IF NOT EXISTS ca_bank_mdr_config (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id         UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  -- NULL tid = applies to entire brand (wildcard fallback)
  tid              TEXT,
  -- '*' = applies to any mode / card type
  payment_mode     TEXT NOT NULL DEFAULT '*'
                     CHECK (payment_mode IN ('CARD', 'UPI', '*')),
  card_type        TEXT NOT NULL DEFAULT '*'
                     CHECK (card_type IN ('CREDIT', 'DEBIT', 'PREPAID', '*')),
  bank_mdr_percent NUMERIC(8, 4) NOT NULL CHECK (bank_mdr_percent >= 0 AND bank_mdr_percent <= 100),
  effective_from   DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to     DATE,                    -- NULL = currently active
  notes            TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_ca_mdr_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_ca_bank_mdr_brand ON ca_bank_mdr_config (brand_id, is_active);
CREATE INDEX IF NOT EXISTS idx_ca_bank_mdr_tid   ON ca_bank_mdr_config (tid, is_active) WHERE tid IS NOT NULL;

-- ── 3. Company Config ────────────────────────────────────────────────────────
-- Margin % and GST registration details per Brand.
CREATE TABLE IF NOT EXISTS ca_company_config (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id       UUID NOT NULL UNIQUE REFERENCES brands(id) ON DELETE CASCADE,
  margin_percent NUMERIC(8, 4) NOT NULL DEFAULT 20
                   CHECK (margin_percent >= 0 AND margin_percent <= 1000),
  gst_percent    NUMERIC(5, 2) NOT NULL DEFAULT 18
                   CHECK (gst_percent >= 0),
  gstin          TEXT,
  legal_name     TEXT,
  address        TEXT,
  created_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 4. Reimbursement Invoices ────────────────────────────────────────────────
-- Auto-created once per successful POS transaction. Internal CA record only.
CREATE TABLE IF NOT EXISTS ca_reimbursement_invoices (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number      TEXT NOT NULL UNIQUE,         -- REIMB-ASHVAM-20261014-00001
  -- Source transaction references
  pos_transaction_id  UUID,                         -- pos_transactions.id
  razorpay_txn_id     TEXT,                         -- txn_id / externalRefNumber
  -- Business dimensions
  brand_id            UUID REFERENCES brands(id) ON DELETE SET NULL,
  partner_id          UUID REFERENCES partners(id) ON DELETE SET NULL,
  tid                 TEXT NOT NULL,
  -- Transaction details (frozen at capture time)
  transaction_amount  NUMERIC(15, 2) NOT NULL,      -- in ₹ (rupees)
  payment_mode        TEXT,
  card_type           TEXT,
  card_brand          TEXT,
  -- Bank MDR (frozen at capture time)
  bank_mdr_config_id  UUID REFERENCES ca_bank_mdr_config(id) ON DELETE SET NULL,
  bank_mdr_percent    NUMERIC(8, 4) NOT NULL DEFAULT 0,
  bank_mdr_amount     NUMERIC(15, 2) NOT NULL DEFAULT 0,   -- = amount × percent / 100
  -- Period
  transaction_date    DATE NOT NULL,
  -- Status
  status              TEXT NOT NULL DEFAULT 'issued'
                        CHECK (status IN ('issued', 'void')),
  void_reason         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ca_reimb_brand_date ON ca_reimbursement_invoices (brand_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_ca_reimb_tid_date   ON ca_reimbursement_invoices (tid, transaction_date);
CREATE INDEX IF NOT EXISTS idx_ca_reimb_pos_txn    ON ca_reimbursement_invoices (pos_transaction_id) WHERE pos_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ca_reimb_status     ON ca_reimbursement_invoices (status);

-- ── 5. Transaction Invoices ──────────────────────────────────────────────────
-- Monthly GST filing document generated per Brand by the CA.
CREATE TABLE IF NOT EXISTS ca_transaction_invoices (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number       TEXT NOT NULL UNIQUE,          -- TXNINV-ASHVAM-2026-10
  brand_id             UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  period_start         DATE NOT NULL,
  period_end           DATE NOT NULL,
  -- Aggregates (computed at generation time, frozen)
  txn_count            INTEGER NOT NULL DEFAULT 0,
  total_transaction_value NUMERIC(15, 2) NOT NULL DEFAULT 0,
  bank_mdr_total       NUMERIC(15, 2) NOT NULL DEFAULT 0,
  -- Margin (frozen from ca_company_config at generation time)
  margin_percent       NUMERIC(8, 4) NOT NULL,
  margin_amount        NUMERIC(15, 2) NOT NULL DEFAULT 0,
  -- GST filing values
  service_charge_total NUMERIC(15, 2) NOT NULL DEFAULT 0,  -- bank_mdr + margin
  gst_percent          NUMERIC(5, 2) NOT NULL DEFAULT 18,
  gst_amount           NUMERIC(15, 2) NOT NULL DEFAULT 0,
  total_with_gst       NUMERIC(15, 2) NOT NULL DEFAULT 0,
  -- Per-TID breakdown (frozen JSON array)
  breakdown            JSONB NOT NULL DEFAULT '[]',
  -- Status
  status               TEXT NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'issued', 'filed', 'void')),
  notes                TEXT,
  generated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One invoice per brand per period
  UNIQUE (brand_id, period_start, period_end),
  CONSTRAINT chk_ca_txninv_period CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_ca_txninv_brand  ON ca_transaction_invoices (brand_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_ca_txninv_status ON ca_transaction_invoices (status);

-- ── 6. updated_at triggers ───────────────────────────────────────────────────
-- Reuse the shared helper (already exists in this DB).
DROP TRIGGER IF EXISTS trg_ca_users_updated_at ON ca_users;
CREATE TRIGGER trg_ca_users_updated_at
  BEFORE UPDATE ON ca_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_ca_bank_mdr_updated_at ON ca_bank_mdr_config;
CREATE TRIGGER trg_ca_bank_mdr_updated_at
  BEFORE UPDATE ON ca_bank_mdr_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_ca_company_config_updated_at ON ca_company_config;
CREATE TRIGGER trg_ca_company_config_updated_at
  BEFORE UPDATE ON ca_company_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_ca_txninv_updated_at ON ca_transaction_invoices;
CREATE TRIGGER trg_ca_txninv_updated_at
  BEFORE UPDATE ON ca_transaction_invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── 7. Auto-create reimbursement invoice on pos_transactions INSERT ──────────
-- Resolves: TID → pos_machines.brand_id → ca_bank_mdr_config (best match)
-- Lookup order: TID-exact + mode + card_type → TID-exact + mode + * →
--               TID-exact + * + * → brand-level + mode + card_type →
--               brand-level + mode + * → brand-level + * + *
CREATE OR REPLACE FUNCTION ca_auto_reimbursement_invoice()
RETURNS TRIGGER AS $$
DECLARE
  v_brand_id    UUID;
  v_partner_id  UUID;
  v_tid         TEXT;
  v_amount_inr  NUMERIC(15, 2);
  v_mode        TEXT;
  v_card_type   TEXT;
  v_card_brand  TEXT;
  v_config      RECORD;
  v_mdr_pct     NUMERIC(8, 4);
  v_mdr_amt     NUMERIC(15, 2);
  v_inv_num     TEXT;
  v_today       DATE;
  v_seq         INTEGER;
  v_brand_short TEXT;
BEGIN
  -- Only process successful transactions
  IF NEW.status NOT IN ('CAPTURED', 'AUTHORIZED') THEN
    RETURN NEW;
  END IF;

  -- Skip if already has a reimbursement invoice
  IF EXISTS (SELECT 1 FROM ca_reimbursement_invoices WHERE pos_transaction_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  v_tid        := NEW.terminal_id;
  v_amount_inr := ROUND(NEW.amount / 100.0, 2);   -- pos_transactions stores PAISA
  v_mode       := COALESCE(NEW.payment_mode, '*');
  v_card_type  := COALESCE(NEW.card_type, '*');
  v_card_brand := NEW.card_brand;
  v_today      := COALESCE(NEW.posting_date::DATE, NEW.txn_time::DATE, CURRENT_DATE);
  v_partner_id := NEW.partner_id;

  -- Resolve brand_id from pos_machines via terminal_id
  SELECT pm.brand_id INTO v_brand_id
  FROM pos_machines pm
  WHERE pm.terminal_id = v_tid
    AND pm.brand_id IS NOT NULL
  LIMIT 1;

  IF v_brand_id IS NULL THEN
    -- No brand linked to this TID — skip invoice creation silently
    RETURN NEW;
  END IF;

  -- Find best-match bank MDR config
  -- Priority: (1) TID+mode+card_type, (2) TID+mode+*, (3) TID+*+*,
  --           (4) brand+mode+card_type, (5) brand+mode+*, (6) brand+*+*
  SELECT * INTO v_config
  FROM ca_bank_mdr_config
  WHERE brand_id = v_brand_id
    AND is_active = TRUE
    AND effective_from <= v_today
    AND (effective_to IS NULL OR effective_to >= v_today)
  ORDER BY
    -- TID-specific beats brand-wide
    CASE WHEN tid = v_tid THEN 0 ELSE 1 END,
    -- Exact mode beats wildcard
    CASE WHEN payment_mode = v_mode THEN 0 WHEN payment_mode = '*' THEN 1 ELSE 2 END,
    -- Exact card_type beats wildcard
    CASE WHEN card_type = v_card_type THEN 0 WHEN card_type = '*' THEN 1 ELSE 2 END
  LIMIT 1;

  -- No config found — still create invoice with 0% MDR so transaction is recorded
  v_mdr_pct := COALESCE(v_config.bank_mdr_percent, 0);
  v_mdr_amt := ROUND(v_amount_inr * v_mdr_pct / 100, 2);

  -- Generate invoice number: REIMB-{BRAND_SHORT}-{YYYYMMDD}-{NNNNN}
  SELECT COALESCE(short_name, UPPER(key), 'XX') INTO v_brand_short
  FROM brands WHERE id = v_brand_id;

  SELECT COALESCE(MAX(
    (regexp_match(invoice_number, '(\d+)$'))[1]::INTEGER
  ), 0) + 1
  INTO v_seq
  FROM ca_reimbursement_invoices
  WHERE invoice_number LIKE 'REIMB-' || v_brand_short || '-' || TO_CHAR(v_today, 'YYYYMMDD') || '-%';

  v_inv_num := 'REIMB-' || v_brand_short || '-' || TO_CHAR(v_today, 'YYYYMMDD') || '-' || LPAD(v_seq::TEXT, 5, '0');

  INSERT INTO ca_reimbursement_invoices (
    invoice_number, pos_transaction_id, razorpay_txn_id,
    brand_id, partner_id, tid,
    transaction_amount, payment_mode, card_type, card_brand,
    bank_mdr_config_id, bank_mdr_percent, bank_mdr_amount,
    transaction_date, status
  ) VALUES (
    v_inv_num, NEW.id, NEW.razorpay_txn_id,
    v_brand_id, v_partner_id, v_tid,
    v_amount_inr, v_mode, v_card_type, v_card_brand,
    v_config.id, v_mdr_pct, v_mdr_amt,
    v_today, 'issued'
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- Never block the transaction insert; log and move on
  RAISE WARNING '[ca_auto_reimbursement_invoice] Error for tid=% txn=%: %', v_tid, NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_ca_auto_reimbursement ON pos_transactions;
CREATE TRIGGER trg_ca_auto_reimbursement
  AFTER INSERT ON pos_transactions
  FOR EACH ROW
  EXECUTE FUNCTION ca_auto_reimbursement_invoice();

-- ── 8. Invoice number generator helper for transaction invoices ───────────────
CREATE OR REPLACE FUNCTION ca_next_txninv_number(p_brand_id UUID, p_year INT, p_month INT)
RETURNS TEXT AS $$
DECLARE
  v_brand_short TEXT;
  v_prefix      TEXT;
  v_seq         INTEGER;
BEGIN
  SELECT COALESCE(short_name, UPPER(key), 'XX') INTO v_brand_short
  FROM brands WHERE id = p_brand_id;

  v_prefix := 'TXNINV-' || v_brand_short || '-' || p_year || '-' || LPAD(p_month::TEXT, 2, '0');

  SELECT COALESCE(MAX(
    (regexp_match(invoice_number, '(\d+)$'))[1]::INTEGER
  ), 0) + 1
  INTO v_seq
  FROM ca_transaction_invoices
  WHERE invoice_number LIKE v_prefix || '-%';

  RETURN v_prefix || '-' || LPAD(v_seq::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql;

-- ── 9. RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE ca_users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ca_bank_mdr_config        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ca_company_config         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ca_reimbursement_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE ca_transaction_invoices   ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ca_users' AND policyname = 'Service role full access') THEN
    CREATE POLICY "Service role full access" ON ca_users FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ca_bank_mdr_config' AND policyname = 'Service role full access') THEN
    CREATE POLICY "Service role full access" ON ca_bank_mdr_config FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ca_company_config' AND policyname = 'Service role full access') THEN
    CREATE POLICY "Service role full access" ON ca_company_config FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ca_reimbursement_invoices' AND policyname = 'Service role full access') THEN
    CREATE POLICY "Service role full access" ON ca_reimbursement_invoices FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ca_transaction_invoices' AND policyname = 'Service role full access') THEN
    CREATE POLICY "Service role full access" ON ca_transaction_invoices FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ── 10. Comments ──────────────────────────────────────────────────────────────
COMMENT ON TABLE ca_users IS 'CA portal user accounts (ca_executive role).';
COMMENT ON TABLE ca_bank_mdr_config IS 'Bank/acquirer MDR charged to the company per TID or Brand. Lookup: TID+mode+card_type → brand-wildcard.';
COMMENT ON TABLE ca_company_config IS 'Margin % and GST details per Brand used when generating monthly Transaction Invoices.';
COMMENT ON TABLE ca_reimbursement_invoices IS 'Auto-created internal record per successful POS transaction. Captures bank MDR charged. Not sent externally.';
COMMENT ON TABLE ca_transaction_invoices IS 'Monthly GST filing invoice per Brand. Aggregates all reimbursement invoices for the period. Output tax = service_charge × 18%.';
