-- Migration: Backfill partner_api_keys.permissions from partner service flags
--
-- Authorization is now driven by the partner-level service flag alone (see
-- lib/partner-auth.ts → partnerCanUseApi). This backfill keeps the per-key
-- `permissions` array consistent with each partner's enabled services so the
-- admin UI and any reporting reflect reality. Keys holding "all" are left as-is.
--
-- Idempotent: safe to run multiple times.

WITH flag_map(scope, col) AS (
  VALUES
    ('bbps',        'bbps_enabled'),
    ('bbps2',       'bbps2_pay2new_enabled'),
    ('payout',      'settlement_enabled'),
    ('settlement',  'settlement2_enabled'),
    ('aeps',        'aeps_enabled'),
    ('rechargekit', 'rechargekit_cc_enabled')
)
UPDATE partner_api_keys k
SET permissions = sub.new_perms,
    updated_at = now()
FROM (
  SELECT
    k2.id,
    (
      SELECT jsonb_agg(DISTINCT e)
      FROM jsonb_array_elements(
        -- existing permissions (default to ["read"] if malformed/empty)
        (CASE WHEN jsonb_typeof(k2.permissions::jsonb) = 'array'
              THEN k2.permissions::jsonb
              ELSE '["read"]'::jsonb END)
        -- + scope for every enabled service flag on the partner
        || COALESCE((
             SELECT jsonb_agg(to_jsonb(fm.scope))
             FROM flag_map fm
             WHERE (to_jsonb(p2) ->> fm.col)::boolean IS TRUE
           ), '[]'::jsonb)
        -- always keep read
        || '["read"]'::jsonb
      ) e
    ) AS new_perms
  FROM partner_api_keys k2
  JOIN partners p2 ON p2.id = k2.partner_id
  WHERE k2.is_active = true
    AND NOT (k2.permissions::jsonb @> '"all"')
) sub
WHERE k.id = sub.id
  AND k.permissions::jsonb <> sub.new_perms;
