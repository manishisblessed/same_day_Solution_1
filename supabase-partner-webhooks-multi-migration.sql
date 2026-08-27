-- ============================================================================
-- Multiple Webhook Endpoints per Partner
-- Run in Supabase SQL Editor
--
-- Moves from the single `partners.webhook_url` / `partners.rechargekit_webhook_url`
-- model to a many-per-partner subscription table. Each endpoint has its own URL
-- and its own event subscription, but ALL endpoints of a partner are signed with
-- the SAME shared secret (`partners.webhook_secret`) — one secret/key, many URLs.
--
-- Event categories:
--   'pos'         -> pos.transaction, pos.transaction.reversed
--   'settlement'  -> settlement.success / failed / status_update
--   'payout'      -> payout.*
--   'rechargekit' -> rechargekit.cc.status
--
-- The UI groups (pos, settlement, payout) as the "Events (POS · Settlement ·
-- Payout)" channel and (rechargekit) as the "RechargeKit (Credit Card)" channel.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS partner_webhooks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT '{pos,settlement,payout}',
  label TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Only allow known event categories in the array.
  CONSTRAINT partner_webhooks_events_valid
    CHECK (events <@ ARRAY['pos','settlement','payout','rechargekit']::text[])
);

CREATE INDEX IF NOT EXISTS idx_partner_webhooks_partner
  ON partner_webhooks(partner_id) WHERE is_active;

COMMENT ON TABLE partner_webhooks IS
  'Per-partner webhook endpoints. Many URLs per partner, each with its own event subscription. All signed with the shared partners.webhook_secret.';
COMMENT ON COLUMN partner_webhooks.events IS
  'Event categories this endpoint receives: any of pos, settlement, payout, rechargekit.';

-- Auto-update updated_at (function created in 001-partner-api-schema.sql)
DROP TRIGGER IF EXISTS trg_partner_webhooks_updated_at ON partner_webhooks;
CREATE TRIGGER trg_partner_webhooks_updated_at
  BEFORE UPDATE ON partner_webhooks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS (API server uses the service role key, which bypasses RLS)
ALTER TABLE partner_webhooks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON partner_webhooks;
CREATE POLICY "Service role full access" ON partner_webhooks FOR ALL USING (true);

-- ============================================================================
-- Backfill from the legacy single-URL columns (idempotent).
-- Existing partners keep receiving callbacks with no interruption.
-- ============================================================================
INSERT INTO partner_webhooks (partner_id, url, events, label)
SELECT p.id, btrim(p.webhook_url), ARRAY['pos','settlement','payout']::text[], 'Primary (migrated)'
FROM partners p
WHERE p.webhook_url IS NOT NULL
  AND btrim(p.webhook_url) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM partner_webhooks w
    WHERE w.partner_id = p.id AND w.url = btrim(p.webhook_url)
  );

INSERT INTO partner_webhooks (partner_id, url, events, label)
SELECT p.id, btrim(p.rechargekit_webhook_url), ARRAY['rechargekit']::text[], 'RechargeKit (migrated)'
FROM partners p
WHERE p.rechargekit_webhook_url IS NOT NULL
  AND btrim(p.rechargekit_webhook_url) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM partner_webhooks w
    WHERE w.partner_id = p.id AND w.url = btrim(p.rechargekit_webhook_url)
  );
