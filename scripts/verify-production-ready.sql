-- ============================================================================
-- PRODUCTION READINESS VERIFICATION
-- Run this in Supabase SQL Editor to verify all required components exist
-- ============================================================================

-- 1. Check required tables exist
SELECT 
  'Tables' as check_type,
  CASE 
    WHEN COUNT(*) = 7 THEN '✅ All 7 required tables exist'
    ELSE '❌ Missing tables! Found: ' || COUNT(*) || '/7'
  END as status
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
  'retailers',
  'wallets', 
  'wallet_ledger',
  'bbps_transactions',
  'bbps_billers',
  'pos_terminals',
  'razorpay_transactions'
);

-- 2. Check required functions exist
SELECT 
  'Functions' as check_type,
  CASE 
    WHEN COUNT(*) >= 4 THEN '✅ All required functions exist'
    ELSE '❌ Missing functions! Found: ' || COUNT(*) || '/4'
  END as status
FROM pg_proc 
WHERE proname IN (
  'get_wallet_balance',
  'debit_wallet_bbps',
  'refund_wallet_bbps',
  'calculate_transaction_charge'
);

-- 3. List individual tables
SELECT '--- TABLE CHECK ---' as info;
SELECT 
  table_name,
  CASE 
    WHEN table_name IS NOT NULL THEN '✅ Exists'
    ELSE '❌ Missing'
  END as status
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
  'retailers',
  'distributors',
  'master_distributors',
  'wallets', 
  'wallet_ledger',
  'bbps_transactions',
  'bbps_billers'
)
ORDER BY table_name;

-- 4. List individual functions
SELECT '--- FUNCTION CHECK ---' as info;
SELECT 
  proname as function_name,
  '✅ Exists' as status
FROM pg_proc 
WHERE proname IN (
  'get_wallet_balance',
  'get_wallet_balance_v2',
  'debit_wallet_bbps',
  'refund_wallet_bbps',
  'credit_wallet',
  'calculate_transaction_charge'
)
ORDER BY proname;

-- 5. Check if any retailer exists (needed for testing)
SELECT '--- RETAILER CHECK ---' as info;
SELECT 
  CASE 
    WHEN COUNT(*) > 0 THEN '✅ ' || COUNT(*) || ' retailer(s) found'
    ELSE '❌ No retailers found - create at least one to test'
  END as status
FROM retailers;

-- 6. Check if retailer has wallet balance (for testing)
SELECT '--- WALLET BALANCE CHECK ---' as info;
SELECT 
  r.partner_id,
  r.name,
  COALESCE(w.balance, 0) as wallet_balance,
  CASE 
    WHEN COALESCE(w.balance, 0) > 0 THEN '✅ Has balance'
    ELSE '⚠️ Zero balance - add funds to test BBPS'
  END as status
FROM retailers r
LEFT JOIN wallets w ON w.user_id = r.partner_id AND w.wallet_type = 'primary'
LIMIT 5;

-- 7. Summary
SELECT '=== SUMMARY ===' as info;
SELECT 
  'Your database is ' || 
  CASE 
    WHEN (
      SELECT COUNT(*) FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('retailers', 'wallets', 'wallet_ledger', 'bbps_transactions')
    ) >= 4 
    AND (
      SELECT COUNT(*) FROM pg_proc 
      WHERE proname IN ('get_wallet_balance', 'debit_wallet_bbps', 'refund_wallet_bbps')
    ) >= 3
    THEN '✅ READY FOR BBPS PAYMENTS!'
    ELSE '❌ NOT READY - Check missing components above'
  END as production_status;

