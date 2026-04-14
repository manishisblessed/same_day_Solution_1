-- ============================================================================
-- 011: Partner Wallet System
--
-- Dedicated wallet for Partner API partners. Payouts debit this wallet
-- directly — no merchant_id required. Partners fund their wallet via
-- admin top-ups or self-deposit.
--
-- Run in Supabase SQL Editor.
-- ============================================================================

-- ============================================================================
-- 1) PARTNER WALLETS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS partner_wallets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  balance DECIMAL(12, 2) NOT NULL DEFAULT 0,
  is_frozen BOOLEAN NOT NULL DEFAULT false,
  freeze_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(partner_id)
);

CREATE INDEX IF NOT EXISTS idx_partner_wallets_partner ON partner_wallets(partner_id);

-- RLS
ALTER TABLE partner_wallets ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'partner_wallets' AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access" ON partner_wallets FOR ALL USING (true);
  END IF;
END $$;

-- Auto-update updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_partner_wallets_updated_at'
  ) THEN
    CREATE TRIGGER update_partner_wallets_updated_at
      BEFORE UPDATE ON partner_wallets
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

COMMENT ON TABLE partner_wallets IS
  'Dedicated wallet balance for Partner API partners. Used for Payout Partner API.';

-- ============================================================================
-- 2) PARTNER WALLET LEDGER TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS partner_wallet_ledger (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('CREDIT', 'DEBIT', 'REFUND', 'ADJUSTMENT')),
  amount DECIMAL(12, 2) NOT NULL,
  credit DECIMAL(12, 2) NOT NULL DEFAULT 0,
  debit DECIMAL(12, 2) NOT NULL DEFAULT 0,
  opening_balance DECIMAL(12, 2) NOT NULL,
  closing_balance DECIMAL(12, 2) NOT NULL,
  reference_id TEXT,
  payout_transaction_id UUID,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_wallet_ledger_partner ON partner_wallet_ledger(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_wallet_ledger_created ON partner_wallet_ledger(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_partner_wallet_ledger_payout ON partner_wallet_ledger(payout_transaction_id) WHERE payout_transaction_id IS NOT NULL;

-- RLS
ALTER TABLE partner_wallet_ledger ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'partner_wallet_ledger' AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access" ON partner_wallet_ledger FOR ALL USING (true);
  END IF;
END $$;

COMMENT ON TABLE partner_wallet_ledger IS
  'Ledger entries for partner wallet: credits, debits, refunds for Payout Partner API.';

-- ============================================================================
-- 3) ADD partner_id TO payout_transactions (for partner wallet payouts)
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payout_transactions' AND column_name = 'partner_id'
  ) THEN
    ALTER TABLE payout_transactions ADD COLUMN partner_id UUID REFERENCES partners(id);
    CREATE INDEX idx_payout_transactions_partner ON payout_transactions(partner_id) WHERE partner_id IS NOT NULL;
  END IF;
END $$;

-- Make retailer_id nullable (partner wallet payouts won't have one)
DO $$
BEGIN
  ALTER TABLE payout_transactions ALTER COLUMN retailer_id DROP NOT NULL;
EXCEPTION
  WHEN others THEN NULL;
END $$;

-- ============================================================================
-- 4) RPC FUNCTIONS
-- ============================================================================

