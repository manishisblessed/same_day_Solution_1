-- ============================================================================
-- Remove the GLOBAL scheme fallback from resolve_scheme_for_user
-- ============================================================================
-- FINANCIAL SAFETY: previously, a user with no scheme mapping silently fell back
-- to any active `global` scheme (step 5). This let partners/retailers transact on
-- pricing they were never assigned — and, where the global scheme had no slab for
-- a service, the charge resolved to 0 (a free transaction / direct revenue loss).
--
-- New rule: a scheme MUST be explicitly assigned (direct user → partner →
-- distributor → MD mapping). If nothing is mapped, the function returns NO rows,
-- and the calling transaction routes MUST block with SCHEME_NOT_ASSIGNED.
--
-- This preserves the exact 6-parameter signature and hierarchy; only the final
-- global-fallback branch is deleted.
-- ============================================================================

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
  -- 1. Direct user mapping (retailer/distributor/MD/partner matched by entity_role)
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

  -- 2. Partner-level mapping (if p_partner_entity_id provided and user is not the partner)
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

  -- 3. Distributor mapping (if distributor_id provided)
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

  -- 4. Master distributor mapping (if md_id provided)
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

  -- 5. (REMOVED) Global scheme fallback.
  --    No mapping => no scheme. The transaction route must block the request.
  RETURN;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION resolve_scheme_for_user IS 'Resolves the applicable scheme for a user by checking hierarchy: direct user -> partner -> distributor -> MD. Returns NO rows when nothing is explicitly mapped (global fallback intentionally removed for financial safety).';
