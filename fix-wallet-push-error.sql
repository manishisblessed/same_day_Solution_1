-- FIX for "column balance_after_old does not exist" error
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)

-- Update the add_ledger_entry function WITHOUT the balance_after_old column
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
BEGIN
  -- Ensure wallet exists
  SELECT ensure_wallet(p_user_id, p_user_role, p_wallet_type) INTO v_wallet_id;
  
  -- Lock wallet row for update
  SELECT balance INTO v_opening_balance
  FROM wallets
  WHERE user_id = p_user_id AND wallet_type = p_wallet_type
  FOR UPDATE;
  
  -- Calculate closing balance
  v_closing_balance := v_opening_balance + p_credit - p_debit;
  
  -- Insert ledger entry (WITHOUT balance_after_old column)
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
    NOW()
  ) RETURNING id INTO v_ledger_id;
  
  -- Update wallet balance
  UPDATE wallets
  SET balance = v_closing_balance, updated_at = NOW()
  WHERE user_id = p_user_id AND wallet_type = p_wallet_type;
  
  RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql;

