-- ============================================================================
-- Sync Transactions from razorpay_pos_transactions to pos_transactions
-- ============================================================================
-- This script syncs existing transactions from razorpay_pos_transactions
-- to pos_transactions table so they are visible via the Partner API.
-- 
-- It matches transactions by:
-- 1. terminal_id (tid) → partner_pos_machines.terminal_id
-- 2. Gets partner_id and retailer_id from partner_pos_machines
-- 3. Inserts into pos_transactions if not already present
-- ============================================================================

-- Step 1: Insert missing transactions from razorpay_pos_transactions to pos_transactions
INSERT INTO pos_transactions (
  partner_id,
  retailer_id,
  terminal_id,
  razorpay_txn_id,
  external_ref,
  amount,
  status,
  rrn,
  card_brand,
  card_type,
  payment_mode,
  settlement_status,
  device_serial,
  txn_time,
  raw_payload,
  created_at,
  updated_at
)
SELECT DISTINCT ON (rpt.txn_id)
  ppm.partner_id,
  ppm.retailer_id,
  rpt.tid AS terminal_id,
  rpt.txn_id AS razorpay_txn_id,
  NULL AS external_ref, -- razorpay_pos_transactions doesn't have this field
  COALESCE(rpt.amount, 0) AS amount, -- Amount in paisa
  CASE 
    WHEN UPPER(rpt.display_status) = 'SUCCESS' OR UPPER(rpt.status) = 'CAPTURED' THEN 'CAPTURED'
    WHEN UPPER(rpt.display_status) = 'FAILED' OR UPPER(rpt.status) = 'FAILED' THEN 'FAILED'
    WHEN UPPER(rpt.status) = 'AUTHORIZED' THEN 'AUTHORIZED'
    ELSE 'AUTHORIZED'
  END AS status,
  NULL AS rrn, -- razorpay_pos_transactions doesn't have this field
  NULL AS card_brand, -- Extract from raw_data if available
  NULL AS card_type, -- Extract from raw_data if available
  rpt.payment_mode,
  'PENDING' AS settlement_status, -- Default to PENDING
  rpt.device_serial,
  COALESCE(rpt.transaction_time::timestamptz, rpt.created_at) AS txn_time,
  COALESCE(rpt.raw_data::jsonb, '{}'::jsonb) AS raw_payload,
  rpt.created_at,
  rpt.updated_at
FROM razorpay_pos_transactions rpt
INNER JOIN partner_pos_machines ppm ON ppm.terminal_id = rpt.tid
WHERE ppm.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM pos_transactions pt
    WHERE pt.razorpay_txn_id = rpt.txn_id
      AND pt.txn_time >= (COALESCE(rpt.transaction_time::timestamptz, rpt.created_at) - interval '1 day')
      AND pt.txn_time <= (COALESCE(rpt.transaction_time::timestamptz, rpt.created_at) + interval '1 day')
  )
ORDER BY rpt.txn_id, rpt.created_at DESC;

-- Step 2: Show summary of synced transactions
SELECT 
  'Sync Summary' AS report_type,
  COUNT(*) AS total_transactions_synced,
  COUNT(DISTINCT partner_id) AS unique_partners,
  COUNT(DISTINCT terminal_id) AS unique_terminals,
  MIN(txn_time) AS earliest_transaction,
  MAX(txn_time) AS latest_transaction
FROM pos_transactions pt
WHERE EXISTS (
  SELECT 1 FROM razorpay_pos_transactions rpt
  WHERE rpt.txn_id = pt.razorpay_txn_id
    AND rpt.tid = pt.terminal_id
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

