-- ============================================================================
-- GEOLOCATION TRACKING MIGRATION - COMPLETE
-- ============================================================================
-- Adds geolocation tracking (latitude, longitude, accuracy) for ALL user
-- activities across ALL roles: admin, sub_admin, master_distributor,
-- distributor, retailer, partner.
--
-- This migration:
--   1. Creates a master activity_logs table (central audit trail with geo)
--   2. Creates a user_locations table (last known location per user)
--   3. Adds geolocation columns to ALL existing transaction/activity tables
--   4. Creates indexes for geo-based queries
--   5. Creates a helper function to log activities
--   6. Sets up RLS policies
--
-- RUN THIS IN SUPABASE SQL EDITOR (single execution, all idempotent)
-- ============================================================================


-- ============================================================================
-- 1. MASTER ACTIVITY LOGS TABLE
-- ============================================================================
-- Central audit trail for EVERY action by EVERY role with geolocation.
-- This is the single source of truth for "who did what, when, and WHERE."
-- ============================================================================

CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- WHO performed the action
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL CHECK (user_role IN (
    'admin', 'sub_admin', 'super_admin',
    'master_distributor', 'distributor', 'retailer', 'partner'
  )),

  -- WHAT action was performed
  activity_type TEXT NOT NULL,
  activity_category TEXT NOT NULL CHECK (activity_category IN (
    'auth',           -- login, logout, session_sync, tpin_set, tpin_verify
    'bbps',           -- bill_fetch, bill_pay, complaint_register, complaint_track
    'payout',         -- bank_transfer, verify_account
    'aeps',           -- balance_inquiry, cash_withdrawal, aadhaar_to_aadhaar, mini_statement
    'pos',            -- pulsepay, auto_settle_t1, machine_assign
    'wallet',         -- balance_check, transfer
    'settlement',     -- create, run_t1
    'admin',          -- create_user, reset_password, impersonate, wallet_push, wallet_pull,
                      -- freeze, settlement_hold, limit_update, reversal, dispute_handle,
                      -- commission_push, commission_pull, pos_upload, service_toggle, etc.
    'scheme',         -- create, update, mapping, resolve_charges
    'report',         -- transaction_report, ledger_report, pos_report, export
    'beneficiary',    -- create, update, delete
    'distributor',    -- create_retailer, wallet_transfer, commission_adjust
    'master_dist',    -- create_distributor, approve_mdr
    'other'           -- contact_form, any uncategorized
  )),
  activity_description TEXT,

  -- Reference to the related record
  reference_id TEXT,
  reference_table TEXT,

  -- WHERE (Geolocation from browser)
  latitude DECIMAL(10, 8),          -- -90.00000000 to +90.00000000
  longitude DECIMAL(11, 8),         -- -180.00000000 to +180.00000000
  geo_accuracy DECIMAL(10, 2),      -- accuracy in meters
  geo_source TEXT CHECK (geo_source IN ('gps', 'network', 'ip_fallback', 'denied', 'unavailable', NULL)),

  -- WHERE (Network context)
  ip_address INET,
  user_agent TEXT,
  device_info JSONB,

  -- Request metadata
  request_path TEXT,
  request_method TEXT CHECK (request_method IN ('GET', 'POST', 'PUT', 'DELETE', 'PATCH', NULL)),

  -- Outcome
  status TEXT DEFAULT 'success' CHECK (status IN ('success', 'failed', 'error', 'denied')),
  error_message TEXT,

  -- Extra data (transaction amounts, before/after balances, etc.)
  metadata JSONB,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_role ON activity_logs(user_role);
CREATE INDEX IF NOT EXISTS idx_activity_logs_activity_type ON activity_logs(activity_type);
CREATE INDEX IF NOT EXISTS idx_activity_logs_activity_category ON activity_logs(activity_category);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_reference ON activity_logs(reference_id, reference_table);
CREATE INDEX IF NOT EXISTS idx_activity_logs_status ON activity_logs(status);
CREATE INDEX IF NOT EXISTS idx_activity_logs_ip ON activity_logs(ip_address) WHERE ip_address IS NOT NULL;

