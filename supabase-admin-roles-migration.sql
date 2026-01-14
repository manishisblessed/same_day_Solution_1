-- ============================================================================
-- ROLE-BASED ADMIN ACCESS SYSTEM
-- ============================================================================
-- Creates master admin and role-based admin access system
-- ============================================================================

-- Add admin_role field to admin_users table
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'admin_users' AND column_name = 'admin_role') THEN
    ALTER TABLE admin_users ADD COLUMN admin_role TEXT DEFAULT 'admin' 
      CHECK (admin_role IN ('master_admin', 'admin', 'support', 'finance', 'operations'));
    COMMENT ON COLUMN admin_users.admin_role IS 'Admin role: master_admin (full access), admin (standard), support, finance, operations';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'admin_users' AND column_name = 'permissions') THEN
    ALTER TABLE admin_users ADD COLUMN permissions JSONB DEFAULT '{}'::jsonb;
    COMMENT ON COLUMN admin_users.permissions IS 'JSON object with specific permissions: {wallet_management: true, user_management: true, etc.}';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'admin_users' AND column_name = 'is_active') THEN
    ALTER TABLE admin_users ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
    COMMENT ON COLUMN admin_users.is_active IS 'Whether admin account is active';
  END IF;
END $$;

-- Create admin_permissions table for granular permission control
CREATE TABLE IF NOT EXISTS admin_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  permission_key TEXT NOT NULL UNIQUE,
  permission_name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL, -- 'wallet', 'user', 'transaction', 'settings', 'reports'
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default permissions
INSERT INTO admin_permissions (permission_key, permission_name, description, category) VALUES
  ('wallet.push', 'Push Funds', 'Can push funds to user wallets', 'wallet'),
  ('wallet.pull', 'Pull Funds', 'Can pull funds from user wallets', 'wallet'),
  ('wallet.freeze', 'Freeze Wallet', 'Can freeze user wallets', 'wallet'),
  ('wallet.unfreeze', 'Unfreeze Wallet', 'Can unfreeze user wallets', 'wallet'),
  ('wallet.settlement_hold', 'Hold Settlement', 'Can hold settlements', 'wallet'),
  ('wallet.settlement_release', 'Release Settlement', 'Can release settlements', 'wallet'),
  ('user.create', 'Create User', 'Can create new users', 'user'),
  ('user.edit', 'Edit User', 'Can edit user details', 'user'),
  ('user.delete', 'Delete User', 'Can delete users', 'user'),
  ('user.activate', 'Activate User', 'Can activate users', 'user'),
  ('user.deactivate', 'Deactivate User', 'Can deactivate users', 'user'),
  ('transaction.view', 'View Transactions', 'Can view all transactions', 'transaction'),
  ('transaction.reverse', 'Reverse Transaction', 'Can reverse transactions', 'transaction'),
  ('commission.lock', 'Lock Commission', 'Can lock commissions', 'transaction'),
  ('commission.unlock', 'Unlock Commission', 'Can unlock commissions', 'transaction'),
  ('settings.mdr', 'Manage MDR', 'Can manage MDR rates', 'settings'),
  ('settings.limits', 'Manage Limits', 'Can manage transaction limits', 'settings'),
  ('settings.charges', 'Manage Charges', 'Can manage charge slabs', 'settings'),
  ('reports.view', 'View Reports', 'Can view all reports', 'reports'),
  ('reports.export', 'Export Reports', 'Can export reports', 'reports')
ON CONFLICT (permission_key) DO NOTHING;

-- Create admin_role_permissions mapping table
CREATE TABLE IF NOT EXISTS admin_role_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_role TEXT NOT NULL,
  permission_key TEXT NOT NULL REFERENCES admin_permissions(permission_key),
  is_granted BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(admin_role, permission_key)
);

-- Master admin gets all permissions
INSERT INTO admin_role_permissions (admin_role, permission_key, is_granted)
SELECT 'master_admin', permission_key, TRUE
FROM admin_permissions
ON CONFLICT (admin_role, permission_key) DO NOTHING;

-- Standard admin gets most permissions (except sensitive ones)
INSERT INTO admin_role_permissions (admin_role, permission_key, is_granted)
SELECT 'admin', permission_key, 
  CASE 
    WHEN permission_key IN ('user.delete', 'settings.mdr') THEN FALSE
    ELSE TRUE
  END
FROM admin_permissions
ON CONFLICT (admin_role, permission_key) DO NOTHING;

-- Support role - limited permissions
INSERT INTO admin_role_permissions (admin_role, permission_key, is_granted)
SELECT 'support', permission_key,
  CASE
    WHEN permission_key IN ('transaction.view', 'reports.view', 'user.view') THEN TRUE
    ELSE FALSE
  END
FROM admin_permissions
ON CONFLICT (admin_role, permission_key) DO NOTHING;

-- Finance role - financial operations
INSERT INTO admin_role_permissions (admin_role, permission_key, is_granted)
SELECT 'finance', permission_key,
  CASE
    WHEN permission_key IN ('wallet.push', 'wallet.pull', 'wallet.settlement_hold', 'wallet.settlement_release', 
                            'transaction.view', 'transaction.reverse', 'reports.view', 'reports.export') THEN TRUE
    ELSE FALSE
  END
FROM admin_permissions
ON CONFLICT (admin_role, permission_key) DO NOTHING;

-- Operations role - operational permissions
INSERT INTO admin_role_permissions (admin_role, permission_key, is_granted)
SELECT 'operations', permission_key,
  CASE
    WHEN permission_key IN ('user.create', 'user.edit', 'user.activate', 'user.deactivate',
                            'wallet.freeze', 'wallet.unfreeze', 'transaction.view', 'reports.view') THEN TRUE
    ELSE FALSE
  END
FROM admin_permissions
ON CONFLICT (admin_role, permission_key) DO NOTHING;

-- Function to check if admin has permission
CREATE OR REPLACE FUNCTION check_admin_permission(
  p_admin_id UUID,
  p_permission_key TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_admin_role TEXT;
  v_is_master BOOLEAN;
  v_has_permission BOOLEAN;
BEGIN
  -- Get admin role
  SELECT admin_role, (admin_role = 'master_admin') INTO v_admin_role, v_is_master
  FROM admin_users
  WHERE id = p_admin_id AND is_active = TRUE;
  
  -- Master admin has all permissions
  IF v_is_master THEN
    RETURN TRUE;
  END IF;
  
  -- Check role-based permission
  SELECT is_granted INTO v_has_permission
  FROM admin_role_permissions
  WHERE admin_role = v_admin_role
    AND permission_key = p_permission_key;
  
  -- Also check custom permissions in admin_users.permissions JSONB
  IF v_has_permission IS NULL THEN
    SELECT (permissions->>p_permission_key)::boolean INTO v_has_permission
    FROM admin_users
    WHERE id = p_admin_id;
  END IF;
  
  RETURN COALESCE(v_has_permission, FALSE);
END;
$$ LANGUAGE plpgsql;

