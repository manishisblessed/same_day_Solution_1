-- ============================================================================
-- Retailer T+1 start date + per-transaction distributor commission
-- ============================================================================
-- Adds two capabilities to the retailer POS T+1 auto-settlement:
--
--  1. retailers.t1_settlement_start_at
--     When T+1 is first enabled for a retailer, only transactions captured
--     on/after this timestamp are ever auto-settled. Prevents paying out a
--     whole month's historical backlog in one run when settlement is switched
--     on. NULL = no restriction (legacy retailers keep working as before).
--
--  2. Per-transaction settlement + distributor commission
--     Each POS transaction is now settled as its OWN ledger row (not a combined
--     batch), and the distributor earns a commission on every transaction equal
--     to (retailer_mdr - distributor_mdr) * gross. Retailer credit and
--     distributor commission are written ATOMICALLY by settle_pos_txn_t1() so a
--     crash can never leave one without the other, and the existing unique index
--     on (reference_id, retailer_id) guarantees no double credit.
--
-- Run in Supabase SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schema changes
-- ----------------------------------------------------------------------------

-- Retailer settlement start date (mirrors partners.t1_settlement_start_at)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'retailers' AND column_name = 't1_settlement_start_at') THEN
    ALTER TABLE retailers ADD COLUMN t1_settlement_start_at TIMESTAMPTZ;
  END IF;
END $$;

COMMENT ON COLUMN retailers.t1_settlement_start_at IS
  'Only POS transactions captured on/after this timestamp are auto-settled (T+1). NULL = no restriction. Set when T+1 is first enabled to avoid paying out historical backlog.';

-- Per-transaction distributor commission tracking on the POS transactions table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'distributor_commission_credited') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN distributor_commission_credited BOOLEAN NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'distributor_commission_id') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN distributor_commission_id UUID;
  END IF;

  -- Rows excluded from T+1 because they predate the retailer's settlement start
  -- date. Marking them keeps the cron queue self-cleaning (they never match the
  -- "eligible" filter again) without abusing settlement_mode (which has a CHECK).
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 't1_excluded_pre_start') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN t1_excluded_pre_start BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

COMMENT ON COLUMN razorpay_pos_transactions.distributor_commission_credited IS
  'True once the per-transaction distributor commission ledger entry has been written.';
COMMENT ON COLUMN razorpay_pos_transactions.distributor_commission_id IS
  'wallet_ledger id of the distributor commission credit for this transaction.';
COMMENT ON COLUMN razorpay_pos_transactions.t1_excluded_pre_start IS
  'True if this transaction is permanently excluded from T+1 auto-settlement because it predates the retailer''s t1_settlement_start_at.';

-- Never retro-pay commission on transactions that were already settled before
-- this feature existed: mark all currently-settled rows as commission handled.
UPDATE razorpay_pos_transactions
SET distributor_commission_credited = true
WHERE wallet_credited = true AND distributor_commission_credited = false;

-- ----------------------------------------------------------------------------
-- 2. Allow the new ledger transaction_type
-- ----------------------------------------------------------------------------
ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_transaction_type_check;
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_transaction_type_check
  CHECK (transaction_type IN (
    'ACCOUNT_VERIFICATION_CHARGE','ACCOUNT_VERIFICATION_REFUND','ADJUSTMENT','ADMIN_CREDIT',
    'AEPS_CREDIT','AEPS_DEBIT','AEPS_SETTLEMENT','BBPS_DEBIT','BBPS_REFUND','COMMISSION_CREDIT',
    'COMPANY_REVENUE','COMPANY_REVENUE_REVERSAL','CREDIT','DEBIT','PAY2NEW_DEBIT','PAY2NEW_REFUND',
    'PAYOUT','POS_CREDIT','POS_RENTAL_COMMISSION','REFUND','REVENUE_REVERSAL','SETTLEMENT2_REFUND',
    'SETTLEMENT2_TRANSFER','SUBSCRIPTION_DEBIT','SUBSCRIPTION_REVENUE','TDS_DEDUCTION','TRANSFER_OUT',
    'RECHARGEKIT_CC_DEBIT','RECHARGEKIT_CC_REFUND','REVENUE_CREDIT',
    -- newly added: per-transaction distributor commission on POS settlement
    'DISTRIBUTOR_COMMISSION'
  ));

-- ----------------------------------------------------------------------------
-- 3. Atomic per-transaction settlement function
-- ----------------------------------------------------------------------------
-- Credits the retailer AND (optionally) the distributor commission and marks
-- the transaction settled — all in ONE transaction. Idempotent:
--   * A row-level lock on the transaction (FOR UPDATE) + a re-check of
--     wallet_credited serialises concurrent runs; a second run is a no-op.
--   * Each ledger insert is guarded by the unique (reference_id, retailer_id)
--     index, so the same reference can never be credited twice.
-- Returns the retailer credit's wallet_ledger id.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_pos_txn_t1(
  p_txn_id UUID,
  p_retailer_id TEXT,
  p_gross NUMERIC,
  p_retailer_mdr NUMERIC,
  p_retailer_fee NUMERIC,
  p_retailer_net NUMERIC,
  p_scheme_id TEXT,
  p_scheme_type TEXT,
  p_distributor_id TEXT,
  p_distributor_mdr NUMERIC,
  p_distributor_commission NUMERIC,
  p_tid TEXT,
  p_retailer_name TEXT,
  p_retailer_ref TEXT,
  p_commission_ref TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_already BOOLEAN;
  v_existing_credit UUID;
  v_ret_open NUMERIC(14,2);
  v_ret_close NUMERIC(14,2);
  v_ret_ledger UUID;
  v_dist_open NUMERIC(14,2);
  v_dist_close NUMERIC(14,2);
  v_dist_ledger UUID := NULL;
  v_existing UUID;
