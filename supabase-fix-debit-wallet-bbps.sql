-- ============================================================================
-- FIX: debit_wallet_bbps TOCTOU race condition
-- ============================================================================
-- Problem: The original function calls get_wallet_balance() (a plain SELECT)
-- then checks balance >= amount, then inserts. Two concurrent calls can both
-- read the same balance and both succeed, debiting the wallet twice.
--
-- Fix: Acquire a row-level FOR UPDATE lock on the wallets row before reading
-- the balance. This serializes concurrent debits so only one can proceed at
-- a time, preventing double-debit.
-- ============================================================================

CREATE OR REPLACE FUNCTION debit_wallet_bbps(
  p_retailer_id TEXT,
  p_transaction_id UUID,
  p_amount DECIMAL(12, 2),
  p_description TEXT,
  p_reference_id TEXT
)
RETURNS UUID AS $$
DECLARE
  v_balance_before DECIMAL(12, 2);
  v_balance_after DECIMAL(12, 2);
  v_ledger_id UUID;
BEGIN
  -- Idempotency: if already debited for this transaction, return existing ledger ID
  SELECT id INTO v_ledger_id
  FROM wallet_ledger
  WHERE transaction_id = p_transaction_id
    AND transaction_type = 'BBPS_DEBIT'
    AND retailer_id = p_retailer_id
  LIMIT 1;

  IF v_ledger_id IS NOT NULL THEN
    RETURN v_ledger_id;
  END IF;

  -- FOR UPDATE lock: serialize concurrent debits on the same wallet row.
  -- This prevents the TOCTOU race where two transactions read the same
  -- balance and both pass the sufficiency check.
  PERFORM 1
  FROM wallets
  WHERE user_id = p_retailer_id
    AND wallet_type = 'primary'
  FOR UPDATE;

  -- Get current balance (now safe — row is locked)
  v_balance_before := get_wallet_balance(p_retailer_id);

  IF v_balance_before < p_amount THEN
    RAISE EXCEPTION 'Insufficient wallet balance. Required: %, Available: %', p_amount, v_balance_before;
  END IF;

  v_balance_after := v_balance_before - p_amount;

  INSERT INTO wallet_ledger (
    retailer_id,
    transaction_id,
    transaction_type,
    amount,
    balance_after,
    description,
    reference_id
  ) VALUES (
    p_retailer_id,
    p_transaction_id,
    'BBPS_DEBIT',
    -p_amount,
    v_balance_after,
    p_description,
    p_reference_id
  ) RETURNING id INTO v_ledger_id;

  UPDATE bbps_transactions
  SET wallet_debited = TRUE,
      wallet_debit_id = v_ledger_id
  WHERE id = p_transaction_id;

  RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql;
