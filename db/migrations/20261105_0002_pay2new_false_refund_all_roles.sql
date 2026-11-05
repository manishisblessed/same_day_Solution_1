-- ============================================================================
-- Pay2New (BBPS-2) — FALSE-REFUND audit coverage for the IN-APP flow (ALL ROLES).
--
-- WHY: The partner_wallet_ledger watermark (20261105_0001) covers the partner-API
-- flow only. The in-app flow (retailers AND in-app partners) is canonically
-- tracked in pay2new_transactions, and a direct refund marks THAT row refunded
-- without flipping the ledger debit to `failed` — so the ledger-based scan never
-- sees it. These columns extend the SAME continuous, incremental, manual-approval
-- false-refund audit to pay2new_transactions so NO role is left uncovered.
--
-- refund_verified_at / refund_verified_status : last authoritative vendor verdict
--   (incremental watermark — each refund vendor-checked once, then skipped).
-- clawback_state : NULL (not a false refund / not yet judged)
--                | 'awaiting_approval' (vendor SUCCESS confirmed -> needs a human)
--                | 'approved_pending'  (approved, waiting on wallet balance)
--                | 'recovered'         (clawback applied).
-- clawback_approved_by / clawback_order_id / clawback_operator_ref : audit trail.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

ALTER TABLE pay2new_transactions
  ADD COLUMN IF NOT EXISTS refund_verified_at TIMESTAMPTZ;

ALTER TABLE pay2new_transactions
  ADD COLUMN IF NOT EXISTS refund_verified_status TEXT;

ALTER TABLE pay2new_transactions
  ADD COLUMN IF NOT EXISTS clawback_state TEXT;

ALTER TABLE pay2new_transactions
  ADD COLUMN IF NOT EXISTS clawback_approved_by TEXT;

ALTER TABLE pay2new_transactions
  ADD COLUMN IF NOT EXISTS clawback_order_id TEXT;

ALTER TABLE pay2new_transactions
  ADD COLUMN IF NOT EXISTS clawback_operator_ref TEXT;

-- Incremental scan over refunded txns (the discovery candidate set).
CREATE INDEX IF NOT EXISTS idx_p2n_txn_false_refund_scan
  ON pay2new_transactions (created_at)
  WHERE status = 'refunded';

-- Fast load of the Clawback Approval queue + the standing recovery cron.
CREATE INDEX IF NOT EXISTS idx_p2n_txn_clawback_state
  ON pay2new_transactions (clawback_state, created_at)
  WHERE clawback_state IS NOT NULL;
