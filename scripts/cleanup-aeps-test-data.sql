-- AEPS Database Cleanup Script
-- Run this in your Supabase SQL Editor to remove test/dummy data

-- Check current AEPS data
SELECT 
  'aeps_transactions' as table_name,
  COUNT(*) as record_count,
  COUNT(CASE WHEN status = 'success' THEN 1 END) as success_count,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
  COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
  MIN(created_at) as earliest_record,
  MAX(created_at) as latest_record
FROM aeps_transactions

UNION ALL

SELECT 
  'aeps_merchants' as table_name,
  COUNT(*) as record_count,
  COUNT(CASE WHEN kyc_status = 'validated' THEN 1 END) as validated_count,
  COUNT(CASE WHEN kyc_status = 'pending' THEN 1 END) as pending_count,
  COUNT(CASE WHEN kyc_status = 'rejected' THEN 1 END) as rejected_count,
  MIN(created_at) as earliest_record,
  MAX(created_at) as latest_record
FROM aeps_merchants;

-- UNCOMMENT THE LINES BELOW TO DELETE ALL AEPS DATA
-- WARNING: This will permanently delete all AEPS transactions and merchants!

-- Delete all AEPS transactions
-- DELETE FROM aeps_transactions;

-- Delete all AEPS merchants
-- DELETE FROM aeps_merchants;

-- Verify deletion
-- SELECT COUNT(*) as remaining_transactions FROM aeps_transactions;
-- SELECT COUNT(*) as remaining_merchants FROM aeps_merchants;
