-- ============================================================================
-- Partner Invoices / Settlement Statement Migration
-- ============================================================================
-- Adds an invoicing + manual-settlement-recording layer over the POS business
-- that partners (e.g. JMP Nextgen) do on assigned machines.
--
-- An invoice is a per-partner, per-period STATEMENT that shows:
--   * transaction_value : gross POS business in the period
--   * service_charge    : MDR we charged (deducted-at-source model)
--   * net_payable       : transaction_value - service_charge (amount to settle)
--   * amount_settled    : rolled up from partner_invoice_settlements
--   * balance_due       : net_payable - amount_settled
--
-- The accounts team records each settlement (how / when / where) against an
-- invoice. Multiple partial settlements per invoice are supported.
--
-- Run in Supabase SQL Editor.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. PARTNER INVOICES (statement header)
-- ============================================================================
CREATE TABLE IF NOT EXISTS partner_invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number TEXT NOT NULL UNIQUE,               -- e.g. INV-JMP-2026-08
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,

  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,

  -- Frozen aggregates (computed at generation time)
  transaction_value NUMERIC(15, 2) NOT NULL DEFAULT 0,   -- gross business
  txn_count         INTEGER        NOT NULL DEFAULT 0,
  service_charge    NUMERIC(15, 2) NOT NULL DEFAULT 0,   -- total MDR
  net_payable       NUMERIC(15, 2) NOT NULL DEFAULT 0,   -- gross - MDR

  -- Settlement rollup (maintained by trigger below)
  amount_settled NUMERIC(15, 2) NOT NULL DEFAULT 0,
  balance_due    NUMERIC(15, 2) NOT NULL DEFAULT 0,

  -- Per card-type / brand / mode breakdown, frozen as JSON at generation time
  breakdown JSONB NOT NULL DEFAULT '[]',

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'issued', 'partially_settled', 'settled', 'void')),

  notes        TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_at    TIMESTAMPTZ,
  created_by   TEXT,                                  -- admin email
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One statement per partner per period window
  UNIQUE (partner_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_partner_invoices_partner_id ON partner_invoices(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_invoices_status ON partner_invoices(status);
CREATE INDEX IF NOT EXISTS idx_partner_invoices_period ON partner_invoices(period_start, period_end);

-- ============================================================================
-- 2. PARTNER INVOICE SETTLEMENTS (how / when / where accounts team paid)
-- ============================================================================
CREATE TABLE IF NOT EXISTS partner_invoice_settlements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES partner_invoices(id) ON DELETE CASCADE,

  amount    NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  settled_on DATE NOT NULL,                           -- WHEN

  method TEXT NOT NULL                                -- HOW
    CHECK (method IN ('bank_transfer', 'wallet_push', 'upi', 'cash', 'adjustment', 'other')),
  bank_account  TEXT,                                 -- WHERE (account / wallet ref)
  utr_reference TEXT,                                 -- UTR / txn reference
  note          TEXT,

  -- Optional link to an existing ledger/settlement row when settled in-system
  reference_type TEXT,                                -- e.g. partner_wallet_ledger
  reference_id   TEXT,

  recorded_by TEXT,                                   -- admin email
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_invoice_settlements_invoice_id
  ON partner_invoice_settlements(invoice_id);
CREATE INDEX IF NOT EXISTS idx_partner_invoice_settlements_settled_on
  ON partner_invoice_settlements(settled_on);

-- ============================================================================
-- 3. ROLLUP TRIGGER — keep amount_settled / balance_due / status in sync
-- ============================================================================
CREATE OR REPLACE FUNCTION recompute_partner_invoice_rollup()
RETURNS TRIGGER AS $$
DECLARE
  v_invoice_id UUID;
  v_settled NUMERIC(15, 2);
  v_net NUMERIC(15, 2);
  v_status TEXT;
  v_current_status TEXT;
BEGIN
  v_invoice_id := COALESCE(NEW.invoice_id, OLD.invoice_id);

  SELECT COALESCE(SUM(amount), 0) INTO v_settled
  FROM partner_invoice_settlements
  WHERE invoice_id = v_invoice_id;

  SELECT net_payable, status INTO v_net, v_current_status
  FROM partner_invoices
  WHERE id = v_invoice_id;

  -- Never override a manually voided invoice
  IF v_current_status = 'void' THEN
    UPDATE partner_invoices
    SET amount_settled = v_settled,
        balance_due = GREATEST(v_net - v_settled, 0),
        updated_at = NOW()
    WHERE id = v_invoice_id;
    RETURN NULL;
  END IF;

  IF v_settled <= 0 THEN
    -- Back to issued if it was previously marked issued; otherwise keep draft
    v_status := CASE WHEN v_current_status = 'draft' THEN 'draft' ELSE 'issued' END;
  ELSIF v_settled >= v_net THEN
    v_status := 'settled';
  ELSE
    v_status := 'partially_settled';
  END IF;

  UPDATE partner_invoices
  SET amount_settled = v_settled,
      balance_due = GREATEST(v_net - v_settled, 0),
      status = v_status,
      updated_at = NOW()
  WHERE id = v_invoice_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_partner_invoice_settlement_rollup ON partner_invoice_settlements;
CREATE TRIGGER trg_partner_invoice_settlement_rollup
  AFTER INSERT OR UPDATE OR DELETE ON partner_invoice_settlements
  FOR EACH ROW
  EXECUTE FUNCTION recompute_partner_invoice_rollup();

-- Keep balance_due correct on header create/regeneration
CREATE OR REPLACE FUNCTION set_partner_invoice_balance()
RETURNS TRIGGER AS $$
BEGIN
  NEW.balance_due := GREATEST(NEW.net_payable - NEW.amount_settled, 0);
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_partner_invoice_balance ON partner_invoices;
CREATE TRIGGER trg_set_partner_invoice_balance
  BEFORE INSERT OR UPDATE ON partner_invoices
  FOR EACH ROW
  EXECUTE FUNCTION set_partner_invoice_balance();

-- ============================================================================
-- 4. RLS (service-role only, matches partner_schemes pattern)
-- ============================================================================
ALTER TABLE partner_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_invoice_settlements ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'partner_invoices' AND policyname = 'Service role full access') THEN
    CREATE POLICY "Service role full access" ON partner_invoices FOR ALL USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'partner_invoice_settlements' AND policyname = 'Service role full access') THEN
    CREATE POLICY "Service role full access" ON partner_invoice_settlements FOR ALL USING (true);
  END IF;
END $$;

COMMENT ON TABLE partner_invoices IS 'Per-partner per-period POS settlement statements (transaction value, MDR service charge, net payable, settled vs due).';
COMMENT ON TABLE partner_invoice_settlements IS 'Manual settlement log recorded by the accounts team against an invoice (how/when/where).';
