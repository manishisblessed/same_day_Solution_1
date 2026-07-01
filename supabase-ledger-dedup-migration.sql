-- ============================================================================
-- WALLET LEDGER: DUPLICATE CREDIT PREVENTION
-- ============================================================================
-- Adds a unique partial index on (reference_id, retailer_id) to make it
-- impossible for any code path to insert two ledger entries with the same
-- reference_id for the same user. Only applies when reference_id IS NOT NULL
-- so normal entries without a reference_id are unaffected.
--
-- Run this ONCE against your Supabase/Postgres database.
-- ============================================================================

-- Partial unique index: prevents duplicate credits at the DB level
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_ledger_reference_id_user_unique
  ON wallet_ledger (reference_id, retailer_id)
  WHERE reference_id IS NOT NULL;

-- ============================================================================
-- Update add_ledger_entry RPC to reject duplicates before inserting
-- ============================================================================

CREATE OR REPLACE FUNCTION add_ledger_entry(
  p_user_id TEXT,
  p_user_role TEXT,
  p_wallet_type TEXT,
  p_fund_category TEXT,
  p_service_type TEXT,
  p_tx_type TEXT,
  p_credit DECIMAL(12, 2) DEFAULT 0,
  p_debit DECIMAL(12, 2) DEFAULT 0,
  p_reference_id TEXT DEFAULT NULL,
  p_transaction_id UUID DEFAULT NULL,
  p_status TEXT DEFAULT 'completed',
  p_remarks TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_wallet_id UUID;
  v_opening_balance DECIMAL(12, 2);
  v_closing_balance DECIMAL(12, 2);
  v_ledger_id UUID;
  v_existing_id UUID;
BEGIN
  -- Idempotency: if reference_id is provided, reject duplicates for the same user
  IF p_reference_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM wallet_ledger
    WHERE reference_id = p_reference_id AND retailer_id = p_user_id
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      RAISE EXCEPTION 'Duplicate entry: reference_id "%" already exists for user "%"', p_reference_id, p_user_id;
    END IF;
  END IF;

  -- Ensure wallet exists
  SELECT ensure_wallet(p_user_id, p_user_role, p_wallet_type) INTO v_wallet_id;
  
  -- Lock wallet row for update
  SELECT balance INTO v_opening_balance
  FROM wallets
  WHERE user_id = p_user_id AND wallet_type = p_wallet_type
  FOR UPDATE;
  
  -- Calculate closing balance
  v_closing_balance := v_opening_balance + p_credit - p_debit;
  
  -- Prevent negative balance on debits
  IF p_debit > 0 AND v_closing_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient balance. Available: %, Required: %', v_opening_balance, p_debit;
  END IF;
  
  -- Insert ledger entry (unique index on reference_id+retailer_id is the final safety net)
  INSERT INTO wallet_ledger (
    retailer_id,
    user_role,
    wallet_type,
    fund_category,
    service_type,
    transaction_type,
    transaction_id,
    amount,
    credit,
    debit,
    opening_balance,
    closing_balance,
    reference_id,
    status,
    description,
    balance_after_old,
    created_at
  ) VALUES (
    p_user_id,
    p_user_role,
    p_wallet_type,
    p_fund_category,
    p_service_type,
    p_tx_type,
    p_transaction_id,
    p_credit - p_debit,
    p_credit,
    p_debit,
    v_opening_balance,
    v_closing_balance,
    p_reference_id,
    p_status,
    p_remarks,
    NULL,
    NOW()
  ) RETURNING id INTO v_ledger_id;
  
  -- Update wallet balance
  UPDATE wallets
  SET balance = v_closing_balance, updated_at = NOW()
  WHERE user_id = p_user_id AND wallet_type = p_wallet_type;
  
  RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql;
