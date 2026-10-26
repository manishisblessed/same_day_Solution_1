-- ============================================================
-- Knteer Payout — Beneficiary Verification Charge
-- Add columns to track per-transaction verification fee (₹4 + 18% GST = ₹4.72)
-- charged when a new beneficiary account is registered for the first time.
-- ============================================================

ALTER TABLE knteer_payout_transactions
  ADD COLUMN IF NOT EXISTS verification_charge  NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_new_beneficiary   BOOLEAN       NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN knteer_payout_transactions.verification_charge
  IS 'One-time beneficiary registration fee charged to user: ₹4 base + 18% GST = ₹4.72. 0 for repeat accounts.';

COMMENT ON COLUMN knteer_payout_transactions.is_new_beneficiary
  IS 'TRUE when this transaction triggered a new beneficiary registration (verification_charge > 0).';
