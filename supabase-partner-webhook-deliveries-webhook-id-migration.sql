-- ============================================================================
-- Per-endpoint delivery attribution
-- Run in Supabase SQL Editor (AFTER supabase-partner-webhooks-multi-migration.sql)
--
-- Adds partner_webhook_deliveries.webhook_id so the outbound delivery audit log
-- can be filtered by the exact endpoint a callback was sent to. NULL means the
-- delivery predates multi-webhook or used a legacy single-URL fallback.
-- Safe to re-run (idempotent).
-- ============================================================================

ALTER TABLE partner_webhook_deliveries
  ADD COLUMN IF NOT EXISTS webhook_id UUID REFERENCES partner_webhooks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pwd_webhook
  ON partner_webhook_deliveries(webhook_id, created_at DESC)
  WHERE webhook_id IS NOT NULL;

COMMENT ON COLUMN partner_webhook_deliveries.webhook_id IS
  'The partner_webhooks endpoint this delivery targeted. NULL for legacy single-URL / pre-multi-webhook deliveries.';
