-- Pine Labs settlement verification + reconciliation support
--
-- Context: Pine Labs' summary API reports txnStatus=SUCCESS at terminal
-- authorization. The final status (e.g. FAILED at batch close) can arrive hours
-- to ~14 days later. The reconciliation job (lib/pinelab/reconcile.ts) re-checks
-- each captured txn against the live API and records the outcome here so
-- settlement can require positive confirmation before paying out.
--
-- Additive + idempotent. Safe to run on live data.

ALTER TABLE razorpay_pos_transactions
  ADD COLUMN IF NOT EXISTS pinelab_settlement_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS settlement_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_reconciled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_rpt_settlement_verified
  ON razorpay_pos_transactions(pinelab_settlement_verified);

CREATE INDEX IF NOT EXISTS idx_rpt_reversed_captured
  ON razorpay_pos_transactions(reversed_at)
  WHERE reversed_at IS NOT NULL;

COMMENT ON COLUMN razorpay_pos_transactions.pinelab_settlement_verified IS 'True once Pine Labs reconciliation confirmed this txn settled (batch CLOSED + settlementDate + txnStatus SUCCESS). Safe-payout gate.';
COMMENT ON COLUMN razorpay_pos_transactions.settlement_verified_at IS 'When reconciliation confirmed settlement.';
COMMENT ON COLUMN razorpay_pos_transactions.last_reconciled_at IS 'Last time the Pine Labs reconciliation job checked this txn against the live API.';
