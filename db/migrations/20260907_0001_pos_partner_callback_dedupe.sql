-- ============================================================================
-- POS PARTNER CALLBACK — EXACTLY-ONCE DISPATCH GUARD
-- ============================================================================
-- POS partner callbacks (pos.transaction) were only ever emitted by the
-- real-time provider webhook routes. Pine Labs merchants ingested purely via
-- the polling sync cron therefore never received a forward callback.
--
-- The sync path now emits forward callbacks too. Because the sync re-scans a
-- rolling 48h window every cycle (and both the webhook and the sync can touch
-- the same transaction), we need a persistent, channel-independent guard so a
-- transaction is notified to the partner exactly once. `partner_callback_sent_at`
-- is that guard: set the first time a forward callback is dispatched, checked by
-- both paths before dispatching.
--
-- BACKFILL: every pre-existing row is stamped as "already sent" so the first
-- sync after deploy does NOT replay forward callbacks for historical
-- transactions to partners who already received them in real time. Any backlog
-- that genuinely needs (re)delivery is handled explicitly via the admin replay
-- endpoint / retry cron.
-- ============================================================================

ALTER TABLE razorpay_pos_transactions
  ADD COLUMN IF NOT EXISTS partner_callback_sent_at timestamptz;

-- Fast lookup of transactions still pending a forward callback.
CREATE INDEX IF NOT EXISTS idx_rpt_partner_callback_pending
  ON razorpay_pos_transactions (partner_id)
  WHERE partner_callback_sent_at IS NULL AND display_status = 'SUCCESS';

-- One-time backfill: do not re-notify history.
UPDATE razorpay_pos_transactions
SET partner_callback_sent_at = COALESCE(updated_at, created_at, now())
WHERE partner_callback_sent_at IS NULL;
