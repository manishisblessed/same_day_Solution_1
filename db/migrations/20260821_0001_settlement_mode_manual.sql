-- Manual settlement support for POS T+1.
--
-- While a retailer's T+1 is PAUSED, their daily settlement is paid out MANUALLY
-- (outside the auto pipeline). To make those payouts auditable and, crucially, to
-- guarantee they can never be auto-settled a second time, we:
--   1) extend the settlement_mode CHECK to allow 'MANUAL', and
--   2) add audit columns recording who/when/why a txn was manually settled.
--
-- Any non-null settlement_mode already excludes a row from the T+1 auto-settle
-- query (see lib/settlement/pos-t1-core.ts -> `.is('settlement_mode', null)`),
-- so stamping 'MANUAL' is a hard, permanent double-credit guard.

ALTER TABLE razorpay_pos_transactions
  DROP CONSTRAINT IF EXISTS razorpay_pos_transactions_settlement_mode_check;

ALTER TABLE razorpay_pos_transactions
  ADD CONSTRAINT razorpay_pos_transactions_settlement_mode_check
  CHECK (settlement_mode IN ('INSTACASH', 'AUTO_T1', 'MANUAL'));

ALTER TABLE razorpay_pos_transactions
  ADD COLUMN IF NOT EXISTS manual_settled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manual_settled_by TEXT,
  ADD COLUMN IF NOT EXISTS manual_settlement_note TEXT;

COMMENT ON COLUMN razorpay_pos_transactions.settlement_mode IS
  'How this transaction was settled: INSTACASH/Pulse Pay (T+0 instant), AUTO_T1 (next-day automatic), or MANUAL (paid by hand while T+1 was paused). Any non-null value excludes the row from T+1 auto-settlement.';
