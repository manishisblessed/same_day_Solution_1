-- ============================================================================
-- Pay2New (BBPS-2 Credit Card) — idempotency key + status-by-bill-fetch-ref
-- + partner webhook category.
--
-- Context (partner incident): when a `bill/pay` HTTP response is lost in transit
-- the payment can still succeed and charge the customer, while the partner never
-- captures the pay-step reference (request_id / order_id). They are left holding
-- only the bill-fetch reference (bill_fetch_ref). This migration gives us:
--
--   A) A durable `bill_fetch_ref` on every Pay2New debit row so `bill/status`
--      (and recovery) can be keyed on the one reference the partner always holds.
--   C) An idempotency guard: a partner may hold at most ONE payment attempt per
--      (partner_id, bill_fetch_ref). A retry replays the original outcome and can
--      never create a second charge. Enforced atomically by a UNIQUE partial
--      index (race-safe), with an application-level pre-check for clean replay.
--   D) A `pay2new` partner-webhook event category so terminal pay state can be
--      pushed to the partner (self-heals lost responses).
--
-- Idempotent. Safe to re-run. Run in Supabase SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Recovery / idempotency columns on the partner ledger.
--    bill_fetch_ref : the fetch-step order_id the partner passes to bill/pay.
--    client_ref     : optional partner-supplied idempotency key.
-- ----------------------------------------------------------------------------
ALTER TABLE partner_wallet_ledger ADD COLUMN IF NOT EXISTS bill_fetch_ref TEXT;
ALTER TABLE partner_wallet_ledger ADD COLUMN IF NOT EXISTS client_ref TEXT;

COMMENT ON COLUMN partner_wallet_ledger.bill_fetch_ref IS
  'Pay2New bill-fetch reference (fetch-step order_id). The one reference a partner always holds; used to look up / recover a payment after a lost pay response.';
COMMENT ON COLUMN partner_wallet_ledger.client_ref IS
  'Optional partner-supplied idempotency key for a Pay2New bill payment.';

-- ----------------------------------------------------------------------------
-- 2) Idempotency backstop (race-safe): at most ONE Pay2New DEBIT per
--    (partner_id, bill_fetch_ref). A concurrent/retried pay that tries to stamp
--    the same bill_fetch_ref onto a second debit row fails here, so the second
--    attempt is unwound and the original outcome is replayed.
--    Partial so it never touches historical rows (bill_fetch_ref IS NULL) or
--    non-Pay2New / non-debit rows (refunds, corrections, other services).
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pwl_pay2new_debit_bill_fetch_ref
  ON partner_wallet_ledger (partner_id, bill_fetch_ref)
  WHERE service_type = 'pay2new'
    AND transaction_type = 'DEBIT'
    AND bill_fetch_ref IS NOT NULL;

-- Lookup index for the optional client_ref idempotency key.
CREATE INDEX IF NOT EXISTS idx_pwl_pay2new_client_ref
  ON partner_wallet_ledger (partner_id, client_ref)
  WHERE service_type = 'pay2new'
    AND client_ref IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3) Allow the 'pay2new' event category on partner webhook endpoints.
--    (events array already constrained to a known set — extend it.)
-- ----------------------------------------------------------------------------
ALTER TABLE partner_webhooks DROP CONSTRAINT IF EXISTS partner_webhooks_events_valid;
ALTER TABLE partner_webhooks ADD CONSTRAINT partner_webhooks_events_valid
  CHECK (events <@ ARRAY['pos','settlement','payout','rechargekit','pay2new']::text[]);

COMMENT ON COLUMN partner_webhooks.events IS
  'Event categories this endpoint receives: any of pos, settlement, payout, rechargekit, pay2new.';
