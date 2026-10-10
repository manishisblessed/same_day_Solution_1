-- ============================================================================
-- Pay2New partner webhook REACH fix.
--
-- WHY: a prior migration added 'pay2new' to the ALLOWED event categories but
-- never added it to any existing partner_webhooks.events array. The multi-URL
-- backfill created rows with events = {pos,settlement,payout}. Result:
-- resolvePartnerEndpoints(..., 'pay2new') returns ZERO endpoints for every
-- already-onboarded partner, so the pay2new.cc.status callback is silently
-- never delivered — partners "don't receive the actual response".
--
-- WHAT: add 'pay2new' to every ACTIVE endpoint that already receives the primary
-- 'pos' channel (that is the partner's main integration endpoint — the same URL
-- where they expect all their event callbacks). Idempotent: only touches rows
-- that carry 'pos' and do NOT already carry 'pay2new'.
--
-- Also create a dedicated pay2new subscription from the legacy single-URL column
-- for any active partner that has a webhook_url but somehow has NO endpoint
-- carrying 'pos' (edge case), so no BBPS-2 partner is left unreachable.
--
-- Idempotent. Safe to re-run. Run in Supabase SQL Editor.
-- ============================================================================

-- 0) Make this migration self-sufficient: ensure 'pay2new' is an allowed event
--    category before we append it (no-op if the idempotency migration already
--    did this).
ALTER TABLE partner_webhooks DROP CONSTRAINT IF EXISTS partner_webhooks_events_valid;
ALTER TABLE partner_webhooks ADD CONSTRAINT partner_webhooks_events_valid
  CHECK (events <@ ARRAY['pos','settlement','payout','rechargekit','pay2new']::text[]);

-- 1) Add 'pay2new' to active endpoints that already carry the primary 'pos' channel.
UPDATE partner_webhooks
SET events = array_append(events, 'pay2new'),
    updated_at = NOW()
WHERE is_active = true
  AND 'pos' = ANY(events)
  AND NOT ('pay2new' = ANY(events));

-- 2) Safety net: for active partners whose only webhook config is the legacy
--    partners.webhook_url and who have no endpoint carrying 'pay2new' yet,
--    create one so the pay2new callback has somewhere to go.
INSERT INTO partner_webhooks (partner_id, url, events, label)
SELECT p.id, btrim(p.webhook_url), ARRAY['pay2new']::text[], 'Pay2New (backfill)'
FROM partners p
WHERE p.status = 'active'
  AND p.webhook_url IS NOT NULL
  AND btrim(p.webhook_url) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM partner_webhooks w
    WHERE w.partner_id = p.id
      AND w.is_active = true
      AND 'pay2new' = ANY(w.events)
  );
