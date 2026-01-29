-- Razorpay POS Phase 2 - Performance Index Migration
-- Adds index on device_serial for role-based transaction filtering
-- This is a performance optimization and does not modify table structure

-- Add index on device_serial for efficient filtering in role-based queries
CREATE INDEX IF NOT EXISTS idx_razorpay_pos_transactions_device_serial 
ON razorpay_pos_transactions(device_serial);

-- Comment explaining the index purpose
COMMENT ON INDEX idx_razorpay_pos_transactions_device_serial IS 
'Index for Phase 2 role-based transaction filtering. Enables efficient queries when filtering transactions by device_serial for role-based visibility.';

















