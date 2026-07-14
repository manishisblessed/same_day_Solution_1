-- ============================================================================
-- Partner MDR Schemes: per-brand (merchant company) rates
-- ============================================================================
-- Adds merchant_slug to partner_schemes so a partner can have different MDR
-- rates per brand (ashvam, teachway, newscenaric, lagoon, avika).
-- NULL merchant_slug = applies to all brands (fallback).
--
-- Resolution order at settlement time (calculatePartnerMDR):
--   brand-specific scheme first, then all-brand scheme, at each card
--   specificity level (exact card+brand -> card only -> any).
--
-- Run in Supabase SQL Editor
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'partner_schemes' AND column_name = 'merchant_slug') THEN
    ALTER TABLE partner_schemes ADD COLUMN merchant_slug TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_partner_schemes_merchant_slug ON partner_schemes(merchant_slug);

-- One active scheme per partner / brand / mode / card_type / brand_type
DROP INDEX IF EXISTS idx_unique_active_partner_scheme;
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_partner_scheme
ON partner_schemes(partner_id, mode, card_type, brand_type, merchant_slug)
WHERE status = 'active';

COMMENT ON COLUMN partner_schemes.merchant_slug IS 'Merchant company (brand) this scheme applies to: ashvam, teachway, newscenaric, lagoon, avika. NULL = all brands.';
