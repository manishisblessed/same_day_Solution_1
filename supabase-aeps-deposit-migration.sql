-- ============================================================================
-- AEPS CASH DEPOSIT MIGRATION
-- ============================================================================
-- Run this migration on existing databases to enable cash_deposit support.
-- Safe to run multiple times (idempotent).
-- ============================================================================

-- 1. Fix CHECK constraint on aeps_transactions to allow cash_deposit
-- Drop old constraint and recreate with cash_deposit included
DO $$
BEGIN
  -- Drop the old CHECK constraint on transaction_type
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name IN (
      SELECT constraint_name FROM information_schema.constraint_column_usage
      WHERE table_name = 'aeps_transactions' AND column_name = 'transaction_type'
    )
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE aeps_transactions DROP CONSTRAINT ' || constraint_name
      FROM information_schema.constraint_column_usage
      WHERE table_name = 'aeps_transactions' AND column_name = 'transaction_type'
      LIMIT 1
    );
  END IF;

  -- Add the new CHECK constraint with cash_deposit included
  ALTER TABLE aeps_transactions
    ADD CONSTRAINT aeps_transactions_transaction_type_check
    CHECK (transaction_type IN (
      'balance_inquiry', 'cash_withdrawal', 'cash_deposit',
      'mini_statement', 'aadhaar_to_aadhaar'
    ));
END $$;

-- 2. Add wallet_credited and wallet_credit_id columns if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'aeps_transactions' AND column_name = 'wallet_credited'
  ) THEN
    ALTER TABLE aeps_transactions ADD COLUMN wallet_credited BOOLEAN DEFAULT FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'aeps_transactions' AND column_name = 'wallet_credit_id'
  ) THEN
    ALTER TABLE aeps_transactions ADD COLUMN wallet_credit_id TEXT;
  END IF;
END $$;

-- 3. Add merchant_id column if missing (needed by transact route)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'aeps_transactions' AND column_name = 'merchant_id'
  ) THEN
    ALTER TABLE aeps_transactions ADD COLUMN merchant_id TEXT;
  END IF;
END $$;

-- 4. Add bank_name column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'aeps_transactions' AND column_name = 'bank_name'
  ) THEN
    ALTER TABLE aeps_transactions ADD COLUMN bank_name TEXT;
  END IF;
END $$;

-- 5. Add account_number_masked column if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'aeps_transactions' AND column_name = 'account_number_masked'
  ) THEN
    ALTER TABLE aeps_transactions ADD COLUMN account_number_masked TEXT;
  END IF;
END $$;

-- 6. Add utr and order_id columns if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'aeps_transactions' AND column_name = 'utr'
  ) THEN
    ALTER TABLE aeps_transactions ADD COLUMN utr TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'aeps_transactions' AND column_name = 'order_id'
  ) THEN
    ALTER TABLE aeps_transactions ADD COLUMN order_id TEXT;
  END IF;
END $$;

-- 7. Add balance_after and mini_statement columns if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'aeps_transactions' AND column_name = 'balance_after'
  ) THEN
    ALTER TABLE aeps_transactions ADD COLUMN balance_after DECIMAL(12, 2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'aeps_transactions' AND column_name = 'mini_statement'
  ) THEN
    ALTER TABLE aeps_transactions ADD COLUMN mini_statement JSONB;
  END IF;
END $$;

-- 8. Add device_fingerprint to aeps_merchants for 2FA device tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'aeps_merchants' AND column_name = 'device_fingerprint'
  ) THEN
    ALTER TABLE aeps_merchants ADD COLUMN device_fingerprint TEXT;
  END IF;
END $$;

-- ============================================================================
-- DONE - All columns and constraints are now compatible with cash_deposit
-- and 2FA device tracking
-- ============================================================================
