-- ============================================================================
-- WALLET FUNCTIONS MIGRATION
-- ============================================================================
-- Creates credit_wallet_v2 and debit_wallet_v2 wrapper functions
-- ============================================================================

-- Credit wallet function (wrapper around add_ledger_entry)
CREATE OR REPLACE FUNCTION credit_wallet_v2(
  p_user_id TEXT,
  p_user_role TEXT,
  p_wallet_type TEXT,
  p_fund_category TEXT,
  p_service_type TEXT,
  p_amount DECIMAL(12, 2),
  p_credit DECIMAL(12, 2),
  p_transaction_id UUID DEFAULT NULL,
  p_reference_id TEXT DEFAULT NULL,
  p_remarks TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_ledger_id UUID;
BEGIN
  SELECT add_ledger_entry(
    p_user_id,
    p_user_role,
    p_wallet_type,
    p_fund_category,
    p_service_type,
    'CREDIT',
    p_credit,
    0,
    p_reference_id,
    p_transaction_id,
    'completed',
    p_remarks
  ) INTO v_ledger_id;
  
  RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql;

-- Debit wallet function (wrapper around add_ledger_entry)
CREATE OR REPLACE FUNCTION debit_wallet_v2(
  p_user_id TEXT,
  p_user_role TEXT,
  p_wallet_type TEXT,
  p_fund_category TEXT,
  p_service_type TEXT,
  p_amount DECIMAL(12, 2),
  p_debit DECIMAL(12, 2),
  p_transaction_id UUID DEFAULT NULL,
  p_reference_id TEXT DEFAULT NULL,
  p_remarks TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_ledger_id UUID;
BEGIN
  SELECT add_ledger_entry(
    p_user_id,
    p_user_role,
    p_wallet_type,
    p_fund_category,
    p_service_type,
    'DEBIT',
    0,
    p_debit,
    p_reference_id,
    p_transaction_id,
    'completed',
    p_remarks
  ) INTO v_ledger_id;
  
  RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql;

