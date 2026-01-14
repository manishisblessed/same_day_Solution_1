-- ============================================================================
-- MULTIPLE DEPARTMENTS FOR SUB-ADMINS MIGRATION
-- ============================================================================
-- Changes department column from single TEXT to TEXT[] array
-- ============================================================================

-- Step 1: Add new departments column as array
DO $$ 
BEGIN
  -- Check if departments column exists (new name for array)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'admin_users' AND column_name = 'departments') THEN
    -- Add new departments array column
    ALTER TABLE admin_users ADD COLUMN departments TEXT[] DEFAULT ARRAY[]::TEXT[];
    
    -- Migrate existing department data to departments array
    UPDATE admin_users 
    SET departments = CASE 
      WHEN department IS NOT NULL THEN ARRAY[department]
      ELSE ARRAY[]::TEXT[]
    END
    WHERE departments IS NULL;
    
    -- Drop the old department column constraint (we'll keep the column for backward compatibility temporarily)
    -- Actually, let's keep both for now - department for single, departments for multiple
  END IF;
END $$;

-- Step 2: Update check_admin_permission function to support multiple departments
CREATE OR REPLACE FUNCTION check_admin_permission(
  p_admin_id UUID,
  p_department TEXT,
  p_action TEXT DEFAULT 'read'
)
RETURNS BOOLEAN AS $$
DECLARE
  v_admin_type TEXT;
  v_department TEXT;
  v_departments TEXT[];
  v_permissions JSONB;
BEGIN
  SELECT admin_type, department, departments, permissions INTO v_admin_type, v_department, v_departments, v_permissions
  FROM admin_users
  WHERE id = p_admin_id AND is_active = TRUE;

  -- Super admins have all permissions
  IF v_admin_type = 'super_admin' THEN
    RETURN TRUE;
  END IF;

  -- Check if sub-admin has access to the department
  -- Check old single department field
  IF v_department = 'all' THEN
    RETURN TRUE;
  END IF;

  -- Check new departments array
  IF v_departments IS NOT NULL AND array_length(v_departments, 1) > 0 THEN
    -- If 'all' is in the array, grant access
    IF 'all' = ANY(v_departments) THEN
      RETURN TRUE;
    END IF;
    -- Check if requested department is in the array
    IF p_department = ANY(v_departments) THEN
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
    END IF;
  END IF;

  -- Fallback to old single department field
  IF v_department = p_department THEN
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
    RETURN TRUE;
  END IF;

  -- Default: deny access
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================

