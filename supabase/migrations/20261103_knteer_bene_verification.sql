-- ============================================================
-- Knteer Beneficiary — Bank Verification Columns
-- Add eKYC verification tracking and disclaimer fields
-- Run in Supabase SQL editor or via supabase db push
-- ============================================================

ALTER TABLE knteer_beneficiaries
  ADD COLUMN IF NOT EXISTS is_bank_verified        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verified_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_name_at_bank   TEXT,
  ADD COLUMN IF NOT EXISTS verification_utr        TEXT,
  ADD COLUMN IF NOT EXISTS verification_orderid    TEXT,
  ADD COLUMN IF NOT EXISTS disclaimer_accepted     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS disclaimer_accepted_at  TIMESTAMPTZ;

-- Index to quickly filter verified accounts
CREATE INDEX IF NOT EXISTS idx_knteer_bene_verified
  ON knteer_beneficiaries(retailer_id, is_bank_verified)
  WHERE is_active = TRUE;

-- Backfill: existing accounts registered before this migration
-- are treated as disclaimer-accepted (they went through the old paid flow)
UPDATE knteer_beneficiaries
SET
  disclaimer_accepted     = TRUE,
  disclaimer_accepted_at  = created_at
WHERE disclaimer_accepted = FALSE;
