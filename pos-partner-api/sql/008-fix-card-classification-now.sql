-- ============================================================================
-- QUICK FIX: Ensure card_classification column exists in razorpay_pos_transactions
-- ============================================================================
-- This is the table that transactionService.js queries from
-- Run this in Supabase SQL Editor immediately
-- ============================================================================

-- Step 1: Add column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'razorpay_pos_transactions' 
    AND column_name = 'card_classification'
  ) THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN card_classification TEXT;
    RAISE NOTICE '✓ Added card_classification column to razorpay_pos_transactions';
  ELSE
    RAISE NOTICE '✓ Column card_classification already exists';
  END IF;
END;
$$;

-- Step 2: Also add other missing columns that the query uses
DO $$
BEGIN
  -- card_number
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'card_number'
  ) THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN card_number TEXT;
    RAISE NOTICE '✓ Added card_number column';
  END IF;

  -- issuing_bank
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'issuing_bank'
  ) THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN issuing_bank TEXT;
    RAISE NOTICE '✓ Added issuing_bank column';
  END IF;

  -- customer_name
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'customer_name'
  ) THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN customer_name TEXT;
    RAISE NOTICE '✓ Added customer_name column';
  END IF;

  -- payer_name
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'payer_name'
  ) THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN payer_name TEXT;
    RAISE NOTICE '✓ Added payer_name column';
  END IF;

  -- username
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'username'
  ) THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN username TEXT;
    RAISE NOTICE '✓ Added username column';
  END IF;

  -- txn_type
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'txn_type'
  ) THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN txn_type TEXT DEFAULT 'CHARGE';
    RAISE NOTICE '✓ Added txn_type column';
  END IF;

  -- auth_code
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'auth_code'
  ) THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN auth_code TEXT;
    RAISE NOTICE '✓ Added auth_code column';
  END IF;

  -- mid_code (used as 'mid' in query)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'mid_code'
  ) THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN mid_code TEXT;
    RAISE NOTICE '✓ Added mid_code column';
  END IF;

  -- currency
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'currency'
  ) THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN currency TEXT DEFAULT 'INR';
    RAISE NOTICE '✓ Added currency column';
  END IF;

  -- receipt_url
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'receipt_url'
  ) THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN receipt_url TEXT;
    RAISE NOTICE '✓ Added receipt_url column';
  END IF;

  -- merchant_name
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'merchant_name'
  ) THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN merchant_name TEXT;
    RAISE NOTICE '✓ Added merchant_name column';
  END IF;
END;
$$;

-- Step 3: Backfill card_classification from raw_data for existing records
UPDATE razorpay_pos_transactions
SET card_classification = COALESCE(
  raw_data->>'cardClassification',
  raw_data->>'cardCategory'
)
WHERE card_classification IS NULL
  AND raw_data IS NOT NULL
  AND (
    raw_data->>'cardClassification' IS NOT NULL
    OR raw_data->>'cardCategory' IS NOT NULL
  );

-- Step 4: Backfill other fields from raw_data
UPDATE razorpay_pos_transactions
SET 
  card_number = COALESCE(
    card_number,
    raw_data->>'cardNumber',
    raw_data->>'maskedCardNumber'
  ),
  issuing_bank = COALESCE(
    issuing_bank,
    raw_data->>'issuingBankName',
    raw_data->>'bankName',
    raw_data->>'issuingBank'
  ),
  customer_name = COALESCE(
    customer_name,
    raw_data->>'customerName',
    raw_data->>'payerName'
  ),
  payer_name = COALESCE(
    payer_name,
    raw_data->>'payerName'
  ),
  username = COALESCE(
    username,
    raw_data->>'username'
  ),
  auth_code = COALESCE(
    auth_code,
    raw_data->>'authCode'
  ),
  mid_code = COALESCE(
    mid_code,
    raw_data->>'mid',
    raw_data->>'merchantId'
  ),
  currency = COALESCE(
    currency,
    raw_data->>'currencyCode',
    'INR'
  ),
  receipt_url = COALESCE(
    receipt_url,
    raw_data->>'customerReceiptUrl',
    raw_data->>'receiptUrl'
  ),
  merchant_name = COALESCE(
    merchant_name,
    raw_data->>'merchantName'
  )
WHERE raw_data IS NOT NULL;

-- Step 5: Verify - Check a sample transaction
SELECT 
  txn_id,
  tid,
  card_classification,
  card_number,
  issuing_bank,
  customer_name,
  CASE 
    WHEN card_classification IS NOT NULL THEN '✓ Has value'
    WHEN raw_data->>'cardClassification' IS NOT NULL THEN '⚠ Has raw_data but not extracted'
    ELSE '✗ No value'
  END AS status
FROM razorpay_pos_transactions
WHERE tid = '96192578'
ORDER BY transaction_time DESC
LIMIT 3;

