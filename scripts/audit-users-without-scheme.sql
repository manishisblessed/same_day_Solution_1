-- ============================================================================
-- AUDIT: Active users with NO active scheme mapping
-- ============================================================================
-- Run this BEFORE deploying the global-fallback removal
-- (db/migrations/20260929_0001_remove_scheme_global_fallback.sql).
--
-- After that migration, any user without an explicitly assigned (mapped) scheme
-- can no longer transact — the transaction routes return SCHEME_NOT_ASSIGNED.
-- Use this report to find who would be blocked, and assign schemes to them first.
--
-- Mapping keys (must match resolve_scheme_for_user / the app):
--   retailer            -> scheme_mappings.entity_id = retailers.partner_id
--   distributor         -> scheme_mappings.entity_id = distributors.partner_id
--   master_distributor  -> scheme_mappings.entity_id = master_distributors.partner_id
--   partner             -> scheme_mappings.entity_id = partners.id
--
-- "Has scheme" = an active scheme_mapping pointing at an active, in-window scheme.
-- ============================================================================

WITH active_mappings AS (
  SELECT sm.entity_id, sm.entity_role
  FROM scheme_mappings sm
  JOIN schemes s ON s.id = sm.scheme_id
  WHERE sm.status = 'active'
    AND s.status = 'active'
    AND sm.effective_from <= NOW()
    AND (sm.effective_to IS NULL OR sm.effective_to > NOW())
    AND s.effective_from <= NOW()
    AND (s.effective_to IS NULL OR s.effective_to > NOW())
  GROUP BY sm.entity_id, sm.entity_role
)
SELECT 'retailer' AS role, r.partner_id AS entity_id, r.name, r.email, r.status
FROM retailers r
LEFT JOIN active_mappings am
  ON am.entity_id = r.partner_id AND am.entity_role = 'retailer'
WHERE r.status = 'active' AND am.entity_id IS NULL

UNION ALL
SELECT 'distributor' AS role, d.partner_id AS entity_id, d.name, d.email, d.status
FROM distributors d
LEFT JOIN active_mappings am
  ON am.entity_id = d.partner_id AND am.entity_role = 'distributor'
WHERE d.status = 'active' AND am.entity_id IS NULL

UNION ALL
SELECT 'master_distributor' AS role, md.partner_id AS entity_id, md.name, md.email, md.status
FROM master_distributors md
LEFT JOIN active_mappings am
  ON am.entity_id = md.partner_id AND am.entity_role = 'master_distributor'
WHERE md.status = 'active' AND am.entity_id IS NULL

UNION ALL
SELECT 'partner' AS role, p.id AS entity_id, p.name, p.email, p.status
FROM partners p
LEFT JOIN active_mappings am
  ON am.entity_id = p.id AND am.entity_role = 'partner'
WHERE p.status = 'active' AND am.entity_id IS NULL

ORDER BY role, name;
