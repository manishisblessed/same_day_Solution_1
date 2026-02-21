-- ============================================================================
-- Verify card_classification Column and Data
-- ============================================================================
-- Run this to check if the column exists and has data
-- ============================================================================

-- Check if column exists in razorpay_pos_transactions
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'razorpay_pos_transactions'
  AND column_name = 'card_classification';

-- Check if column exists in pos_transactions
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'pos_transactions'
  AND column_name = 'card_classification';

-- Check sample data from razorpay_pos_transactions
SELECT 
  id,
  txn_id,
  tid,
  card_classification,
  raw_data->>'cardClassification' AS raw_card_classification,
  raw_data->>'cardCategory' AS raw_card_category,
  CASE 
    WHEN card_classification IS NOT NULL THEN 'Has column value'
    WHEN raw_data->>'cardClassification' IS NOT NULL THEN 'Has raw_data value'
    WHEN raw_data->>'cardCategory' IS NOT NULL THEN 'Has raw_data category'
    ELSE 'No value found'
  END AS classification_source
FROM razorpay_pos_transactions
WHERE tid IN ('96192578')
ORDER BY transaction_time DESC
LIMIT 5;

-- Check if we need to add the column (if above returns 0 rows)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'razorpay_pos_transactions' 
    AND column_name = 'card_classification'
  ) THEN
    RAISE NOTICE 'Column card_classification does NOT exist in razorpay_pos_transactions!';
    RAISE NOTICE 'You need to run: ALTER TABLE razorpay_pos_transactions ADD COLUMN card_classification TEXT;';
  ELSE
    RAISE NOTICE 'Column card_classification EXISTS in razorpay_pos_transactions ✓';
  END IF;
END;
$$;

