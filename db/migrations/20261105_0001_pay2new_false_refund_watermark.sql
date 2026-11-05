-- ============================================================================
-- Pay2New (BBPS-2) — FALSE-REFUND audit watermark.
--
-- WHY: The false-refund discovery cron must become a CONTINUOUS, self-draining
-- audit instead of a one-time brute-force sweep. Previously a refunded debit
-- that was verified CORRECT (vendor really did FAIL / not-find / reverse) got
-- no marker, so it stayed a candidate forever and was re-checked every cycle.
-- With a large backlog the scan could never advance past the newest/oldest few
-- rows, so false refunds buried in the middle were never reached.
--
-- WHAT: Stamp each refunded debit with the last authoritative vendor verdict and
-- WHEN we confirmed it. The discovery cron then skips already-verified rows
-- (re-checking only after a long re-verify window, in case the vendor later
-- flips a terminal status). This makes the audit incremental: each refund is
-- vendor-checked once, promptly, then left alone — O(new refunds) per run.
--
-- Partner ledger only (matches the discovery + standing-recovery crons domain).
-- Idempotent. Safe to re-run.
-- ============================================================================

ALTER TABLE partner_wallet_ledger
  ADD COLUMN IF NOT EXISTS refund_verified_at TIMESTAMPTZ;

ALTER TABLE partner_wallet_ledger
  ADD COLUMN IF NOT EXISTS refund_verified_status TEXT;

-- Candidate scan predicate: pay2new DEBIT rows resolved `failed` (a refunded
-- debit), oldest/newest first. The partial index keeps that scan cheap as the
-- table grows; the refund_verified_at filter is applied at query time.
CREATE INDEX IF NOT EXISTS idx_p2n_pwl_false_refund_scan
  ON partner_wallet_ledger (created_at)
  WHERE service_type = 'pay2new'
    AND transaction_type = 'DEBIT'
    AND status = 'failed';
