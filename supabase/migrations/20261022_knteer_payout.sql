-- ============================================================
-- Knteer Solution Payout — DB Migration
-- Run once in Supabase SQL editor (or via supabase db push)
-- ============================================================

-- ─── 1. Beneficiary cache ────────────────────────────────────────────────────
-- Stores the beneCode returned by Knteer's /payout/v1/add-bene so we don't
-- re-register the same account on every transaction.

CREATE TABLE IF NOT EXISTS knteer_beneficiaries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_id     UUID NOT NULL,
  account_number  TEXT NOT NULL,
  ifsc_code       TEXT NOT NULL,
  bene_code       TEXT NOT NULL,
  bene_name       TEXT,
  bank_name       TEXT,
  email           TEXT,
  mobile          TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- one cache entry per (retailer, account, ifsc)
  UNIQUE(retailer_id, account_number, ifsc_code)
);

CREATE INDEX IF NOT EXISTS idx_knteer_bene_retailer ON knteer_beneficiaries(retailer_id);
CREATE INDEX IF NOT EXISTS idx_knteer_bene_account  ON knteer_beneficiaries(account_number, ifsc_code);

-- ─── 2. Payout transactions ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS knteer_payout_transactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who initiated
  retailer_id           UUID NOT NULL,
  user_role             TEXT NOT NULL DEFAULT 'retailer',

  -- Beneficiary
  account_number        TEXT NOT NULL,
  ifsc_code             TEXT NOT NULL,
  account_holder_name   TEXT NOT NULL,
  bank_name             TEXT,
  email                 TEXT,
  mobile                TEXT NOT NULL,

  -- Amount
  amount                NUMERIC(12,2) NOT NULL,
  charges               NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_debit           NUMERIC(12,2) NOT NULL,
  actual_wallet_debit   NUMERIC(12,2),          -- persisted after debit so refund never drifts

  -- Transfer
  payment_mode          TEXT NOT NULL DEFAULT 'IMPS',
  bene_code             TEXT,                    -- Knteer's beneCode (may be null on PENDING)
  partner_trans_id      TEXT NOT NULL UNIQUE,    -- our reference sent as partnerTransId to Knteer
  knteer_trans_id       TEXT,                    -- Knteer's transId (KSPH...)
  status_id             INTEGER,                 -- raw StatusId from Knteer (3/4/5/6)
  utr                   TEXT,

  -- Status
  status                TEXT NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING', 'SUCCESS', 'FAILED')),
  status_message        TEXT,
  failure_reason        TEXT,

  -- Meta
  narration             TEXT,
  remarks               TEXT,
  wallet_debited        BOOLEAN NOT NULL DEFAULT FALSE,
  transfer_ledger_id    TEXT,

  -- Scheme / commissions
  scheme_id             UUID,
  scheme_name           TEXT,
  resolved_via          TEXT,
  distributor_id        UUID,
  retailer_commission_earned  NUMERIC(12,2) DEFAULT 0,
  distributor_commission      NUMERIC(12,2) DEFAULT 0,
  md_commission               NUMERIC(12,2) DEFAULT 0,
  company_earning             NUMERIC(12,2) DEFAULT 0,

  -- Timestamps
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at          TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_knteer_txn_retailer      ON knteer_payout_transactions(retailer_id);
CREATE INDEX IF NOT EXISTS idx_knteer_txn_partner_trans  ON knteer_payout_transactions(partner_trans_id);
CREATE INDEX IF NOT EXISTS idx_knteer_txn_status         ON knteer_payout_transactions(status);
CREATE INDEX IF NOT EXISTS idx_knteer_txn_created        ON knteer_payout_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knteer_txn_account        ON knteer_payout_transactions(account_number);

-- ─── 3. RLS — service-role bypass (routes use service key) ──────────────────
ALTER TABLE knteer_beneficiaries         ENABLE ROW LEVEL SECURITY;
ALTER TABLE knteer_payout_transactions   ENABLE ROW LEVEL SECURITY;

-- Allow service role (backend) full access
CREATE POLICY "service_role_knteer_bene" ON knteer_beneficiaries
  FOR ALL USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY "service_role_knteer_txn" ON knteer_payout_transactions
  FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- ─── 4. updated_at trigger ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER knteer_bene_updated_at
  BEFORE UPDATE ON knteer_beneficiaries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER knteer_txn_updated_at
  BEFORE UPDATE ON knteer_payout_transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
