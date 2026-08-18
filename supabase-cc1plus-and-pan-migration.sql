-- Migration: CC1++ high-value gate + dedicated PAN column
-- 1. credit_card1_plus_enabled: add-on to Credit Card-1 (Pay2New) that unlocks
--    bill payments above Rs.49,999 (combined with a matching scheme slab).
-- 2. pan_number: dedicated PAN column on the ledgers for Pay2New CC payments,
--    surfaced in the bill payment report.

-- ── CC1++ SERVICE FLAG ──────────────────────────────────────────────
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS credit_card1_plus_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS credit_card1_plus_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE master_distributors ADD COLUMN IF NOT EXISTS credit_card1_plus_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS credit_card1_plus_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_retailers_credit_card1_plus_enabled ON retailers (credit_card1_plus_enabled);
CREATE INDEX IF NOT EXISTS idx_distributors_credit_card1_plus_enabled ON distributors (credit_card1_plus_enabled);
CREATE INDEX IF NOT EXISTS idx_master_distributors_credit_card1_plus_enabled ON master_distributors (credit_card1_plus_enabled);
CREATE INDEX IF NOT EXISTS idx_partners_credit_card1_plus_enabled ON partners (credit_card1_plus_enabled);

-- ── PAN NUMBER COLUMN ───────────────────────────────────────────────
ALTER TABLE wallet_ledger ADD COLUMN IF NOT EXISTS pan_number TEXT;
ALTER TABLE partner_wallet_ledger ADD COLUMN IF NOT EXISTS pan_number TEXT;
