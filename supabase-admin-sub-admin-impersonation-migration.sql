-- ============================================================================
-- ADMIN SUB-ADMIN SYSTEM & IMPERSONATION MIGRATION
-- ============================================================================
-- Adds support for:
-- 1. Sub-admins with department-based permissions
-- 2. Admin impersonation (login as) feature
-- ============================================================================

-- Step 1: Extend admin_users table with sub-admin fields
DO $$ 
BEGIN
  -- Add admin_type column (super_admin or sub_admin)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'admin_users' AND column_name = 'admin_type') THEN
    ALTER TABLE admin_users ADD COLUMN admin_type TEXT DEFAULT 'super_admin' 
      CHECK (admin_type IN ('super_admin', 'sub_admin'));
  END IF;

  -- Add department column for sub-admins
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'admin_users' AND column_name = 'department') THEN
    ALTER TABLE admin_users ADD COLUMN department TEXT 
      CHECK (department IN ('wallet', 'commission', 'mdr', 'limits', 'services', 'reversals', 'disputes', 'reports', 'users', 'settings', 'all'));
  END IF;

  -- Add permissions JSONB column for granular permissions
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'admin_users' AND column_name = 'permissions') THEN
    ALTER TABLE admin_users ADD COLUMN permissions JSONB DEFAULT '{}'::jsonb;
  END IF;

  -- Add is_active column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'admin_users' AND column_name = 'is_active') THEN
    ALTER TABLE admin_users ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
  END IF;

  -- Add created_by column (for tracking who created sub-admins)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'admin_users' AND column_name = 'created_by') THEN
    ALTER TABLE admin_users ADD COLUMN created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Step 2: Create admin_impersonation_sessions table
-- Tracks when admins impersonate other users
CREATE TABLE IF NOT EXISTS admin_impersonation_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  impersonated_user_id TEXT NOT NULL, -- Can be retailer_id, distributor_id, or master_distributor_id
  impersonated_user_role TEXT NOT NULL CHECK (impersonated_user_role IN ('retailer', 'distributor', 'master_distributor')),
  impersonated_user_email TEXT NOT NULL,
  session_token TEXT, -- Store session identifier if needed
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ended_at TIMESTAMP WITH TIME ZONE,
  ip_address TEXT,
  user_agent TEXT,
  is_active BOOLEAN DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_impersonation_admin_id ON admin_impersonation_sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_impersonation_user_id ON admin_impersonation_sessions(impersonated_user_id);
CREATE INDEX IF NOT EXISTS idx_impersonation_active ON admin_impersonation_sessions(is_active);

-- Step 3: Update existing admins to be super_admins
UPDATE admin_users 
SET admin_type = 'super_admin', 
    department = 'all',
    permissions = '{"all": true}'::jsonb,
    is_active = TRUE
WHERE admin_type IS NULL OR admin_type = 'admin' OR admin_type = 'super_admin';

-- Step 4: Create function to check admin permissions
CREATE OR REPLACE FUNCTION check_admin_permission(
  p_admin_id UUID,
  p_department TEXT,
  p_action TEXT DEFAULT 'read'
)
RETURNS BOOLEAN AS $$
DECLARE
  v_admin_type TEXT;
  v_department TEXT;
  v_permissions JSONB;
BEGIN
  SELECT admin_type, department, permissions INTO v_admin_type, v_department, v_permissions
  FROM admin_users
  WHERE id = p_admin_id AND is_active = TRUE;

  -- Super admins have all permissions
  IF v_admin_type = 'super_admin' THEN
    RETURN TRUE;
  END IF;

  -- Check if sub-admin has access to the department
  IF v_department = 'all' THEN
    RETURN TRUE;
  END IF;

  IF v_department != p_department THEN
    RETURN FALSE;
  END IF;

  -- Check granular permissions if they exist
  IF v_permissions IS NOT NULL AND v_permissions != '{}'::jsonb THEN
    -- Check if specific action is allowed
    IF v_permissions ? p_action THEN
      RETURN (v_permissions->>p_action)::boolean;
    END IF;
    -- Check if all actions are allowed
    IF v_permissions ? 'all' THEN
      RETURN (v_permissions->>'all')::boolean;
    END IF;
  END IF;

  -- Default: allow if department matches
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 5: Enable RLS on new table
ALTER TABLE admin_impersonation_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for impersonation sessions
DROP POLICY IF EXISTS "Admins can view their impersonation sessions" ON admin_impersonation_sessions;
CREATE POLICY "Admins can view their impersonation sessions" ON admin_impersonation_sessions
  FOR SELECT USING (true); -- Admins can view all sessions

DROP POLICY IF EXISTS "Admins can create impersonation sessions" ON admin_impersonation_sessions;
CREATE POLICY "Admins can create impersonation sessions" ON admin_impersonation_sessions
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can update impersonation sessions" ON admin_impersonation_sessions;
CREATE POLICY "Admins can update impersonation sessions" ON admin_impersonation_sessions
  FOR UPDATE USING (true);

-- Step 6: Add trigger for updated_at
DROP TRIGGER IF EXISTS update_admin_users_updated_at ON admin_users;
CREATE TRIGGER update_admin_users_updated_at BEFORE UPDATE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================

