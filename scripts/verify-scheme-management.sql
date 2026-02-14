-- ============================================================================
-- SCHEME MANAGEMENT SYSTEM - VERIFICATION SCRIPT
-- ============================================================================
-- Run this in Supabase SQL Editor to verify all components are set up correctly
-- ============================================================================

-- ============================================================================
-- 1. CHECK TABLES EXIST
-- ============================================================================
SELECT 
  'Tables Check' as check_type,
  COUNT(*) as count,
  CASE 
    WHEN COUNT(*) = 5 THEN '✅ All tables exist'
    ELSE '❌ Missing tables'
  END as status
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
  'schemes',
  'scheme_bbps_commissions',
  'scheme_payout_charges',
  'scheme_mdr_rates',
  'scheme_mappings'
);

-- ============================================================================
-- 2. CHECK DATABASE FUNCTIONS EXIST
-- ============================================================================
SELECT 
  'Functions Check' as check_type,
  COUNT(*) as count,
  CASE 
    WHEN COUNT(*) >= 3 THEN '✅ All functions exist'
    ELSE '❌ Missing functions'
  END as status
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_name IN (
  'resolve_scheme_for_user',
  'calculate_bbps_charge_from_scheme',
  'calculate_payout_charge_from_scheme'
);

-- ============================================================================
-- 3. CHECK SCHEMES CREATED
-- ============================================================================
SELECT 
  'Schemes Count' as check_type,
  COUNT(*) as count,
  CASE 
    WHEN COUNT(*) > 0 THEN '✅ Schemes exist'
    ELSE '⚠️ No schemes created yet'
  END as status
FROM schemes;

-- ============================================================================
-- 4. CHECK SCHEME TYPES DISTRIBUTION
-- ============================================================================
SELECT 
  scheme_type,
  COUNT(*) as count,
  COUNT(CASE WHEN status = 'active' THEN 1 END) as active_count
FROM schemes
GROUP BY scheme_type
ORDER BY 
  CASE scheme_type
    WHEN 'global' THEN 1
    WHEN 'golden' THEN 2
    WHEN 'custom' THEN 3
  END;

-- ============================================================================
-- 5. CHECK BBPS COMMISSIONS CONFIGURED
-- ============================================================================
SELECT 
  'BBPS Commissions' as check_type,
  COUNT(*) as total_slabs,
  COUNT(DISTINCT scheme_id) as schemes_with_bbps,
  COUNT(CASE WHEN status = 'active' THEN 1 END) as active_slabs
FROM scheme_bbps_commissions;

-- ============================================================================
-- 6. CHECK PAYOUT CHARGES CONFIGURED
-- ============================================================================
SELECT 
  'Payout Charges' as check_type,
  COUNT(*) as total_charges,
  COUNT(DISTINCT scheme_id) as schemes_with_payout,
  COUNT(DISTINCT transfer_mode) as transfer_modes_configured,
  COUNT(CASE WHEN status = 'active' THEN 1 END) as active_charges
FROM scheme_payout_charges;

-- ============================================================================
-- 7. CHECK MDR RATES CONFIGURED
-- ============================================================================
SELECT 
  'MDR Rates' as check_type,
  COUNT(*) as total_rates,
  COUNT(DISTINCT scheme_id) as schemes_with_mdr,
  COUNT(DISTINCT mode) as payment_modes_configured,
  COUNT(CASE WHEN status = 'active' THEN 1 END) as active_rates
FROM scheme_mdr_rates;

-- ============================================================================
-- 8. CHECK SCHEME MAPPINGS
-- ============================================================================
SELECT 
  'Scheme Mappings' as check_type,
  COUNT(*) as total_mappings,
  COUNT(CASE WHEN status = 'active' THEN 1 END) as active_mappings,
  COUNT(DISTINCT scheme_id) as schemes_mapped,
  COUNT(DISTINCT entity_role) as roles_mapped
FROM scheme_mappings;

-- ============================================================================
-- 9. CHECK MAPPINGS BY ROLE
-- ============================================================================
SELECT 
  entity_role,
  COUNT(*) as total_mappings,
  COUNT(CASE WHEN status = 'active' THEN 1 END) as active_mappings,
  COUNT(DISTINCT scheme_id) as unique_schemes
FROM scheme_mappings
GROUP BY entity_role
ORDER BY 
  CASE entity_role
    WHEN 'master_distributor' THEN 1
    WHEN 'distributor' THEN 2
    WHEN 'retailer' THEN 3
  END;

