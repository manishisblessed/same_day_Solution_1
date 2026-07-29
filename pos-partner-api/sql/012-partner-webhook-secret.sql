-- ============================================================================
-- 012 - Partner Webhook Signing Secret
-- Run in Supabase SQL Editor
--
-- Adds a per-partner HMAC-SHA256 signing secret used to sign the OUTBOUND POS
-- transaction callbacks we send to each partner's webhook_url. Backfills a
-- secret for every partner that already has a webhook_url so signed delivery
-- works immediately (existing partners keep receiving callbacks — the only
-- change is a new X-Sameday-Signature header they may verify).
-- ============================================================================

-- pgcrypto (gen_random_bytes) is enabled in 001-partner-api-schema.sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS webhook_secret TEXT;

COMMENT ON COLUMN partners.webhook_secret IS
  'HMAC-SHA256 secret for signing outbound webhook callbacks (X-Sameday-Signature). Prefix: whsec_';

UPDATE partners
SET webhook_secret = 'whsec_' || encode(gen_random_bytes(32), 'hex')
WHERE webhook_secret IS NULL
  AND webhook_url IS NOT NULL
  AND btrim(webhook_url) <> '';
