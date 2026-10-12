-- ============================================================================
-- Pay2New (BBPS-2) — admin-review flag for held / inconclusive transactions.
--
-- WHY: per the no-financial-loss policy, the direct-user reconciliation cron
-- auto-refunds ONLY on a definitive "FAILED at Pay2New". An inconclusive
-- "no transaction found", or a payment aged past the auto-act window, must NOT
-- be auto-refunded — it is HELD and escalated to an admin who decides manually
-- from the reversals tooling. These columns mark such rows so (a) the cron stops
-- re-checking them and (b) admins can list them.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

ALTER TABLE pay2new_transactions
  ADD COLUMN IF NOT EXISTS review_required BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE pay2new_transactions
  ADD COLUMN IF NOT EXISTS review_reason TEXT;

-- Fast lookup of the admin work queue (held + flagged, still pending).
CREATE INDEX IF NOT EXISTS idx_pay2new_txn_review
  ON pay2new_transactions (review_required, status, created_at)
  WHERE review_required = true;
