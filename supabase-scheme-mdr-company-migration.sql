-- ============================================================================
-- Migration: Company-wise MDR on scheme_mdr_rates
-- ============================================================================
-- Adds optional merchant_slug (POS company) so the same scheme can hold
-- different MDR rates per company + card variant.
-- NULL merchant_slug = applies to all companies (legacy / default behaviour).
-- ============================================================================

ALTER TABLE scheme_mdr_rates
  ADD COLUMN IF NOT EXISTS merchant_slug TEXT;

CREATE INDEX IF NOT EXISTS idx_scheme_mdr_merchant_slug
  ON scheme_mdr_rates(merchant_slug);

COMMENT ON COLUMN scheme_mdr_rates.merchant_slug IS
  'POS merchant company slug (ashvam, teachway, newscenaric, lagoon, avika). NULL = all companies (legacy default).';
