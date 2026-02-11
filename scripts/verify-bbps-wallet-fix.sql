-- ============================================================================
-- BBPS Wallet Fix Verification Script
-- Run this in Supabase SQL Editor to verify all required functions exist
-- ============================================================================

-- 1. Check if ensure_wallet function exists
SELECT 'ensure_wallet' as function_name, 
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'ensure_wallet'
  ) THEN '✅ EXISTS' ELSE '❌ MISSING - Run fix-wallet-push-error.sql first' END as status;

-- 2. Check if add_ledger_entry function exists
SELECT 'add_ledger_entry' as function_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'add_ledger_entry'
  ) THEN '✅ EXISTS' ELSE '❌ MISSING - Run fix-wallet-push-error.sql first' END as status;

-- 3. Check if get_wallet_balance_v2 function exists
SELECT 'get_wallet_balance_v2' as function_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'get_wallet_balance_v2'
  ) THEN '✅ EXISTS' ELSE '❌ MISSING' END as status;

-- 4. Check if wallets table exists
SELECT 'wallets table' as item_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'wallets'
  ) THEN '✅ EXISTS' ELSE '❌ MISSING' END as status;

-- 5. Check if wallet_ledger table exists
SELECT 'wallet_ledger table' as item_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'wallet_ledger'
  ) THEN '✅ EXISTS' ELSE '❌ MISSING' END as status;

-- 6. Check if bbps_transactions table exists
SELECT 'bbps_transactions table' as item_name,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'bbps_transactions'
  ) THEN '✅ EXISTS' ELSE '❌ MISSING' END as status;

-- 7. Check wallet_ledger has necessary columns
SELECT 'wallet_ledger columns' as item_name,
  string_agg(column_name, ', ' ORDER BY ordinal_position) as columns
FROM information_schema.columns
WHERE table_name = 'wallet_ledger';

-- 8. Check if there are any BBPS transactions
SELECT 'bbps_transactions count' as metric,
  COUNT(*) as value
FROM bbps_transactions;

-- 9. Check if there are any BBPS_DEBIT entries in wallet_ledger
SELECT 'BBPS_DEBIT ledger entries' as metric,
  COUNT(*) as value
FROM wallet_ledger
WHERE transaction_type = 'BBPS_DEBIT';

-- ============================================================================
-- IF add_ledger_entry or ensure_wallet is MISSING, run this:
-- ============================================================================

-- CREATE OR REPLACE FUNCTION ensure_wallet(
--   p_user_id TEXT,
--   p_user_role TEXT,
--   p_wallet_type TEXT
-- )
-- RETURNS UUID AS $$
-- DECLARE
--   v_wallet_id UUID;
-- BEGIN
--   INSERT INTO wallets (user_id, user_role, wallet_type, balance)
--   VALUES (p_user_id, p_user_role, p_wallet_type, 0)
--   ON CONFLICT (user_id, wallet_type) DO UPDATE SET updated_at = NOW()
--   RETURNING id INTO v_wallet_id;
--   RETURN v_wallet_id;
-- END;
-- $$ LANGUAGE plpgsql;

-- Then run the contents of fix-wallet-push-error.sql



