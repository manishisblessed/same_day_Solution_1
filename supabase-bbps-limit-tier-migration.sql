-- ============================================================================
-- BBPS LIMIT TIER MIGRATION
-- ============================================================================
-- Adds bbps_limit_tier column to retailers table
-- Default: 49999 (all retailers can pay up to ₹49,999)
-- Admin can enable: 99999 or 189999 for specific retailers
-- ============================================================================

-- Add bbps_limit_tier column to retailers table
ALTER TABLE retailers 
ADD COLUMN IF NOT EXISTS bbps_limit_tier DECIMAL(12, 2) DEFAULT 49999 
CHECK (bbps_limit_tier IN (49999, 99999, 189999));

-- Set default value for existing retailers (if column was just added)
UPDATE retailers 
SET bbps_limit_tier = 49999 
WHERE bbps_limit_tier IS NULL;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_retailers_bbps_limit_tier ON retailers(bbps_limit_tier);

-- Add comment for documentation
COMMENT ON COLUMN retailers.bbps_limit_tier IS 'BBPS payment limit tier: 49999 (default), 99999, or 189999';

