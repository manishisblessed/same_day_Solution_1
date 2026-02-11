-- ============================================================================
-- Complete BBPS Wallet Setup Verification
-- Run this in Supabase SQL Editor to verify everything is ready
-- ============================================================================

-- 1. Verify functions exist (you already confirmed this ✅)
SELECT 'Functions Check' as check_type, 
  CASE 
    WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'add_ledger_entry') 
      AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'ensure_wallet')
      AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_wallet_balance_v2')
    THEN '✅ All functions exist'
    ELSE '❌ Missing functions'
  END as status;

-- 2. Check if wallet_ledger table accepts BBPS transaction types
SELECT 'wallet_ledger transaction_type constraint' as check_type,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM information_schema.check_constraints 
      WHERE constraint_name LIKE '%transaction_type%' 
      AND constraint_schema = 'public'
    ) THEN '✅ Constraint exists (check values below)'
    ELSE '⚠️ No constraint found'
  END as status;

-- 3. Check current allowed transaction types in wallet_ledger
SELECT 
  cc.constraint_name,
  cc.check_clause
FROM information_schema.check_constraints cc
WHERE cc.constraint_name LIKE '%transaction_type%'
  AND cc.constraint_schema = 'public';

-- 4. Verify wallets table structure
SELECT 'wallets table columns' as check_type,
  string_agg(column_name, ', ' ORDER BY ordinal_position) as columns
FROM information_schema.columns
WHERE table_name = 'wallets' AND table_schema = 'public';

-- 5. Verify wallet_ledger has required columns
SELECT 'wallet_ledger columns' as check_type,
  string_agg(column_name, ', ' ORDER BY ordinal_position) as columns
FROM information_schema.columns
WHERE table_name = 'wallet_ledger' AND table_schema = 'public';

-- 6. Check if bbps_transactions table has wallet_debited column
SELECT 'bbps_transactions wallet columns' as check_type,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'bbps_transactions' 
      AND column_name = 'wallet_debited'
    ) THEN '✅ wallet_debited column exists'
    ELSE '❌ wallet_debited column missing'
  END as status;

-- ============================================================================
-- IF wallet_ledger transaction_type constraint doesn't include BBPS types,
-- run the SQL below to update it:
-- ============================================================================

-- First, drop the old constraint (if it exists)
-- ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_transaction_type_check;

-- Then add the new constraint with BBPS types
-- ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_transaction_type_check 
--   CHECK (transaction_type IN (
--     'POS_CREDIT', 
--     'PAYOUT', 
--     'REFUND', 
--     'ADJUSTMENT', 
--     'COMMISSION',
--     'BBPS_DEBIT',
--     'BBPS_REFUND'
--   ));

-- ============================================================================
-- Test query: Check if you can insert a test BBPS_DEBIT entry (optional)
-- ============================================================================

-- Uncomment below to test (replace 'TEST_RETAILER_ID' with a real retailer_id)
-- DO $$
-- DECLARE
--   test_ledger_id UUID;
-- BEGIN
--   SELECT add_ledger_entry(
--     'TEST_RETAILER_ID',
--     'retailer',
--     'primary',
--     'bbps',
--     'bbps',
--     'BBPS_DEBIT',
--     0, -- credit
--     100.00, -- debit
--     'TEST_REF_' || NOW()::TEXT,
--     NULL, -- transaction_id
--     'completed',
--     'Test BBPS debit'
--   ) INTO test_ledger_id;
--   
--   RAISE NOTICE 'Test ledger entry created: %', test_ledger_id;
--   
--   -- Clean up test entry
--   DELETE FROM wallet_ledger WHERE id = test_ledger_id;
-- END $$;

