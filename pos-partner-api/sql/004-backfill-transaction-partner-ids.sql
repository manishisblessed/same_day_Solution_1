-- ============================================================================
-- Backfill partner_id for Existing Transactions
-- ============================================================================
-- This script updates existing transactions in pos_transactions to have the
-- correct partner_id based on matching terminal_id with partner_pos_machines.
-- 
-- This is needed for transactions that were created before machines were
-- synced to partner_pos_machines, or transactions that came through the
-- old webhook flow.
-- ============================================================================

-- Step 1: Update transactions that have a terminal_id matching partner_pos_machines
-- but have NULL or incorrect partner_id
UPDATE pos_transactions pt
SET 
  partner_id = ppm.partner_id,
  retailer_id = ppm.retailer_id,
  updated_at = NOW()
FROM partner_pos_machines ppm
WHERE pt.terminal_id = ppm.terminal_id
  AND (
    pt.partner_id IS NULL 
    OR pt.partner_id != ppm.partner_id
    OR pt.retailer_id IS NULL
    OR pt.retailer_id != ppm.retailer_id
  );

-- Step 2: Show summary of updated transactions
SELECT 
  'Backfill Summary' AS report_type,
  COUNT(*) AS total_transactions_updated,
  COUNT(DISTINCT partner_id) AS unique_partners,
  COUNT(DISTINCT terminal_id) AS unique_terminals
FROM pos_transactions pt
WHERE pt.partner_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM partner_pos_machines ppm 
    WHERE ppm.terminal_id = pt.terminal_id
  );

-- Step 3: Show transactions by partner (for verification)
SELECT 
  p.name AS partner_name,
  COUNT(*) AS transaction_count,
  COUNT(DISTINCT pt.terminal_id) AS terminal_count,
  COALESCE(SUM(pt.amount), 0) / 100.0 AS total_amount_rupees,
  MIN(pt.txn_time) AS first_transaction,
  MAX(pt.txn_time) AS last_transaction
FROM pos_transactions pt
JOIN partners p ON p.id = pt.partner_id
WHERE pt.partner_id IS NOT NULL
GROUP BY p.id, p.name
ORDER BY transaction_count DESC;

-- Step 4: Show any transactions that still don't have a partner_id
-- (these are from terminals not in partner_pos_machines)
SELECT 
  'Orphaned Transactions' AS report_type,
  COUNT(*) AS orphaned_count,
  COUNT(DISTINCT terminal_id) AS orphaned_terminals
FROM pos_transactions pt
WHERE pt.partner_id IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM partner_pos_machines ppm 
    WHERE ppm.terminal_id = pt.terminal_id
  );

-- Step 5: List orphaned transactions (for manual review)
SELECT 
  pt.id,
  pt.razorpay_txn_id,
  pt.terminal_id,
  pt.amount / 100.0 AS amount_rupees,
  pt.status,
  pt.txn_time
FROM pos_transactions pt
WHERE pt.partner_id IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM partner_pos_machines ppm 
    WHERE ppm.terminal_id = pt.terminal_id
  )
ORDER BY pt.txn_time DESC
LIMIT 20;


