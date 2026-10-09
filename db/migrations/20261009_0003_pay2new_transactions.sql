-- Dedicated transaction table for BBPS-2 / Pay2New Credit Card payments.
--
-- Until now a Pay2New CC payment left no first-class record: the only trace was
-- a wallet_ledger / partner_wallet_ledger DEBIT row whose description string had
-- the card + mobile + biller baked in. That made the 45-second same-card cooldown
-- rely on fragile ILIKE description parsing, and gave reporting/recovery nothing
-- structured to query.
--
-- This table is the authoritative record of every in-app Pay2New CC payment
-- attempt (retailers and partners). It powers:
--   * the 45-second cooldown (same card + same bank + same registered mobile),
--   * status/recovery lookups, and
--   * per-txn reporting without string-scraping the ledger.
--
-- Money movement still lives in the wallet ledger; this table mirrors the
-- lifecycle (pending -> success | failed | refunded) and links back via
-- request_id (= the ledger reference_id).
--
-- Idempotent. Safe to re-run.

CREATE TABLE IF NOT EXISTS pay2new_transactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT NOT NULL,            -- acting retailer/partner (partner_id)
  user_role             TEXT NOT NULL,            -- 'retailer' | 'partner'
  distributor_id        TEXT,
  master_distributor_id TEXT,

  request_id            TEXT UNIQUE NOT NULL,      -- internal ref (SDS…) = ledger reference_id
  bill_fetch_ref        TEXT,                      -- fetch-step order_id
  order_id              TEXT,                      -- provider pay-step order_id
  operator_reference    TEXT,

  biller_id             TEXT,                      -- set when paid via BBPS fallback/direct
  product_code          TEXT NOT NULL,             -- identifies the bank/biller
  product_name          TEXT,

  card_number           TEXT,                      -- value sent as "number"
  card_last4            TEXT,                      -- optional1 (last 4 of the card)
  customer_number       TEXT,                      -- registered mobile
  customer_name         TEXT,
  pan_number            TEXT,

  amount                NUMERIC(12,2) NOT NULL,
  charge                NUMERIC(12,2) DEFAULT 0,
  total_debit           NUMERIC(12,2) DEFAULT 0,

  scheme_id             UUID,
  scheme_name           TEXT,

  payment_channel       TEXT,                      -- 'pay2new' | 'bbps_direct' | 'bbps_fallback'
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','success','failed','refunded')),
  error_message         TEXT,

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  completed_at          TIMESTAMPTZ
);

-- Cooldown lookup: most recent attempt for this user to the same bank + card +
-- registered mobile. Covers the exact predicate the pay route runs.
CREATE INDEX IF NOT EXISTS idx_pay2new_txn_cooldown
  ON pay2new_transactions (user_id, product_code, customer_number, card_number, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pay2new_txn_user_created
  ON pay2new_transactions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pay2new_txn_status
  ON pay2new_transactions (status);

CREATE INDEX IF NOT EXISTS idx_pay2new_txn_bill_fetch_ref
  ON pay2new_transactions (bill_fetch_ref)
  WHERE bill_fetch_ref IS NOT NULL;

-- Keep updated_at fresh on every write (reuses the shared trigger fn if present).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
    DROP TRIGGER IF EXISTS update_pay2new_transactions_updated_at ON pay2new_transactions;
    CREATE TRIGGER update_pay2new_transactions_updated_at
      BEFORE UPDATE ON pay2new_transactions
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

ALTER TABLE pay2new_transactions ENABLE ROW LEVEL SECURITY;

-- Service-role (server) does all reads/writes; mirror the permissive policy
-- style used by the sibling bbps_transactions table.
DROP POLICY IF EXISTS "service manages pay2new_transactions" ON pay2new_transactions;
CREATE POLICY "service manages pay2new_transactions" ON pay2new_transactions
  FOR ALL USING (true) WITH CHECK (true);
