-- ============================================================================
-- Retailer T+1: 2% TDS on distributor commission + retailer_id self-healing
-- ============================================================================
-- 1. Adds TDS tracking columns to razorpay_pos_transactions and updates
--    settle_pos_txn_t1() so the distributor commission is credited NET of a
--    configurable TDS (2% by default): commission 100 -> credit 98, TDS 2.
--
-- 2. Adds backfill_pos_retailer_ids(): stamps retailer_id / distributor_id on
--    captured POS transactions whose owning device is registered in
--    pos_machines (by tid or serial_number) but where the webhook never wrote
--    retailer_id (it only looked at pos_device_mapping). The retailer T+1 cron
--    calls this first so such transactions become visible to auto-settlement.
--
-- Run in Supabase SQL Editor (idempotent).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TDS tracking columns
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'distributor_commission_gross') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN distributor_commission_gross NUMERIC(14,4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'distributor_tds') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN distributor_tds NUMERIC(14,4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'distributor_commission_net') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN distributor_commission_net NUMERIC(14,4);
  END IF;
END $$;

COMMENT ON COLUMN razorpay_pos_transactions.distributor_commission_gross IS
  'Distributor commission before TDS = (retailer_mdr - distributor_mdr) * gross.';
COMMENT ON COLUMN razorpay_pos_transactions.distributor_tds IS
  'TDS withheld on the distributor commission (default 2%).';
COMMENT ON COLUMN razorpay_pos_transactions.distributor_commission_net IS
  'Distributor commission actually credited = gross - TDS.';
-- Note: DISTRIBUTOR_COMMISSION is already permitted by
-- wallet_ledger_transaction_type_check, so no constraint change is needed here.

-- ----------------------------------------------------------------------------
-- 2. Atomic per-transaction settlement function (now with TDS on commission)
-- ----------------------------------------------------------------------------
-- Drop the previous 15-arg version so the new signature fully replaces it.
DROP FUNCTION IF EXISTS public.settle_pos_txn_t1(
  UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT
);

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
  p_commission_ref TEXT,
  -- NULL => compute the default 2% TDS internally. This makes the 2% deduction
  -- apply even if a caller (e.g. an older deploy) doesn't pass the argument.
  p_distributor_tds NUMERIC DEFAULT NULL
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
  v_comm_net NUMERIC(14,2);
  v_tds NUMERIC(14,2);
  v_tds_rate CONSTANT NUMERIC := 0.02; -- 2% TDS on distributor commission
BEGIN
  -- TDS: if the caller didn't pass one, withhold the default 2%. Otherwise use
  -- the provided amount. Never negative, never more than the commission itself.
  IF p_distributor_tds IS NULL THEN
    v_tds := ROUND(COALESCE(p_distributor_commission, 0) * v_tds_rate, 2);
  ELSE
    v_tds := LEAST(GREATEST(p_distributor_tds, 0), COALESCE(p_distributor_commission, 0));
  END IF;
  v_comm_net := ROUND(COALESCE(p_distributor_commission, 0) - v_tds, 2);

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

  -- 3. Credit the distributor commission NET of TDS (one ledger row per txn).
  IF p_distributor_id IS NOT NULL AND v_comm_net > 0 THEN
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
      v_dist_close := v_dist_open + v_comm_net;

      INSERT INTO wallet_ledger (
        retailer_id, user_role, wallet_type, fund_category, service_type,
        transaction_type, transaction_id, amount, credit, debit,
        opening_balance, closing_balance, reference_id, status, description,
        balance_after, created_at
      ) VALUES (
        p_distributor_id, 'distributor', 'primary', 'online', 'pos_commission',
        'DISTRIBUTOR_COMMISSION', NULL, v_comm_net, v_comm_net, 0,
        v_dist_open, v_dist_close, p_commission_ref, 'completed',
        format('POS Commission - TID %s, Retailer: %s, Gross: %s, Rate: %s%%, Commission: %s, TDS: %s, Net: %s',
               COALESCE(p_tid, 'N/A'),
               COALESCE(p_retailer_name, p_retailer_id),
               to_char(p_gross, 'FM999999990.00'),
               to_char(p_retailer_mdr - p_distributor_mdr, 'FM990.0000'),
               to_char(p_distributor_commission, 'FM999999990.00'),
               to_char(v_tds, 'FM999999990.00'),
               to_char(v_comm_net, 'FM999999990.00')),
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
    distributor_commission_gross = p_distributor_commission,
    distributor_tds = v_tds,
    distributor_commission_net = v_comm_net,
    auto_settled_at = NOW()
  WHERE id = p_txn_id;

  RETURN v_ret_ledger;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3. Self-healing: stamp retailer_id from pos_machines (tid / serial_number)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.backfill_pos_retailer_ids()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_count INTEGER;
BEGIN
  WITH upd AS (
    UPDATE razorpay_pos_transactions t
    SET retailer_id           = m.retailer_id,
        distributor_id        = COALESCE(t.distributor_id, m.distributor_id),
        master_distributor_id = COALESCE(t.master_distributor_id, m.master_distributor_id),
        gross_amount          = COALESCE(t.gross_amount, t.amount)
    FROM pos_machines m
    WHERE t.retailer_id IS NULL
      AND t.wallet_credited = false
      AND t.settlement_mode IS NULL
      AND m.retailer_id IS NOT NULL
      AND (
            (t.tid IS NOT NULL AND t.tid = m.tid)
         OR (t.device_serial IS NOT NULL AND t.device_serial = m.serial_number)
          )
    RETURNING t.id
  )
  SELECT COUNT(*) INTO v_count FROM upd;
  RETURN v_count;
END;
$function$;