-- Get partner wallet balance
CREATE OR REPLACE FUNCTION get_partner_wallet_balance(p_partner_id UUID)
RETURNS DECIMAL(12, 2) AS $$
BEGIN
  RETURN COALESCE(
    (SELECT balance FROM partner_wallets WHERE partner_id = p_partner_id),
    0
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Ensure partner wallet exists (creates if not)
CREATE OR REPLACE FUNCTION ensure_partner_wallet(p_partner_id UUID)
RETURNS UUID AS $$
DECLARE
  v_wallet_id UUID;
BEGIN
  SELECT id INTO v_wallet_id FROM partner_wallets WHERE partner_id = p_partner_id;
  
  IF v_wallet_id IS NULL THEN
    INSERT INTO partner_wallets (partner_id, balance)
    VALUES (p_partner_id, 0)
    RETURNING id INTO v_wallet_id;
  END IF;
  
  RETURN v_wallet_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Credit partner wallet (admin top-up, self-deposit, etc.)
CREATE OR REPLACE FUNCTION credit_partner_wallet(
  p_partner_id UUID,
  p_amount DECIMAL(12, 2),
  p_description TEXT DEFAULT NULL,
  p_reference_id TEXT DEFAULT NULL,
  p_transaction_type TEXT DEFAULT 'CREDIT'
)
RETURNS UUID AS $$
DECLARE
  v_wallet_id UUID;
  v_opening_balance DECIMAL(12, 2);
  v_closing_balance DECIMAL(12, 2);
  v_ledger_id UUID;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  -- Ensure wallet exists
  v_wallet_id := ensure_partner_wallet(p_partner_id);

  -- Lock the wallet row for update
  SELECT balance INTO v_opening_balance
  FROM partner_wallets
  WHERE partner_id = p_partner_id
  FOR UPDATE;

  v_closing_balance := v_opening_balance + p_amount;

  -- Update wallet balance
  UPDATE partner_wallets
  SET balance = v_closing_balance, updated_at = NOW()
  WHERE partner_id = p_partner_id;

  -- Insert ledger entry
  INSERT INTO partner_wallet_ledger (
    partner_id, transaction_type, amount, credit, debit,
    opening_balance, closing_balance, reference_id, description, status
  ) VALUES (
    p_partner_id, p_transaction_type, p_amount, p_amount, 0,
    v_opening_balance, v_closing_balance, p_reference_id, p_description, 'completed'
  ) RETURNING id INTO v_ledger_id;

  RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Debit partner wallet (payout)
CREATE OR REPLACE FUNCTION debit_partner_wallet(
  p_partner_id UUID,
  p_amount DECIMAL(12, 2),
  p_payout_transaction_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_reference_id TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_opening_balance DECIMAL(12, 2);
  v_closing_balance DECIMAL(12, 2);
  v_ledger_id UUID;
  v_is_frozen BOOLEAN;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  -- Lock the wallet row for update
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

  -- Update wallet balance
  UPDATE partner_wallets
  SET balance = v_closing_balance, updated_at = NOW()
  WHERE partner_id = p_partner_id;

  -- Insert ledger entry
  INSERT INTO partner_wallet_ledger (
    partner_id, transaction_type, amount, credit, debit,
    opening_balance, closing_balance, payout_transaction_id, reference_id, description, status
  ) VALUES (
    p_partner_id, 'DEBIT', p_amount, 0, p_amount,
    v_opening_balance, v_closing_balance, p_payout_transaction_id, p_reference_id, p_description, 'completed'
  ) RETURNING id INTO v_ledger_id;

  RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Refund partner wallet (failed payout)
CREATE OR REPLACE FUNCTION refund_partner_wallet(
  p_partner_id UUID,
  p_amount DECIMAL(12, 2),
  p_payout_transaction_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_reference_id TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_opening_balance DECIMAL(12, 2);
  v_closing_balance DECIMAL(12, 2);
  v_ledger_id UUID;
BEGIN
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  -- Lock the wallet row for update
  SELECT balance INTO v_opening_balance
  FROM partner_wallets
  WHERE partner_id = p_partner_id
  FOR UPDATE;

  IF v_opening_balance IS NULL THEN
    RAISE EXCEPTION 'Partner wallet not found';
  END IF;

  v_closing_balance := v_opening_balance + p_amount;

  -- Update wallet balance
  UPDATE partner_wallets
  SET balance = v_closing_balance, updated_at = NOW()
  WHERE partner_id = p_partner_id;

  -- Insert ledger entry
  INSERT INTO partner_wallet_ledger (
    partner_id, transaction_type, amount, credit, debit,
    opening_balance, closing_balance, payout_transaction_id, reference_id, description, status
  ) VALUES (
    p_partner_id, 'REFUND', p_amount, p_amount, 0,
    v_opening_balance, v_closing_balance, p_payout_transaction_id, p_reference_id, p_description, 'completed'
  ) RETURNING id INTO v_ledger_id;

  RETURN v_ledger_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Freeze/unfreeze partner wallet
CREATE OR REPLACE FUNCTION set_partner_wallet_frozen(
  p_partner_id UUID,
  p_frozen BOOLEAN,
  p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE partner_wallets
  SET is_frozen = p_frozen,
      freeze_reason = CASE WHEN p_frozen THEN p_reason ELSE NULL END,
      updated_at = NOW()
  WHERE partner_id = p_partner_id;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 5) GRANT PERMISSIONS
-- ============================================================================
GRANT EXECUTE ON FUNCTION get_partner_wallet_balance(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION ensure_partner_wallet(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION credit_partner_wallet(UUID, DECIMAL, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION debit_partner_wallet(UUID, DECIMAL, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION refund_partner_wallet(UUID, DECIMAL, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION set_partner_wallet_frozen(UUID, BOOLEAN, TEXT) TO service_role;