-- ============================================================================
-- 10. CHECK TRANSACTION SCHEME LINKING (BBPS)
-- ============================================================================
SELECT 
  'BBPS Transactions' as check_type,
  COUNT(*) as total_transactions,
  COUNT(scheme_id) as with_scheme,
  COUNT(*) - COUNT(scheme_id) as without_scheme,
  ROUND(100.0 * COUNT(scheme_id) / NULLIF(COUNT(*), 0), 2) as scheme_coverage_pct
FROM bbps_transactions
WHERE created_at >= NOW() - INTERVAL '7 days';

-- ============================================================================
-- 11. CHECK TRANSACTION SCHEME LINKING (PAYOUT)
-- ============================================================================
SELECT 
  'Payout Transactions' as check_type,
  COUNT(*) as total_transactions,
  COUNT(scheme_id) as with_scheme,
  COUNT(*) - COUNT(scheme_id) as without_scheme,
  ROUND(100.0 * COUNT(scheme_id) / NULLIF(COUNT(*), 0), 2) as scheme_coverage_pct
FROM payout_transactions
WHERE created_at >= NOW() - INTERVAL '7 days';

-- ============================================================================
-- 12. CHECK SCHEME PRIORITY ORDERING
-- ============================================================================
SELECT 
  id,
  name,
  scheme_type,
  priority,
  status,
  CASE 
    WHEN priority < 200 THEN '✅ High Priority'
    WHEN priority < 800 THEN '⚠️ Medium Priority'
    ELSE 'ℹ️ Low Priority (Global)'
  END as priority_status
FROM schemes
WHERE status = 'active'
ORDER BY priority, created_at;

-- ============================================================================
-- 13. CHECK SCHEME SERVICE SCOPE DISTRIBUTION
-- ============================================================================
SELECT 
  service_scope,
  COUNT(*) as scheme_count,
  COUNT(CASE WHEN status = 'active' THEN 1 END) as active_count
FROM schemes
GROUP BY service_scope
ORDER BY 
  CASE service_scope
    WHEN 'all' THEN 1
    WHEN 'bbps' THEN 2
    WHEN 'payout' THEN 3
    WHEN 'mdr' THEN 4
    WHEN 'settlement' THEN 5
  END;

-- ============================================================================
-- 14. CHECK BBPS COMMISSION SLABS (Sample)
-- ============================================================================
SELECT 
  s.name as scheme_name,
  sbc.category,
  sbc.min_amount,
  sbc.max_amount,
  sbc.retailer_charge,
  sbc.retailer_charge_type,
  sbc.status
FROM scheme_bbps_commissions sbc
JOIN schemes s ON sbc.scheme_id = s.id
WHERE sbc.status = 'active'
ORDER BY s.name, sbc.min_amount
LIMIT 10;

-- ============================================================================
-- 15. CHECK PAYOUT CHARGES BY MODE (Sample)
-- ============================================================================
SELECT 
  s.name as scheme_name,
  spc.transfer_mode,
  spc.min_amount,
  spc.max_amount,
  spc.retailer_charge,
  spc.retailer_charge_type,
  spc.status
FROM scheme_payout_charges spc
JOIN schemes s ON spc.scheme_id = s.id
WHERE spc.status = 'active'
ORDER BY s.name, spc.transfer_mode, spc.min_amount
LIMIT 10;

-- ============================================================================
-- 16. CHECK MDR RATES BY MODE (Sample)
-- ============================================================================
SELECT 
  s.name as scheme_name,
  smr.mode,
  smr.card_type,
  smr.brand_type,
  smr.retailer_mdr_t1,
  smr.retailer_mdr_t0,
  smr.status
FROM scheme_mdr_rates smr
JOIN schemes s ON smr.scheme_id = s.id
WHERE smr.status = 'active'
ORDER BY s.name, smr.mode, smr.card_type
LIMIT 10;

-- ============================================================================
-- 17. CHECK ACTIVE SCHEME MAPPINGS (Sample)
-- ============================================================================
SELECT 
  s.name as scheme_name,
  s.scheme_type,
  sm.entity_role,
  sm.entity_id,
  sm.status,
  sm.created_at
FROM scheme_mappings sm
JOIN schemes s ON sm.scheme_id = s.id
WHERE sm.status = 'active'
ORDER BY s.priority, sm.entity_role, sm.created_at DESC
LIMIT 20;

-- ============================================================================
-- 18. CHECK RECENT TRANSACTIONS WITH SCHEMES
-- ============================================================================
-- BBPS
SELECT * FROM (
  SELECT 
    'BBPS' as transaction_type,
    bt.id,
    bt.retailer_id,
    bt.bill_amount as amount,
    bt.scheme_id,
    bt.scheme_name,
    bt.retailer_charge,
    bt.status,
    bt.created_at
  FROM bbps_transactions bt
  WHERE bt.created_at >= NOW() - INTERVAL '7 days'
  AND bt.scheme_id IS NOT NULL
  ORDER BY bt.created_at DESC
  LIMIT 5
) bbps_txs

