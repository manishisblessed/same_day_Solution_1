-- ============================================================================
-- Add `provider` column to aeps_merchants and aeps_transactions
-- so admin can distinguish Chagans vs Pay2New records.
-- Also add `onboard_order_id` to aeps_merchants for Pay2New onboarding audit trail.
-- ============================================================================

-- aeps_merchants: which provider onboarded the merchant
ALTER TABLE aeps_merchants
  ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'chagans';

-- aeps_merchants: Pay2New onboarding order_id for audit
ALTER TABLE aeps_merchants
  ADD COLUMN IF NOT EXISTS onboard_order_id TEXT;

-- aeps_transactions: which provider processed the transaction
ALTER TABLE aeps_transactions
  ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'chagans';

-- Backfill: set provider='pay2new' for merchants whose merchant_id is a numeric outletId
-- (Chagans IDs are MongoDB ObjectIds / prefixed strings)
UPDATE aeps_merchants
  SET provider = 'pay2new'
  WHERE merchant_id ~ '^\d+$'
    AND provider = 'chagans'
    AND NOT (merchant_id LIKE 'MOCK_%' OR merchant_id LIKE 'TEMP_%' OR merchant_id LIKE 'PENDING_%' OR merchant_id LIKE 'CHAGANS_%');

-- Indexes for admin filtering
CREATE INDEX IF NOT EXISTS idx_aeps_merchants_provider ON aeps_merchants(provider);
CREATE INDEX IF NOT EXISTS idx_aeps_transactions_provider ON aeps_transactions(provider);

COMMENT ON COLUMN aeps_merchants.provider IS 'AePS provider: chagans or pay2new';
COMMENT ON COLUMN aeps_merchants.onboard_order_id IS 'Pay2New PAN-Based Onboarding order_id';
COMMENT ON COLUMN aeps_transactions.provider IS 'AePS provider that processed this transaction';
