-- ============================================================================
-- POS multi-tier commission: add Master Distributor (MD) commission leg
-- ============================================================================
-- Brings the POS T+1 auto-settlement in line with the explicit per-tier
-- commission model (NEXTGEN parity):
--
--   * Distributor earns    amount * distributor_mdr%   (its OWN rate)
--   * Master Distributor    amount * md_mdr%            (its OWN rate)
--   * Company keeps         retailer_fee − distributor_comm − md_comm
--
-- Both upline commissions are credited NET of 2% TDS, atomically with the
-- retailer credit. Every ledger insert is guarded by the unique
-- (reference_id, retailer_id) index so a replay can never double-credit.
--
-- Run in Supabase SQL Editor (idempotent).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. MD commission tracking columns
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'md_commission_credited') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN md_commission_credited BOOLEAN NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'md_commission_id') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN md_commission_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'md_commission_gross') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN md_commission_gross NUMERIC(14,4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'md_tds') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN md_tds NUMERIC(14,4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'md_commission_net') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN md_commission_net NUMERIC(14,4);
  END IF;
END $$;

COMMENT ON COLUMN razorpay_pos_transactions.md_commission_gross IS
  'Master Distributor commission before TDS = md_mdr% * gross.';
COMMENT ON COLUMN razorpay_pos_transactions.md_tds IS
  'TDS withheld on the MD commission (default 2%).';
COMMENT ON COLUMN razorpay_pos_transactions.md_commission_net IS
  'MD commission actually credited = gross - TDS.';

-- Never retro-pay MD commission on rows settled before this feature existed.
UPDATE razorpay_pos_transactions
SET md_commission_credited = true
WHERE wallet_credited = true AND md_commission_credited = false;

-- ----------------------------------------------------------------------------
-- 2. Allow the MASTER_DISTRIBUTOR_COMMISSION ledger transaction_type
-- ----------------------------------------------------------------------------
ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_transaction_type_check;
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_transaction_type_check
  CHECK (transaction_type IN (
    'ACCOUNT_VERIFICATION_CHARGE','ACCOUNT_VERIFICATION_REFUND','ADJUSTMENT','ADMIN_CREDIT',
    'AEPS_CREDIT','AEPS_DEBIT','AEPS_SETTLEMENT','BBPS_DEBIT','BBPS_REFUND','COMMISSION_CREDIT',
    'COMPANY_REVENUE','COMPANY_REVENUE_REVERSAL','CREDIT','DEBIT','PAY2NEW_DEBIT','PAY2NEW_REFUND',
    'PAYOUT','POS_CREDIT','POS_RENTAL_COMMISSION','REFUND','REVENUE_REVERSAL','SETTLEMENT2_REFUND',
    'SETTLEMENT2_TRANSFER','SUBSCRIPTION_DEBIT','SUBSCRIPTION_REVENUE','TDS_DEDUCTION','TRANSFER_OUT',
    'RECHARGEKIT_CC_DEBIT','RECHARGEKIT_CC_REFUND','REVENUE_CREDIT','DISTRIBUTOR_COMMISSION',
    'COMMISSION','COMMISSION_REVERSAL',
    -- newly added: per-transaction master-distributor commission on POS settlement
    'MASTER_DISTRIBUTOR_COMMISSION'
  ));

