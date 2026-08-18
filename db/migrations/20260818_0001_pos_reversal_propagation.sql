-- POS Reversal Propagation Migration
--
-- Purpose: stop silently deleting voided/reversed POS transactions and instead
-- retain them with a terminal status, so the Partner API and dashboard stay in
-- sync and every reversal can be propagated to partners.
--
-- Changes:
--   1. Add reversed_at / reversal_reason to razorpay_pos_transactions & pos_transactions
--   2. Widen the display_status CHECK to allow VOIDED / REFUNDED / CANCELLED
--   3. Add an outbound partner webhook delivery audit log
--
-- Safe to re-run (idempotent).

-- 1a. razorpay_pos_transactions: reversal tracking columns
ALTER TABLE razorpay_pos_transactions
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

-- 1b. pos_transactions: reversal tracking columns (Express webhook path)
ALTER TABLE pos_transactions
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

-- 2. Allow terminal reversal states in display_status.
--    Original constraint only permitted ('SUCCESS','FAILED','PENDING'), which is
--    why voided rows could never be stored and were deleted instead.
ALTER TABLE razorpay_pos_transactions
  DROP CONSTRAINT IF EXISTS razorpay_pos_transactions_display_status_check;
ALTER TABLE razorpay_pos_transactions
  ADD CONSTRAINT razorpay_pos_transactions_display_status_check
  CHECK (display_status IN ('SUCCESS', 'FAILED', 'PENDING', 'VOIDED', 'REFUNDED', 'CANCELLED'));

CREATE INDEX IF NOT EXISTS idx_rpt_reversed_at
  ON razorpay_pos_transactions(reversed_at)
  WHERE reversed_at IS NOT NULL;

-- 3. Outbound partner webhook delivery audit log.
--    One row per delivery attempt-set (delivery_id is stable across retries),
--    so we can prove a reversal notification was sent to a partner.
CREATE TABLE IF NOT EXISTS partner_webhook_deliveries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id  UUID NOT NULL,
  partner_id   UUID,
  txn_id       TEXT,
  event        TEXT NOT NULL,
  webhook_url  TEXT,
  status_code  INTEGER,
  success      BOOLEAN NOT NULL DEFAULT FALSE,
  attempts     INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  payload      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pwd_txn ON partner_webhook_deliveries(txn_id);
CREATE INDEX IF NOT EXISTS idx_pwd_partner ON partner_webhook_deliveries(partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pwd_event ON partner_webhook_deliveries(event, created_at DESC);

COMMENT ON TABLE partner_webhook_deliveries IS 'Audit log of outbound POS webhook deliveries to partners (pos.transaction, pos.transaction.reversed).';
COMMENT ON COLUMN razorpay_pos_transactions.reversed_at IS 'When a previously-successful POS txn was voided/reversed/refunded upstream.';
COMMENT ON COLUMN razorpay_pos_transactions.reversal_reason IS 'Why the txn was reversed (provider status/type that triggered the terminal state).';
