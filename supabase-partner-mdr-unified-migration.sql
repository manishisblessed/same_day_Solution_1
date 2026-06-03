-- ============================================================================
-- Migration: Add partner_mdr to scheme_mdr_rates
-- Purpose: Unified single MDR rate for Partner Plans instead of 6 separate
--          RT/DT/MD T+0/T+1 columns. Simplifies reconciliation and
--          provides accurate MDR + Net Pay Amount reporting.
-- ============================================================================

-- Add partner_mdr column to scheme_mdr_rates
ALTER TABLE scheme_mdr_rates
  ADD COLUMN IF NOT EXISTS partner_mdr numeric(6,4) DEFAULT NULL;

-- Add is_partner_plan flag so the UI knows to display simplified MDR form
ALTER TABLE schemes
  ADD COLUMN IF NOT EXISTS is_partner_plan boolean DEFAULT false;

-- Index for quick partner plan lookups
CREATE INDEX IF NOT EXISTS idx_schemes_is_partner_plan
  ON schemes (is_partner_plan) WHERE is_partner_plan = true;

-- Backfill: mark existing schemes that are mapped to partners as partner plans
UPDATE schemes
SET is_partner_plan = true
WHERE id IN (
  SELECT DISTINCT sm.scheme_id
  FROM scheme_mappings sm
  WHERE sm.entity_role = 'partner'
    AND sm.status = 'active'
);

-- Add MDR tracking columns to razorpay_pos_transactions for reconciliation
ALTER TABLE razorpay_pos_transactions
  ADD COLUMN IF NOT EXISTS partner_mdr_rate numeric(6,4) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS partner_mdr_amount numeric(12,4) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS partner_net_amount numeric(12,4) DEFAULT NULL;

COMMENT ON COLUMN scheme_mdr_rates.partner_mdr IS 'Unified MDR rate for partner plans (replaces 6 RT/DT/MD columns)';
COMMENT ON COLUMN schemes.is_partner_plan IS 'When true, MDR config uses single partner_mdr field instead of RT/DT/MD breakdown';
COMMENT ON COLUMN razorpay_pos_transactions.partner_mdr_rate IS 'MDR rate applied to this transaction';
COMMENT ON COLUMN razorpay_pos_transactions.partner_mdr_amount IS 'MDR fee amount (transaction_amount * partner_mdr_rate / 100)';
COMMENT ON COLUMN razorpay_pos_transactions.partner_net_amount IS 'Net pay amount (transaction_amount - partner_mdr_amount)';