BEGIN
  -- 1. Lock the transaction; if already settled, return the existing credit id.
  SELECT wallet_credited, wallet_credit_id
    INTO v_already, v_existing_credit
  FROM razorpay_pos_transactions
  WHERE id = p_txn_id
  FOR UPDATE;

  IF v_already IS TRUE THEN
    RETURN v_existing_credit;
  END IF;

  -- 2. Credit the retailer (one ledger row per transaction).
  SELECT id INTO v_existing FROM wallet_ledger
    WHERE reference_id = p_retailer_ref AND retailer_id = p_retailer_id
    LIMIT 1;

  IF v_existing IS NOT NULL THEN
    v_ret_ledger := v_existing;
  ELSE
    PERFORM ensure_wallet(p_retailer_id, 'retailer', 'primary');
    SELECT balance INTO v_ret_open FROM wallets
      WHERE user_id = p_retailer_id AND wallet_type = 'primary' FOR UPDATE;
    v_ret_open := COALESCE(v_ret_open, 0);
    v_ret_close := v_ret_open + p_retailer_net;

    INSERT INTO wallet_ledger (
      retailer_id, user_role, wallet_type, fund_category, service_type,
      transaction_type, transaction_id, amount, credit, debit,
      opening_balance, closing_balance, reference_id, status, description,
      balance_after, created_at
    ) VALUES (
      p_retailer_id, 'retailer', 'primary', 'online', 'pos',
      'POS_CREDIT', NULL, p_retailer_net, p_retailer_net, 0,
      v_ret_open, v_ret_close, p_retailer_ref, 'completed',
      format('T+1 Auto Settlement - TID %s, Gross: %s, MDR: %s, Net: %s',
             COALESCE(p_tid, 'N/A'),
             to_char(p_gross, 'FM999999990.00'),
             to_char(p_retailer_fee, 'FM999999990.00'),
             to_char(p_retailer_net, 'FM999999990.00')),
      v_ret_close, NOW()
    ) RETURNING id INTO v_ret_ledger;

    UPDATE wallets SET balance = v_ret_close, updated_at = NOW()
      WHERE user_id = p_retailer_id AND wallet_type = 'primary';
  END IF;

  -- 3. Credit the distributor commission (optional, one ledger row per txn).
  IF p_distributor_id IS NOT NULL AND p_distributor_commission > 0 THEN
    SELECT id INTO v_existing FROM wallet_ledger
      WHERE reference_id = p_commission_ref AND retailer_id = p_distributor_id
      LIMIT 1;

    IF v_existing IS NOT NULL THEN
      v_dist_ledger := v_existing;
    ELSE
      PERFORM ensure_wallet(p_distributor_id, 'distributor', 'primary');
      SELECT balance INTO v_dist_open FROM wallets
        WHERE user_id = p_distributor_id AND wallet_type = 'primary' FOR UPDATE;
      v_dist_open := COALESCE(v_dist_open, 0);
      v_dist_close := v_dist_open + p_distributor_commission;

      INSERT INTO wallet_ledger (
        retailer_id, user_role, wallet_type, fund_category, service_type,
        transaction_type, transaction_id, amount, credit, debit,
        opening_balance, closing_balance, reference_id, status, description,
        balance_after, created_at
      ) VALUES (
        p_distributor_id, 'distributor', 'primary', 'online', 'pos_commission',
        'DISTRIBUTOR_COMMISSION', NULL, p_distributor_commission, p_distributor_commission, 0,
        v_dist_open, v_dist_close, p_commission_ref, 'completed',
        format('POS Commission - TID %s, Retailer: %s, Gross: %s, Rate: %s%%, Commission: %s',
               COALESCE(p_tid, 'N/A'),
               COALESCE(p_retailer_name, p_retailer_id),
               to_char(p_gross, 'FM999999990.00'),
               to_char(p_retailer_mdr - p_distributor_mdr, 'FM990.0000'),
               to_char(p_distributor_commission, 'FM999999990.00')),
        v_dist_close, NOW()
      ) RETURNING id INTO v_dist_ledger;

      UPDATE wallets SET balance = v_dist_close, updated_at = NOW()
        WHERE user_id = p_distributor_id AND wallet_type = 'primary';
    END IF;
  END IF;

  -- 4. Mark the transaction settled (atomic with the credits above).
  UPDATE razorpay_pos_transactions SET
    wallet_credited = true,
    settlement_mode = 'AUTO_T1',
    wallet_credit_id = v_ret_ledger,
    mdr_rate = p_retailer_mdr,
    mdr_amount = p_retailer_fee,
    net_amount = p_retailer_net,
    mdr_scheme_id = NULLIF(p_scheme_id, '')::uuid,
    mdr_scheme_type = p_scheme_type,
    distributor_commission_credited = (v_dist_ledger IS NOT NULL),
    distributor_commission_id = v_dist_ledger,
    auto_settled_at = NOW()
  WHERE id = p_txn_id;

  RETURN v_ret_ledger;
END;
$function$;