-- Geo index for location-based queries (fraud detection: find all actions from same area)
CREATE INDEX IF NOT EXISTS idx_activity_logs_geo
  ON activity_logs(latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- Composite index for per-user timeline with location
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_timeline
  ON activity_logs(user_id, created_at DESC);

COMMENT ON TABLE activity_logs IS 'Master audit trail for ALL user activities with geolocation tracking';


-- ============================================================================
-- 2. USER LAST KNOWN LOCATION TABLE
-- ============================================================================
-- Quick-lookup table: always holds the most recent location for each user.
-- Updated automatically every time an activity is logged with geo data.
-- Useful for admin dashboards showing "where are my retailers right now."
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL CHECK (user_role IN (
    'admin', 'sub_admin', 'super_admin',
    'master_distributor', 'distributor', 'retailer', 'partner'
  )),
  latitude DECIMAL(10, 8) NOT NULL,
  longitude DECIMAL(11, 8) NOT NULL,
  geo_accuracy DECIMAL(10, 2),
  geo_source TEXT,
  ip_address INET,
  last_activity_type TEXT,
  last_activity_id UUID,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_locations_user_id ON user_locations(user_id);
CREATE INDEX IF NOT EXISTS idx_user_locations_user_role ON user_locations(user_role);
CREATE INDEX IF NOT EXISTS idx_user_locations_geo
  ON user_locations(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_user_locations_updated_at ON user_locations(updated_at DESC);

COMMENT ON TABLE user_locations IS 'Last known geolocation for each user, updated on every activity';


-- ============================================================================
-- 3. ADD GEOLOCATION COLUMNS TO ALL EXISTING TRANSACTION TABLES
-- ============================================================================
-- Every table that records a financial action or significant user event
-- gets latitude, longitude, geo_accuracy, and ip_address columns.
-- ============================================================================

-- ---- 3a. bbps_transactions ----
ALTER TABLE bbps_transactions
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS geo_accuracy DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS ip_address INET;

-- ---- 3b. razorpay_transactions ----
ALTER TABLE razorpay_transactions
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS geo_accuracy DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS ip_address INET;

-- ---- 3c. payout_transactions ----
ALTER TABLE payout_transactions
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS geo_accuracy DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS ip_address INET;

-- ---- 3d. aeps_transactions ----
ALTER TABLE aeps_transactions
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS geo_accuracy DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS ip_address INET;

-- ---- 3e. settlements ----
ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS geo_accuracy DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS ip_address INET;

-- ---- 3f. wallet_ledger ----
ALTER TABLE wallet_ledger
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS geo_accuracy DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS ip_address INET;

-- ---- 3g. transactions (MDR scheme engine) ----
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS geo_accuracy DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS ip_address INET;

-- ---- 3h. reversals ----
ALTER TABLE reversals
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS geo_accuracy DECIMAL(10, 2);
-- (ip_address TEXT column already exists on reversals)

-- ---- 3i. disputes ----
ALTER TABLE disputes
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS geo_accuracy DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS ip_address INET;

-- ---- 3j. instacash_batches ----
ALTER TABLE instacash_batches
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS geo_accuracy DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS ip_address INET;

-- ---- 3k. admin_audit_log ----
-- (ip_address TEXT and user_agent TEXT already exist)
ALTER TABLE admin_audit_log
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS geo_accuracy DECIMAL(10, 2);

-- ---- 3l. admin_impersonation_sessions ----
-- (ip_address TEXT and user_agent TEXT already exist)
ALTER TABLE admin_impersonation_sessions
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS geo_accuracy DECIMAL(10, 2);

-- ---- 3m. saved_beneficiaries ----
ALTER TABLE saved_beneficiaries
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS geo_accuracy DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS ip_address INET;

-- ---- 3n. razorpay_pos_transactions ----
ALTER TABLE razorpay_pos_transactions
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS geo_accuracy DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS ip_address INET;

-- ---- 3o. scheme_mappings ----
ALTER TABLE scheme_mappings
  ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS geo_accuracy DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS ip_address INET;


-- ============================================================================
-- 4. HELPER FUNCTION: log_activity()
-- ============================================================================
-- Callable from application code or other DB functions.
-- Logs the activity AND updates user_locations in one call.
-- ============================================================================

CREATE OR REPLACE FUNCTION log_activity(
  p_user_id TEXT,
  p_user_role TEXT,
  p_activity_type TEXT,
  p_activity_category TEXT,
  p_activity_description TEXT DEFAULT NULL,
  p_reference_id TEXT DEFAULT NULL,
  p_reference_table TEXT DEFAULT NULL,
  p_latitude DECIMAL DEFAULT NULL,
  p_longitude DECIMAL DEFAULT NULL,
  p_geo_accuracy DECIMAL DEFAULT NULL,
  p_geo_source TEXT DEFAULT NULL,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_device_info JSONB DEFAULT NULL,
  p_request_path TEXT DEFAULT NULL,
  p_request_method TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'success',
  p_error_message TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_log_id UUID;
BEGIN
  -- Insert into activity_logs
  INSERT INTO activity_logs (
    user_id, user_role, activity_type, activity_category,
    activity_description, reference_id, reference_table,
    latitude, longitude, geo_accuracy, geo_source,
    ip_address, user_agent, device_info,
    request_path, request_method,
    status, error_message, metadata
  ) VALUES (
    p_user_id, p_user_role, p_activity_type, p_activity_category,
    p_activity_description, p_reference_id, p_reference_table,
    p_latitude, p_longitude, p_geo_accuracy, p_geo_source,
    p_ip_address, p_user_agent, p_device_info,
    p_request_path, p_request_method,
    p_status, p_error_message, p_metadata
  ) RETURNING id INTO v_log_id;

  -- Update user's last known location (only if we have geo data)
  IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    INSERT INTO user_locations (
      user_id, user_role, latitude, longitude, geo_accuracy,
      geo_source, ip_address, last_activity_type, last_activity_id, updated_at
    ) VALUES (
      p_user_id, p_user_role, p_latitude, p_longitude, p_geo_accuracy,
      p_geo_source, p_ip_address, p_activity_type, v_log_id, NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      user_role = EXCLUDED.user_role,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      geo_accuracy = EXCLUDED.geo_accuracy,
      geo_source = EXCLUDED.geo_source,
      ip_address = EXCLUDED.ip_address,
      last_activity_type = EXCLUDED.last_activity_type,
      last_activity_id = EXCLUDED.last_activity_id,
      updated_at = NOW();
  END IF;

  RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION log_activity IS 'Logs user activity with geolocation and updates user_locations table';


-- ============================================================================
-- 5. ROW LEVEL SECURITY POLICIES
-- ============================================================================

ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_locations ENABLE ROW LEVEL SECURITY;

-- Drop existing policies first to make this migration re-runnable
DROP POLICY IF EXISTS "Service role full access on activity_logs" ON activity_logs;
DROP POLICY IF EXISTS "Service role full access on user_locations" ON user_locations;
DROP POLICY IF EXISTS "Users can view own activity logs" ON activity_logs;
DROP POLICY IF EXISTS "Users can view own location" ON user_locations;

-- Service role: full access (used by API routes via SUPABASE_SERVICE_ROLE_KEY)
CREATE POLICY "Service role full access on activity_logs"
  ON activity_logs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access on user_locations"
  ON user_locations FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Users can read only their own activity logs
CREATE POLICY "Users can view own activity logs"
  ON activity_logs FOR SELECT
  USING (auth.uid()::text = user_id);

-- Users can read only their own location
CREATE POLICY "Users can view own location"
  ON user_locations FOR SELECT
  USING (auth.uid()::text = user_id);


-- ============================================================================
-- 6. USEFUL VIEWS FOR ADMIN DASHBOARD
-- ============================================================================

-- View: Recent activities with location (for admin monitoring)
CREATE OR REPLACE VIEW recent_activities_with_location AS
SELECT
  al.id,
  al.user_id,
  al.user_role,
  al.activity_type,
  al.activity_category,
  al.activity_description,
  al.latitude,
  al.longitude,
  al.geo_accuracy,
  al.geo_source,
  al.ip_address,
  al.status,
  al.reference_id,
  al.reference_table,
  al.created_at,
  ul.latitude AS last_known_lat,
  ul.longitude AS last_known_lng
FROM activity_logs al
LEFT JOIN user_locations ul ON al.user_id = ul.user_id
ORDER BY al.created_at DESC;

-- View: All users with their last known locations (admin map view)
CREATE OR REPLACE VIEW users_current_locations AS
SELECT
  ul.user_id,
  ul.user_role,
  ul.latitude,
  ul.longitude,
  ul.geo_accuracy,
  ul.geo_source,
  ul.ip_address,
  ul.last_activity_type,
  ul.updated_at,
  EXTRACT(EPOCH FROM (NOW() - ul.updated_at)) / 60 AS minutes_since_last_activity
FROM user_locations ul
ORDER BY ul.updated_at DESC;


-- ============================================================================
-- 7. PARTITION MAINTENANCE (for large-scale deployments)
-- ============================================================================
-- If activity_logs grows very large, you can partition it by month.
-- For now, the indexes above are sufficient. Uncomment below when needed.
-- ============================================================================

-- CREATE INDEX IF NOT EXISTS idx_activity_logs_month
--   ON activity_logs (date_trunc('month', created_at));


-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
-- Summary of changes:
--
-- NEW TABLES:
--   1. activity_logs        - Master audit trail with geolocation
--   2. user_locations       - Last known location per user (auto-updated)
--
-- ALTERED TABLES (added: latitude, longitude, geo_accuracy, ip_address):
--   3.  bbps_transactions
--   4.  razorpay_transactions
--   5.  payout_transactions
--   6.  aeps_transactions
--   7.  settlements
--   8.  wallet_ledger
--   9.  transactions (MDR scheme engine)
--   10. reversals (added lat/lng/accuracy; ip_address already existed)
--   11. disputes
--   12. instacash_batches
--   13. admin_audit_log (added lat/lng/accuracy; ip_address already existed)
--   14. admin_impersonation_sessions (added lat/lng/accuracy; ip/ua already existed)
--   15. saved_beneficiaries
--   16. razorpay_pos_transactions
--   17. scheme_mappings
--
-- NEW FUNCTION:
--   18. log_activity() - Helper function to log + update location in one call
--
-- NEW VIEWS:
--   19. recent_activities_with_location - Admin monitoring view
--   20. users_current_locations         - Admin map/dashboard view
--
-- NEW RLS POLICIES:
--   21. Service role full access on activity_logs
--   22. Service role full access on user_locations
--   23. Users can view own activity logs
--   24. Users can view own location
-- ============================================================================
