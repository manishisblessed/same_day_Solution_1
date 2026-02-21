-- ============================================================================
-- Migration 009: Add card_txn_type and acquiring_bank columns
--
-- These fields come from the Razorpay POS transaction report:
--   card_txn_type   — Entry mode: "EMV with PIN", "Contactless", "Swipe", etc.
--   acquiring_bank  — Acquiring bank: "HDFC", "AMEX", etc.
--
-- Applied to both razorpay_pos_transactions and pos_transactions tables.
-- ============================================================================

-- razorpay_pos_transactions (main webhook data table)
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS card_txn_type TEXT;
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS acquiring_bank TEXT;

-- pos_transactions (partitioned partner API table)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pos_transactions' AND column_name = 'card_txn_type'
  ) THEN
    ALTER TABLE pos_transactions ADD COLUMN card_txn_type TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pos_transactions' AND column_name = 'acquiring_bank'
  ) THEN
    ALTER TABLE pos_transactions ADD COLUMN acquiring_bank TEXT;
  END IF;
END;
$$;

-- ============================================================================
-- Backfill from raw_data / raw_payload for existing records
-- ============================================================================

-- Backfill razorpay_pos_transactions from raw_data JSONB
UPDATE razorpay_pos_transactions
SET card_txn_type = COALESCE(
  raw_data->>'cardTxnType',
  raw_data->>'cardTransactionType',
  raw_data->>'entryMode'
)
WHERE card_txn_type IS NULL
  AND raw_data IS NOT NULL
  AND (raw_data->>'cardTxnType' IS NOT NULL
    OR raw_data->>'cardTransactionType' IS NOT NULL
    OR raw_data->>'entryMode' IS NOT NULL);

UPDATE razorpay_pos_transactions
SET acquiring_bank = COALESCE(
  raw_data->>'acquiringBank',
  raw_data->>'acquiringBankName',
  raw_data->>'acquirerCode'
)
WHERE acquiring_bank IS NULL
  AND raw_data IS NOT NULL
  AND (raw_data->>'acquiringBank' IS NOT NULL
    OR raw_data->>'acquiringBankName' IS NOT NULL
    OR raw_data->>'acquirerCode' IS NOT NULL);

-- Backfill pos_transactions from raw_payload JSONB
UPDATE pos_transactions
SET card_txn_type = COALESCE(
  raw_payload->>'cardTxnType',
  raw_payload->>'cardTransactionType',
  raw_payload->>'entryMode'
)
WHERE card_txn_type IS NULL
  AND raw_payload IS NOT NULL
  AND (raw_payload->>'cardTxnType' IS NOT NULL
    OR raw_payload->>'cardTransactionType' IS NOT NULL
    OR raw_payload->>'entryMode' IS NOT NULL);

UPDATE pos_transactions
SET acquiring_bank = COALESCE(
  raw_payload->>'acquiringBank',
  raw_payload->>'acquiringBankName',
  raw_payload->>'acquirerCode'
)
WHERE acquiring_bank IS NULL
  AND raw_payload IS NOT NULL
  AND (raw_payload->>'acquiringBank' IS NOT NULL
    OR raw_payload->>'acquiringBankName' IS NOT NULL
    OR raw_payload->>'acquirerCode' IS NOT NULL);

-- Backfill all detailed fields that may be null in razorpay_pos_transactions
UPDATE razorpay_pos_transactions
SET
  card_number = COALESCE(card_number, raw_data->>'cardNumber', raw_data->>'maskedCardNumber'),
  issuing_bank = COALESCE(issuing_bank, raw_data->>'issuingBankName', raw_data->>'bankName', raw_data->>'issuingBank'),
  card_classification = COALESCE(card_classification, raw_data->>'cardClassification', raw_data->>'cardCategory'),
  card_brand = COALESCE(card_brand, raw_data->>'paymentCardBrand', raw_data->>'cardBrand'),
  card_type = COALESCE(card_type, raw_data->>'paymentCardType', raw_data->>'cardType'),
  merchant_name = COALESCE(merchant_name, raw_data->>'merchantName'),
  customer_name = COALESCE(customer_name, raw_data->>'customerName', raw_data->>'payerName'),
  payer_name = COALESCE(payer_name, raw_data->>'payerName'),
  username = COALESCE(username, raw_data->>'username'),
  auth_code = COALESCE(auth_code, raw_data->>'authCode'),
  rrn = COALESCE(rrn, raw_data->>'rrNumber', raw_data->>'rrn'),
  external_ref = COALESCE(external_ref, raw_data->>'externalRefNumber'),
  mid_code = COALESCE(mid_code, raw_data->>'mid', raw_data->>'merchantId'),
  receipt_url = COALESCE(receipt_url, raw_data->>'customerReceiptUrl', raw_data->>'receiptUrl')
WHERE raw_data IS NOT NULL
  AND (card_number IS NULL OR issuing_bank IS NULL OR card_classification IS NULL
       OR card_brand IS NULL OR card_type IS NULL OR merchant_name IS NULL
       OR customer_name IS NULL OR auth_code IS NULL OR rrn IS NULL
       OR external_ref IS NULL OR mid_code IS NULL OR receipt_url IS NULL);
