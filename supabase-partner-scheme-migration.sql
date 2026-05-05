-- ============================================================================
-- Partner Scheme Assignment Migration
-- Enables scheme_mappings to support entity_role = 'partner'
-- and updates resolve_scheme_for_user to include partner in the hierarchy
-- ============================================================================

-- 1. Drop and recreate the CHECK constraint to include 'partner'
ALTER TABLE scheme_mappings
  DROP CONSTRAINT IF EXISTS scheme_mappings_entity_role_check;

ALTER TABLE scheme_mappings
  ADD CONSTRAINT scheme_mappings_entity_role_check
  CHECK (entity_role IN ('retailer', 'distributor', 'master_distributor', 'partner'));

-- 2. Drop the old 5-parameter signature before creating the updated version
DROP FUNCTION IF EXISTS resolve_scheme_for_user(TEXT, TEXT, TEXT, TEXT, TEXT);

-- 3. Create resolve_scheme_for_user with partner_mapping tier
--    New hierarchy: direct user mapping → partner_mapping → distributor → MD → global
CREATE OR REPLACE FUNCTION resolve_scheme_for_user(
  p_user_id TEXT,
  p_user_role TEXT,
  p_service_type TEXT DEFAULT 'all',
  p_distributor_id TEXT DEFAULT NULL,
  p_md_id TEXT DEFAULT NULL,
  p_partner_entity_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  scheme_id UUID,
  scheme_name TEXT,
  scheme_type TEXT,
  resolved_via TEXT
) AS $$
BEGIN
  -- 1. Check direct user mapping (retailer/distributor/MD/partner matched by entity_role)
  RETURN QUERY
  SELECT sm.scheme_id, s.name, s.scheme_type, 
    CASE p_user_role
      WHEN 'partner' THEN 'partner_mapping'
      ELSE 'retailer_mapping'
    END::TEXT
  FROM scheme_mappings sm
  JOIN schemes s ON s.id = sm.scheme_id
  WHERE sm.entity_id = p_user_id
    AND sm.entity_role = p_user_role
    AND sm.status = 'active'
    AND s.status = 'active'
    AND (sm.service_type IS NULL OR sm.service_type = p_service_type OR sm.service_type = 'all')
    AND sm.effective_from <= NOW()
    AND (sm.effective_to IS NULL OR sm.effective_to > NOW())
    AND s.effective_from <= NOW()
    AND (s.effective_to IS NULL OR s.effective_to > NOW())
  ORDER BY sm.priority ASC, sm.created_at DESC
  LIMIT 1;

  IF FOUND THEN RETURN; END IF;

  -- 2. Check partner-level mapping (if p_partner_entity_id provided and user is not the partner)
  IF p_partner_entity_id IS NOT NULL AND p_user_role != 'partner' THEN
    RETURN QUERY
    SELECT sm.scheme_id, s.name, s.scheme_type, 'partner_mapping'::TEXT
    FROM scheme_mappings sm
    JOIN schemes s ON s.id = sm.scheme_id
    WHERE sm.entity_id = p_partner_entity_id
      AND sm.entity_role = 'partner'
      AND sm.status = 'active'
      AND s.status = 'active'
      AND (sm.service_type IS NULL OR sm.service_type = p_service_type OR sm.service_type = 'all')
      AND sm.effective_from <= NOW()
      AND (sm.effective_to IS NULL OR sm.effective_to > NOW())
    ORDER BY sm.priority ASC, sm.created_at DESC
    LIMIT 1;

    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 3. Check distributor mapping (if distributor_id provided)
  IF p_distributor_id IS NOT NULL THEN
    RETURN QUERY
    SELECT sm.scheme_id, s.name, s.scheme_type, 'distributor_mapping'::TEXT
    FROM scheme_mappings sm
    JOIN schemes s ON s.id = sm.scheme_id
    WHERE sm.entity_id = p_distributor_id
      AND sm.entity_role = 'distributor'
      AND sm.status = 'active'
      AND s.status = 'active'
      AND (sm.service_type IS NULL OR sm.service_type = p_service_type OR sm.service_type = 'all')
      AND sm.effective_from <= NOW()
      AND (sm.effective_to IS NULL OR sm.effective_to > NOW())
    ORDER BY sm.priority ASC, sm.created_at DESC
    LIMIT 1;

    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 4. Check master distributor mapping (if md_id provided)
  IF p_md_id IS NOT NULL THEN
    RETURN QUERY
    SELECT sm.scheme_id, s.name, s.scheme_type, 'md_mapping'::TEXT
    FROM scheme_mappings sm
    JOIN schemes s ON s.id = sm.scheme_id
    WHERE sm.entity_id = p_md_id
      AND sm.entity_role = 'master_distributor'
      AND sm.status = 'active'
      AND s.status = 'active'
      AND (sm.service_type IS NULL OR sm.service_type = p_service_type OR sm.service_type = 'all')
      AND sm.effective_from <= NOW()
      AND (sm.effective_to IS NULL OR sm.effective_to > NOW())
    ORDER BY sm.priority ASC, sm.created_at DESC
    LIMIT 1;

    IF FOUND THEN RETURN; END IF;
  END IF;

  -- 5. Fall back to global scheme
  RETURN QUERY
  SELECT s.id, s.name, s.scheme_type, 'global'::TEXT
  FROM schemes s
  WHERE s.scheme_type = 'global'
    AND s.status = 'active'
    AND (s.service_scope = p_service_type OR s.service_scope = 'all')
    AND s.effective_from <= NOW()
    AND (s.effective_to IS NULL OR s.effective_to > NOW())
  ORDER BY s.priority ASC, s.created_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION resolve_scheme_for_user IS 'Resolves the applicable scheme for a user by checking hierarchy: direct user → partner → distributor → MD → global';
