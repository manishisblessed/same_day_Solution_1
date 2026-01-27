-- ============================================================================
-- BBPS SETUP VERIFICATION SCRIPT
-- Run this in Supabase SQL Editor to verify all required objects exist
-- ============================================================================

-- 1. Check if required tables exist
SELECT 
  'Tables Check' as check_type,
  table_name,
  CASE WHEN table_name IS NOT NULL THEN '✓ EXISTS' ELSE '✗ MISSING' END as status
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('bbps_transactions', 'bbps_billers', 'wallet_ledger', 'wallets', 'retailers')
ORDER BY table_name;

-- 2. Check if required functions exist
SELECT 
  'Functions Check' as check_type,
  routine_name,
  CASE WHEN routine_name IS NOT NULL THEN '✓ EXISTS' ELSE '✗ MISSING' END as status
FROM information_schema.routines 
WHERE routine_schema = 'public' 
  AND routine_type = 'FUNCTION'
  AND routine_name IN (
    'get_wallet_balance', 
    'get_wallet_balance_v2',
    'debit_wallet_bbps', 
    'refund_wallet_bbps',
    'calculate_transaction_charge',
    'add_ledger_entry'
  )
ORDER BY routine_name;

-- 3. Check bbps_transactions table structure
SELECT 
  'bbps_transactions columns' as check_type,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'bbps_transactions'
ORDER BY ordinal_position;

-- 4. Check wallet_ledger table structure
SELECT 
  'wallet_ledger columns' as check_type,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'wallet_ledger'
ORDER BY ordinal_position;

-- 5. Check wallets table structure
SELECT 
  'wallets columns' as check_type,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'wallets'
ORDER BY ordinal_position;

-- 6. Test get_wallet_balance function (if exists)
DO $$
BEGIN
  -- Try to call the function with a dummy ID
  PERFORM get_wallet_balance('TEST_RETAILER_ID');
  RAISE NOTICE '✓ get_wallet_balance function works';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '✗ get_wallet_balance function error: %', SQLERRM;
END $$;

-- 7. Count existing data
SELECT 
  'Data Count' as check_type,
  'bbps_transactions' as table_name,
  COUNT(*) as record_count
FROM bbps_transactions
UNION ALL
SELECT 
  'Data Count',
  'wallet_ledger',
  COUNT(*)
FROM wallet_ledger
UNION ALL
SELECT 
  'Data Count',
  'wallets',
  COUNT(*)
FROM wallets
UNION ALL
SELECT 
  'Data Count',
  'retailers',
  COUNT(*)
FROM retailers;

-- ============================================================================
-- IF ANY CHECKS FAIL, RUN THE SETUP SCRIPTS IN THIS ORDER:
-- 1. supabase-schema.sql
-- 2. supabase-schema-razorpay.sql  
-- 3. supabase-schema-bbps.sql
-- 4. supabase-schema-wallet-ledger-integration.sql
-- ============================================================================