UNION ALL

-- Payout
SELECT * FROM (
  SELECT 
    'Payout' as transaction_type,
    pt.id,
    pt.retailer_id,
    pt.amount,
    pt.scheme_id,
    pt.scheme_name,
    pt.retailer_charge,
    pt.status,
    pt.created_at
  FROM payout_transactions pt
  WHERE pt.created_at >= NOW() - INTERVAL '7 days'
  AND pt.scheme_id IS NOT NULL
  ORDER BY pt.created_at DESC
  LIMIT 5
) payout_txs
ORDER BY created_at DESC;

-- ============================================================================
-- 19. CHECK FOR ORPHANED CONFIGURATIONS
-- ============================================================================
-- BBPS commissions without scheme
SELECT 
  'Orphaned BBPS Commissions' as issue,
  COUNT(*) as count
FROM scheme_bbps_commissions sbc
LEFT JOIN schemes s ON sbc.scheme_id = s.id
WHERE s.id IS NULL

UNION ALL

-- Payout charges without scheme
SELECT 
  'Orphaned Payout Charges' as issue,
  COUNT(*) as count
FROM scheme_payout_charges spc
LEFT JOIN schemes s ON spc.scheme_id = s.id
WHERE s.id IS NULL

UNION ALL

-- MDR rates without scheme
SELECT 
  'Orphaned MDR Rates' as issue,
  COUNT(*) as count
FROM scheme_mdr_rates smr
LEFT JOIN schemes s ON smr.scheme_id = s.id
WHERE s.id IS NULL

UNION ALL

-- Mappings without scheme
SELECT 
  'Orphaned Mappings' as issue,
  COUNT(*) as count
FROM scheme_mappings sm
LEFT JOIN schemes s ON sm.scheme_id = s.id
WHERE s.id IS NULL;

-- ============================================================================
-- 20. CHECK FOR INVALID SCHEME REFERENCES IN TRANSACTIONS
-- ============================================================================
-- BBPS transactions with invalid scheme_id
SELECT 
  'Invalid BBPS Scheme References' as issue,
  COUNT(*) as count
FROM bbps_transactions bt
WHERE bt.scheme_id IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM schemes s WHERE s.id = bt.scheme_id
)

UNION ALL

-- Payout transactions with invalid scheme_id
SELECT 
  'Invalid Payout Scheme References' as issue,
  COUNT(*) as count
FROM payout_transactions pt
WHERE pt.scheme_id IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM schemes s WHERE s.id = pt.scheme_id
);

-- ============================================================================
-- SUMMARY REPORT
-- ============================================================================
SELECT 
  '=== SCHEME MANAGEMENT SYSTEM STATUS ===' as report;

SELECT 
  'Total Schemes' as metric,
  COUNT(*)::text as value
FROM schemes

UNION ALL

SELECT 
  'Active Schemes' as metric,
  COUNT(*)::text as value
FROM schemes
WHERE status = 'active'

UNION ALL

SELECT 
  'Schemes with BBPS Config' as metric,
  COUNT(DISTINCT scheme_id)::text as value
FROM scheme_bbps_commissions
WHERE status = 'active'

UNION ALL

SELECT 
  'Schemes with Payout Config' as metric,
  COUNT(DISTINCT scheme_id)::text as value
FROM scheme_payout_charges
WHERE status = 'active'

UNION ALL

SELECT 
  'Schemes with MDR Config' as metric,
  COUNT(DISTINCT scheme_id)::text as value
FROM scheme_mdr_rates
WHERE status = 'active'

UNION ALL

SELECT 
  'Active Mappings' as metric,
  COUNT(*)::text as value
FROM scheme_mappings
WHERE status = 'active'

UNION ALL

SELECT 
  'BBPS Transactions (7 days)' as metric,
  COUNT(*)::text as value
FROM bbps_transactions
WHERE created_at >= NOW() - INTERVAL '7 days'

UNION ALL

SELECT 
  'BBPS with Scheme (7 days)' as metric,
  COUNT(*)::text as value
FROM bbps_transactions
WHERE created_at >= NOW() - INTERVAL '7 days'
AND scheme_id IS NOT NULL

UNION ALL

SELECT 
  'Payout Transactions (7 days)' as metric,
  COUNT(*)::text as value
FROM payout_transactions
WHERE created_at >= NOW() - INTERVAL '7 days'

UNION ALL

SELECT 
  'Payout with Scheme (7 days)' as metric,
  COUNT(*)::text as value
FROM payout_transactions
WHERE created_at >= NOW() - INTERVAL '7 days'
AND scheme_id IS NOT NULL;