-- ----------------------------------------------------------------------------
-- 3. Atomic per-transaction settlement with DT + MD commission (both TDS-net)
-- ----------------------------------------------------------------------------
-- Supersedes the 16-arg (…, p_distributor_tds) version. Adds the MD leg.
DROP FUNCTION IF EXISTS public.settle_pos_txn_t1(
  UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT, TEXT, NUMERIC
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
  p_distributor_tds NUMERIC DEFAULT NULL,
  -- Master Distributor leg (all optional; MD credit skipped when id is NULL).
  p_master_distributor_id TEXT DEFAULT NULL,
  p_md_mdr NUMERIC DEFAULT 0,
  p_md_commission NUMERIC DEFAULT 0,
  p_md_commission_ref TEXT DEFAULT NULL,
  p_md_tds NUMERIC DEFAULT NULL
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
  v_md_open NUMERIC(14,2);
  v_md_close NUMERIC(14,2);
  v_md_ledger UUID := NULL;
  v_existing UUID;
  v_comm_net NUMERIC(14,2);
  v_tds NUMERIC(14,2);
  v_md_net NUMERIC(14,2);
  v_md_tds NUMERIC(14,2);
  v_tds_rate CONSTANT NUMERIC := 0.02; -- 2% TDS on upline commission
BEGIN
  -- Distributor TDS: default 2% when not supplied; clamp to [0, commission].
  IF p_distributor_tds IS NULL THEN
    v_tds := ROUND(COALESCE(p_distributor_commission, 0) * v_tds_rate, 2);
  ELSE
    v_tds := LEAST(GREATEST(p_distributor_tds, 0), COALESCE(p_distributor_commission, 0));
  END IF;
  v_comm_net := ROUND(COALESCE(p_distributor_commission, 0) - v_tds, 2);

  -- MD TDS: default 2% when not supplied; clamp to [0, commission].
  IF p_md_tds IS NULL THEN
    v_md_tds := ROUND(COALESCE(p_md_commission, 0) * v_tds_rate, 2);
  ELSE
    v_md_tds := LEAST(GREATEST(p_md_tds, 0), COALESCE(p_md_commission, 0));
  END IF;
  v_md_net := ROUND(COALESCE(p_md_commission, 0) - v_md_tds, 2);

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
               to_char(p_distributor_mdr, 'FM990.0000'),
               to_char(p_distributor_commission, 'FM999999990.00'),
               to_char(v_tds, 'FM999999990.00'),
               to_char(v_comm_net, 'FM999999990.00')),
        v_dist_close, NOW()
      ) RETURNING id INTO v_dist_ledger;

      UPDATE wallets SET balance = v_dist_close, updated_at = NOW()
        WHERE user_id = p_distributor_id AND wallet_type = 'primary';
    END IF;
  END IF;

  -- 4. Credit the master-distributor commission NET of TDS (one row per txn).
  IF p_master_distributor_id IS NOT NULL AND v_md_net > 0 AND p_md_commission_ref IS NOT NULL THEN
    SELECT id INTO v_existing FROM wallet_ledger
      WHERE reference_id = p_md_commission_ref AND retailer_id = p_master_distributor_id
      LIMIT 1;

    IF v_existing IS NOT NULL THEN
      v_md_ledger := v_existing;
    ELSE
      PERFORM ensure_wallet(p_master_distributor_id, 'master_distributor', 'primary');
      SELECT balance INTO v_md_open FROM wallets
        WHERE user_id = p_master_distributor_id AND wallet_type = 'primary' FOR UPDATE;
      v_md_open := COALESCE(v_md_open, 0);
      v_md_close := v_md_open + v_md_net;

      INSERT INTO wallet_ledger (
        retailer_id, user_role, wallet_type, fund_category, service_type,
        transaction_type, transaction_id, amount, credit, debit,
        opening_balance, closing_balance, reference_id, status, description,
        balance_after, created_at
      ) VALUES (
        p_master_distributor_id, 'master_distributor', 'primary', 'online', 'pos_commission',
        'MASTER_DISTRIBUTOR_COMMISSION', NULL, v_md_net, v_md_net, 0,
        v_md_open, v_md_close, p_md_commission_ref, 'completed',
        format('POS MD Commission - TID %s, Retailer: %s, Gross: %s, Rate: %s%%, Commission: %s, TDS: %s, Net: %s',
               COALESCE(p_tid, 'N/A'),
               COALESCE(p_retailer_name, p_retailer_id),
               to_char(p_gross, 'FM999999990.00'),
               to_char(p_md_mdr, 'FM990.0000'),
               to_char(p_md_commission, 'FM999999990.00'),
               to_char(v_md_tds, 'FM999999990.00'),
               to_char(v_md_net, 'FM999999990.00')),
        v_md_close, NOW()
      ) RETURNING id INTO v_md_ledger;

      UPDATE wallets SET balance = v_md_close, updated_at = NOW()
        WHERE user_id = p_master_distributor_id AND wallet_type = 'primary';
    END IF;
  END IF;

  -- 5. Mark the transaction settled (atomic with the credits above).
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
    md_commission_credited = (v_md_ledger IS NOT NULL),
    md_commission_id = v_md_ledger,
    md_commission_gross = p_md_commission,
    md_tds = v_md_tds,
    md_commission_net = v_md_net,
    auto_settled_at = NOW()
  WHERE id = p_txn_id;

  RETURN v_ret_ledger;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 6. `transactions` table (Razorpay MDR webhook / T+0 path): MD tracking cols
-- ----------------------------------------------------------------------------
-- processSettlement() credits the retailer, distributor and now the master
-- distributor from this table. These columns let it persist the MD leg and stay
-- idempotent (md_wallet_credited guards against a double credit on retry).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'transactions' AND column_name = 'master_distributor_id') THEN
    ALTER TABLE transactions ADD COLUMN master_distributor_id TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'transactions' AND column_name = 'md_mdr_used') THEN
    ALTER TABLE transactions ADD COLUMN md_mdr_used NUMERIC(14,4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'transactions' AND column_name = 'md_fee') THEN
    ALTER TABLE transactions ADD COLUMN md_fee NUMERIC(14,4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'transactions' AND column_name = 'md_commission') THEN
    ALTER TABLE transactions ADD COLUMN md_commission NUMERIC(14,4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'transactions' AND column_name = 'md_wallet_credited') THEN
    ALTER TABLE transactions ADD COLUMN md_wallet_credited BOOLEAN NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'transactions' AND column_name = 'md_wallet_credit_id') THEN
    ALTER TABLE transactions ADD COLUMN md_wallet_credit_id UUID;
  END IF;
END $$;
