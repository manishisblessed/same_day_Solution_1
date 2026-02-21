-- ============================================================================
-- Add Card Detail Columns to pos_transactions
-- ============================================================================
-- The original schema only had basic card fields (card_brand, card_type).
-- The webhook handler already inserts these fields, but they were missing
-- from the CREATE TABLE definition.
--
-- This migration adds them if they don't already exist.
-- Safe to run multiple times (uses IF NOT EXISTS via DO block).
-- ============================================================================

DO $$
BEGIN
  -- card_number: Masked card number (e.g., 4862-69XX-XXXX-3667)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pos_transactions' AND column_name = 'card_number'
  ) THEN
    ALTER TABLE pos_transactions ADD COLUMN card_number TEXT;
    RAISE NOTICE 'Added column: card_number';
  END IF;

  -- issuing_bank: Card issuing bank (e.g., HDFC, SBI, AXIS)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pos_transactions' AND column_name = 'issuing_bank'
  ) THEN
    ALTER TABLE pos_transactions ADD COLUMN issuing_bank TEXT;
    RAISE NOTICE 'Added column: issuing_bank';
  END IF;

  -- card_classification: Card tier/classification (PLATINUM, GOLD, SIGNATURE, etc.)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pos_transactions' AND column_name = 'card_classification'
  ) THEN
    ALTER TABLE pos_transactions ADD COLUMN card_classification TEXT;
    RAISE NOTICE 'Added column: card_classification';
  END IF;

  -- customer_name: Consumer/cardholder name
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pos_transactions' AND column_name = 'customer_name'
  ) THEN
    ALTER TABLE pos_transactions ADD COLUMN customer_name TEXT;
    RAISE NOTICE 'Added column: customer_name';
  END IF;

  -- payer_name: Payer name
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pos_transactions' AND column_name = 'payer_name'
  ) THEN
    ALTER TABLE pos_transactions ADD COLUMN payer_name TEXT;
    RAISE NOTICE 'Added column: payer_name';
  END IF;

  -- username: Operator/agent username
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pos_transactions' AND column_name = 'username'
  ) THEN
    ALTER TABLE pos_transactions ADD COLUMN username TEXT;
    RAISE NOTICE 'Added column: username';
  END IF;

  -- txn_type: Transaction type (e.g., CHARGE)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pos_transactions' AND column_name = 'txn_type'
  ) THEN
    ALTER TABLE pos_transactions ADD COLUMN txn_type TEXT DEFAULT 'CHARGE';
    RAISE NOTICE 'Added column: txn_type';
  END IF;

  -- auth_code: Authorization code from card issuer
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pos_transactions' AND column_name = 'auth_code'
  ) THEN
    ALTER TABLE pos_transactions ADD COLUMN auth_code TEXT;
    RAISE NOTICE 'Added column: auth_code';
  END IF;

  -- mid: Merchant ID (e.g., IDZ551)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pos_transactions' AND column_name = 'mid'
  ) THEN
    ALTER TABLE pos_transactions ADD COLUMN mid TEXT;
    RAISE NOTICE 'Added column: mid';
  END IF;

  -- currency: Currency code (e.g., INR)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pos_transactions' AND column_name = 'currency'
  ) THEN
    ALTER TABLE pos_transactions ADD COLUMN currency TEXT DEFAULT 'INR';
    RAISE NOTICE 'Added column: currency';
  END IF;

  -- receipt_url: Customer receipt URL
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pos_transactions' AND column_name = 'receipt_url'
  ) THEN
    ALTER TABLE pos_transactions ADD COLUMN receipt_url TEXT;
    RAISE NOTICE 'Added column: receipt_url';
  END IF;

  -- posting_date: Posting date from payment network
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pos_transactions' AND column_name = 'posting_date'
  ) THEN
    ALTER TABLE pos_transactions ADD COLUMN posting_date TIMESTAMPTZ;
    RAISE NOTICE 'Added column: posting_date';
  END IF;

  -- settled_on: Settlement date/time
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pos_transactions' AND column_name = 'settled_on'
  ) THEN
    ALTER TABLE pos_transactions ADD COLUMN settled_on TIMESTAMPTZ;
    RAISE NOTICE 'Added column: settled_on';
  END IF;

  -- merchant_name: Merchant name
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'pos_transactions' AND column_name = 'merchant_name'
  ) THEN
    ALTER TABLE pos_transactions ADD COLUMN merchant_name TEXT;
    RAISE NOTICE 'Added column: merchant_name';
  END IF;

END;
$$;

-- ============================================================================
-- Also ensure razorpay_pos_transactions has card_classification
-- (This table is the raw Razorpay data source)
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'card_classification'
  ) THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN card_classification TEXT;
    RAISE NOTICE 'Added column card_classification to razorpay_pos_transactions';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'card_number'
  ) THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN card_number TEXT;
    RAISE NOTICE 'Added column card_number to razorpay_pos_transactions';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'issuing_bank'
  ) THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN issuing_bank TEXT;
    RAISE NOTICE 'Added column issuing_bank to razorpay_pos_transactions';
  END IF;
END;
$$;

-- ============================================================================
-- Backfill card_classification from raw_payload for existing pos_transactions
-- ============================================================================
UPDATE pos_transactions
SET 
  card_classification = COALESCE(
    raw_payload->>'cardClassification',
    raw_payload->>'cardCategory'
  ),
  card_number = COALESCE(
    card_number,
    raw_payload->>'cardNumber',
    raw_payload->>'maskedCardNumber'
  ),
  issuing_bank = COALESCE(
    issuing_bank,
    raw_payload->>'issuingBankName',
    raw_payload->>'bankName',
    raw_payload->>'issuingBank'
  ),
  customer_name = COALESCE(
    customer_name,
    raw_payload->>'customerName',
    raw_payload->>'payerName'
  ),
  payer_name = COALESCE(
    payer_name,
    raw_payload->>'payerName'
  ),
  username = COALESCE(
    username,
    raw_payload->>'username'
  ),
  auth_code = COALESCE(
    auth_code,
    raw_payload->>'authCode'
  ),
  mid = COALESCE(
    mid,
    raw_payload->>'mid',
    raw_payload->>'merchantId'
  ),
  currency = COALESCE(
    currency,
    raw_payload->>'currencyCode',
    'INR'
  ),
  receipt_url = COALESCE(
    receipt_url,
    raw_payload->>'customerReceiptUrl',
    raw_payload->>'receiptUrl'
  ),
  merchant_name = COALESCE(
    merchant_name,
    raw_payload->>'merchantName'
  ),
  updated_at = NOW()
WHERE card_classification IS NULL
  AND raw_payload IS NOT NULL
  AND (
    raw_payload->>'cardClassification' IS NOT NULL
    OR raw_payload->>'cardCategory' IS NOT NULL
  );

-- ============================================================================
-- Backfill card_classification from raw_data for razorpay_pos_transactions
-- ============================================================================
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

-- ============================================================================
-- Verification: Check how many transactions now have card_classification
-- ============================================================================
SELECT 
  'pos_transactions' AS table_name,
  COUNT(*) AS total,
  COUNT(card_classification) AS has_classification,
  COUNT(*) - COUNT(card_classification) AS missing_classification
FROM pos_transactions;

SELECT 
  'razorpay_pos_transactions' AS table_name,
  COUNT(*) AS total,
  COUNT(card_classification) AS has_classification,
  COUNT(*) - COUNT(card_classification) AS missing_classification
FROM razorpay_pos_transactions;

