-- ============================================================================
-- Partner Wallet Ledger: service_type dimension
--
-- Adds a `service_type` column to partner_wallet_ledger so admin/finance can
-- filter the partner ledger by service (payout, pay2new, rechargekit,
-- shadval_settlement, pos, admin, …) — matching the main wallet_ledger.
--
-- Also extends the credit/debit/refund partner-wallet RPCs with an optional
-- p_service_type argument and backfills historical rows from description /
-- reference_id heuristics.
--
-- Idempotent. Run in Supabase SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Column + index
-- ----------------------------------------------------------------------------
ALTER TABLE partner_wallet_ledger ADD COLUMN IF NOT EXISTS service_type TEXT;

CREATE INDEX IF NOT EXISTS idx_partner_wallet_ledger_service
  ON partner_wallet_ledger(service_type);

-- ----------------------------------------------------------------------------
-- 2) Recreate RPCs with p_service_type (dropped first: adding a param changes
--    the function signature, so REPLACE alone would leave an overloaded copy).
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS credit_partner_wallet(UUID, DECIMAL, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION credit_partner_wallet(
  p_partner_id UUID,
  p_amount DECIMAL(12, 2),
  p_description TEXT DEFAULT NULL,
  p_reference_id TEXT DEFAULT NULL,
  p_transaction_type TEXT DEFAULT 'CREDIT',
  p_service_type TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_wallet_id UUID;
  v_opening_balance DECIMAL(12, 2);
  v_closing_balance DECIMAL(12, 2);
  v_ledger_id UUID;
  v_existing_id UUID;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  IF p_reference_id IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM partner_wallet_ledger
    WHERE reference_id = p_reference_id AND partner_id = p_partner_id LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RAISE EXCEPTION 'Duplicate: reference_id "%" already exists for partner', p_reference_id;
    END IF;
  END IF;

  v_wallet_id := ensure_partner_wallet(p_partner_id);

  SELECT balance INTO v_opening_balance
  FROM partner_wallets
  WHERE partner_id = p_partner_id
  FOR UPDATE;

  v_closing_balance := v_opening_balance + p_amount;

  UPDATE partner_wallets
  SET balance = v_closing_balance, updated_at = NOW()
  WHERE partner_id = p_partner_id;

  INSERT INTO partner_wallet_ledger (
    partner_id, transaction_type, amount, credit, debit,
    opening_balance, closing_balance, reference_id, description, status, service_type
  ) VALUES (
    p_partner_id, p_transaction_type, p_amount, p_amount, 0,
    v_opening_balance, v_closing_balance, p_reference_id, p_description, 'completed', p_service_type
  ) RETURNING id INTO v_ledger_id;

  RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS debit_partner_wallet(UUID, DECIMAL, UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION debit_partner_wallet(
  p_partner_id UUID,
  p_amount DECIMAL(12, 2),
  p_payout_transaction_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_reference_id TEXT DEFAULT NULL,
  p_service_type TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_opening_balance DECIMAL(12, 2);
  v_closing_balance DECIMAL(12, 2);
  v_ledger_id UUID;
  v_is_frozen BOOLEAN;
  v_existing_id UUID;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  IF p_reference_id IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM partner_wallet_ledger
    WHERE reference_id = p_reference_id AND partner_id = p_partner_id LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RAISE EXCEPTION 'Duplicate: reference_id "%" already exists for partner', p_reference_id;
    END IF;
  END IF;

  SELECT balance, is_frozen INTO v_opening_balance, v_is_frozen
  FROM partner_wallets
  WHERE partner_id = p_partner_id
  FOR UPDATE;

  IF v_opening_balance IS NULL THEN
    RAISE EXCEPTION 'Partner wallet not found';
  END IF;

  IF v_is_frozen THEN
    RAISE EXCEPTION 'Partner wallet is frozen';
  END IF;

  IF v_opening_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance. Available: %, Required: %', v_opening_balance, p_amount;
  END IF;

  v_closing_balance := v_opening_balance - p_amount;

  UPDATE partner_wallets
  SET balance = v_closing_balance, updated_at = NOW()
  WHERE partner_id = p_partner_id;

  INSERT INTO partner_wallet_ledger (
    partner_id, transaction_type, amount, credit, debit,
    opening_balance, closing_balance, payout_transaction_id, reference_id, description, status, service_type
  ) VALUES (
    p_partner_id, 'DEBIT', p_amount, 0, p_amount,
    v_opening_balance, v_closing_balance, p_payout_transaction_id, p_reference_id, p_description, 'completed', p_service_type
  ) RETURNING id INTO v_ledger_id;

  RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION IF EXISTS refund_partner_wallet(UUID, DECIMAL, UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION refund_partner_wallet(
  p_partner_id UUID,
  p_amount DECIMAL(12, 2),
  p_payout_transaction_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_reference_id TEXT DEFAULT NULL,
  p_service_type TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_opening_balance DECIMAL(12, 2);
  v_closing_balance DECIMAL(12, 2);
  v_ledger_id UUID;
  v_existing_id UUID;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  IF p_reference_id IS NOT NULL THEN
    SELECT id INTO v_existing_id FROM partner_wallet_ledger
    WHERE reference_id = p_reference_id AND partner_id = p_partner_id LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RAISE EXCEPTION 'Duplicate: reference_id "%" already exists for partner', p_reference_id;
    END IF;
  END IF;

  SELECT balance INTO v_opening_balance
  FROM partner_wallets
  WHERE partner_id = p_partner_id
  FOR UPDATE;

  IF v_opening_balance IS NULL THEN
    RAISE EXCEPTION 'Partner wallet not found';
  END IF;

  v_closing_balance := v_opening_balance + p_amount;

  UPDATE partner_wallets
  SET balance = v_closing_balance, updated_at = NOW()
  WHERE partner_id = p_partner_id;

  INSERT INTO partner_wallet_ledger (
    partner_id, transaction_type, amount, credit, debit,
    opening_balance, closing_balance, payout_transaction_id, reference_id, description, status, service_type
  ) VALUES (
    p_partner_id, 'REFUND', p_amount, p_amount, 0,
    v_opening_balance, v_closing_balance, p_payout_transaction_id, p_reference_id, p_description, 'completed', p_service_type
  ) RETURNING id INTO v_ledger_id;

  RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ----------------------------------------------------------------------------
-- 3) Backfill historical rows (best-effort from description / reference_id).
-- ----------------------------------------------------------------------------
UPDATE partner_wallet_ledger SET service_type = CASE
  WHEN reference_id ILIKE 'ADMIN\_%' OR description ILIKE 'Admin %'
    THEN 'admin'
  WHEN reference_id LIKE 'PARTNER-T1-%' OR reference_id LIKE 'PARTNER-INSTANT-%'
       OR description ILIKE '%T+1 Auto Settlement%' OR description ILIKE '%Instant Settlement%'
       OR description ILIKE '%Pulse Pay%'
    THEN 'pos'
  WHEN description ILIKE 'Payout%'
    THEN 'payout'
  WHEN description ILIKE 'CC-2%' OR description ILIKE '%(RechargeKit)%'
    THEN 'rechargekit'
  WHEN description ILIKE 'BBPS-2%'
    THEN 'pay2new'
  WHEN description ILIKE 'Settlement-2%' OR description ILIKE 'Settlement transfer%'
       OR description ILIKE 'Settlement failed%' OR description ILIKE 'Settlement auto-refund%'
       OR description ILIKE 'Account verification%' OR description ILIKE '%Verification service%'
    THEN 'shadval_settlement'
  WHEN description ILIKE 'CC %' OR description ILIKE 'Refund %Card:%'
    THEN 'pay2new'
  ELSE service_type
END
WHERE service_type IS NULL;

-- ----------------------------------------------------------------------------
-- 4) Grant execute on the new signatures.
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION credit_partner_wallet(UUID, DECIMAL, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION debit_partner_wallet(UUID, DECIMAL, UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION refund_partner_wallet(UUID, DECIMAL, UUID, TEXT, TEXT, TEXT) TO service_role;

COMMENT ON COLUMN partner_wallet_ledger.service_type IS
  'Service that produced this entry: payout | pay2new | rechargekit | shadval_settlement | pos | admin | …';
