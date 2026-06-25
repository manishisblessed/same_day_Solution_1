-- ============================================================================
-- Fix add_ledger_entry(): remove reference to non-existent column
-- ============================================================================
-- The deployed add_ledger_entry() INSERTs into "balance_after_old", a column
-- that does NOT exist on wallet_ledger (the real column is "balance_after").
-- Every wallet debit/credit that passes the balance check therefore failed with
--   ERROR 42703: column "balance_after_old" of relation "wallet_ledger" does not exist
-- which surfaced as "Failed to debit wallet" (HTTP 500) across BBPS, Pay2New
-- (Credit Card), Settlement and wallet transfers.
--
-- This recreates the function inserting into the real "balance_after" column
-- (populated with the closing balance). All other behaviour is unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.add_ledger_entry(
  p_user_id text,
  p_user_role text,
  p_wallet_type text,
  p_fund_category text,
  p_service_type text,
  p_tx_type text,
  p_credit numeric DEFAULT 0,
  p_debit numeric DEFAULT 0,
  p_reference_id text DEFAULT NULL::text,
  p_transaction_id uuid DEFAULT NULL::uuid,
  p_status text DEFAULT 'completed'::text,
  p_remarks text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_wallet_id UUID;
  v_opening_balance DECIMAL(12, 2);
  v_closing_balance DECIMAL(12, 2);
  v_ledger_id UUID;
BEGIN
  SELECT ensure_wallet(p_user_id, p_user_role, p_wallet_type) INTO v_wallet_id;

  SELECT balance INTO v_opening_balance
  FROM wallets
  WHERE user_id = p_user_id AND wallet_type = p_wallet_type
  FOR UPDATE;

  v_closing_balance := v_opening_balance + p_credit - p_debit;

  IF p_debit > 0 AND v_closing_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient balance. Available: %, Required: %', v_opening_balance, p_debit;
  END IF;

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
    balance_after,
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
    v_closing_balance,
    NOW()
  )
  RETURNING id INTO v_ledger_id;

  UPDATE wallets
  SET balance = v_closing_balance, updated_at = NOW()
  WHERE user_id = p_user_id AND wallet_type = p_wallet_type;

  RETURN v_ledger_id;
END;
$function$;
