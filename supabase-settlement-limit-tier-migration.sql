-- ============================================================================
-- SETTLEMENT LIMIT TIER MIGRATION
-- ============================================================================
-- Adds settlement_limit_tier column to retailers table
-- Default: 100000 (all retailers can settle up to ₹1,00,000)
-- Admin can enable: 150000 or 200000 for specific retailers
-- ============================================================================

-- Add settlement_limit_tier column to retailers table
ALTER TABLE retailers 
ADD COLUMN IF NOT EXISTS settlement_limit_tier DECIMAL(12, 2) DEFAULT 100000 
CHECK (settlement_limit_tier IN (100000, 150000, 200000));

-- Set default value for existing retailers (if column was just added)
UPDATE retailers 
SET settlement_limit_tier = 100000 
WHERE settlement_limit_tier IS NULL;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_retailers_settlement_limit_tier ON retailers(settlement_limit_tier);

-- Add comment for documentation
COMMENT ON COLUMN retailers.settlement_limit_tier IS 'Settlement payment limit tier: 100000 (default), 150000, or 200000';

