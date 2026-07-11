-- ============================================================================
-- SETTLEMENT LIMIT TIER MIGRATION
-- ============================================================================
-- Adds settlement_limit_tier column to retailers table
-- Default: 100000 (all retailers can settle up to ₹1,00,000 per txn)
-- Admin can set: 50000 or 75000 to restrict specific retailers
-- Shadval policy: max ₹1,00,000 per txn, max ₹10,00,000 per account/day
-- ============================================================================

-- Add settlement_limit_tier column to retailers table
ALTER TABLE retailers 
ADD COLUMN IF NOT EXISTS settlement_limit_tier DECIMAL(12, 2) DEFAULT 100000 
CHECK (settlement_limit_tier IN (50000, 75000, 100000));

-- Set default value for existing retailers (if column was just added)
UPDATE retailers 
SET settlement_limit_tier = 100000 
WHERE settlement_limit_tier IS NULL;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_retailers_settlement_limit_tier ON retailers(settlement_limit_tier);

-- Add comment for documentation
COMMENT ON COLUMN retailers.settlement_limit_tier IS 'Settlement payment limit tier: 100000 (default), 150000, or 200000';

