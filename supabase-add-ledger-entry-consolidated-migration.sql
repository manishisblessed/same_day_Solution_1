-- ============================================================================
-- CONSOLIDATED add_ledger_entry() — race-proof + duplicate-proof + correct column
-- ============================================================================
-- Background: two prior migrations diverged and left the deployed function
-- weaker than intended:
--   * supabase-ledger-dedup-migration.sql          -> had the in-function
--     duplicate-credit check BUT inserted into the WRONG column
--     ("balance_after_old", which does not exist) -> every debit errored.
--   * supabase-fix-add-ledger-entry-balance-after-migration.sql -> fixed the
--     column to "balance_after" BUT dropped the in-function duplicate check,
--     leaving duplicate-credit protection dependent solely on the unique index.
--
-- This migration is the single source of truth. It combines every safeguard,
-- matching the robustness of debit_partner_wallet():
--   1. Idempotency: reject a second entry with the same (reference_id, user).
--   2. Row lock: SELECT ... FOR UPDATE serializes concurrent debits.
--   3. Overdraw guard: never let a debit drive the balance below zero.
--   4. Correct column: writes the closing balance to "balance_after".
--   5. Hardened search_path for the SECURITY DEFINER function.
--
-- Idempotent + safe to re-run. Signature is byte-for-byte identical to the
-- deployed function so existing GRANTs (service_role) remain valid.
-- ============================================================================

-- Final safety net at the storage layer: no two ledger rows may share the same
-- (reference_id, retailer_id). Makes duplicate credits impossible even if a
-- future code path forgets the in-function check. (No-op if already present.)
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_ledger_reference_id_user_unique
  ON wallet_ledger (reference_id, retailer_id)
  WHERE reference_id IS NOT NULL;

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
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_wallet_id UUID;
  v_opening_balance DECIMAL(12, 2);
  v_closing_balance DECIMAL(12, 2);
  v_ledger_id UUID;
  v_existing_id UUID;
BEGIN
  -- (1) Idempotency: reject duplicate reference_id for the same user up front,
  -- so retries return a clean error instead of a raw unique-violation.
  IF p_reference_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM wallet_ledger
    WHERE reference_id = p_reference_id AND retailer_id = p_user_id
    LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      RAISE EXCEPTION 'Duplicate entry: reference_id "%" already exists for user "%"', p_reference_id, p_user_id;
    END IF;
  END IF;

  SELECT ensure_wallet(p_user_id, p_user_role, p_wallet_type) INTO v_wallet_id;

  -- (2) Lock the wallet row so concurrent debits serialize on it.
  SELECT balance INTO v_opening_balance
  FROM wallets
  WHERE user_id = p_user_id AND wallet_type = p_wallet_type
  FOR UPDATE;

  v_closing_balance := v_opening_balance + p_credit - p_debit;

  -- (3) Never allow a debit to overdraw the wallet.
  IF p_debit > 0 AND v_closing_balance < 0 THEN
    RAISE EXCEPTION 'Insufficient balance. Available: %, Required: %', v_opening_balance, p_debit;
  END IF;

  -- (4) Insert into the REAL closing-balance column ("balance_after").
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

-- Keep execution restricted to the server (service_role) only.
REVOKE ALL ON FUNCTION public.add_ledger_entry(text, text, text, text, text, text, numeric, numeric, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_ledger_entry(text, text, text, text, text, text, numeric, numeric, text, uuid, text, text) TO service_role;
