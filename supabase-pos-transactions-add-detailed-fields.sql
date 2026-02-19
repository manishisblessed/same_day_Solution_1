-- ============================================================================
-- Migration: Add Detailed Transaction Fields to pos_transactions
-- 
-- Adds columns matching Razorpay POS detailed report format:
-- Customer Name, Username, Txn Type, Auth Code, Card Number (masked),
-- Issuing Bank, Card Classification, MID, Currency, Settled On,
-- Receipt URL, Posting Date, Payer Name
--
-- Run this in Supabase SQL Editor
-- ============================================================================

-- Add new columns to pos_transactions (partitioned table)
-- These columns store detailed fields from Razorpay POS webhook payload

ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS payer_name TEXT;
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS txn_type TEXT DEFAULT 'CHARGE';
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS auth_code TEXT;
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS card_number TEXT;          -- Masked card: 4862-69XX-XXXX-3667
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS issuing_bank TEXT;         -- HDFC, SBI, AXIS, ICICI, etc.
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS card_classification TEXT;  -- PLATINUM, GOLD, STANDARD, BUSINESS, etc.
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS mid TEXT;                  -- Merchant ID: IDZ551
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'INR';
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS settled_on TIMESTAMPTZ;    -- Settlement date/time
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS receipt_url TEXT;          -- Customer receipt URL
ALTER TABLE pos_transactions ADD COLUMN IF NOT EXISTS posting_date TIMESTAMPTZ;  -- Posting date from Razorpay

-- Create indexes for commonly queried new fields
CREATE INDEX IF NOT EXISTS idx_pos_txn_customer_name ON pos_transactions(customer_name) WHERE customer_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_txn_mid ON pos_transactions(mid) WHERE mid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_txn_issuing_bank ON pos_transactions(issuing_bank) WHERE issuing_bank IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_txn_username ON pos_transactions(username) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_txn_settled_on ON pos_transactions(settled_on) WHERE settled_on IS NOT NULL;

-- ============================================================================
-- Also add columns to razorpay_pos_transactions for admin panel direct queries
-- (These complement the raw_data JSONB column for faster querying)
-- ============================================================================

ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS payer_name TEXT;
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS username TEXT;
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS txn_type TEXT;
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS auth_code TEXT;
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS card_number TEXT;
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS issuing_bank TEXT;
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS card_classification TEXT;
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS mid_code TEXT;            -- MID (Merchant ID)
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS currency TEXT;
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS card_brand TEXT;
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS card_type TEXT;
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS rrn TEXT;
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS external_ref TEXT;
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS settled_on TIMESTAMPTZ;
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS receipt_url TEXT;
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS posting_date TIMESTAMPTZ;
ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS settlement_status TEXT;

-- Indexes for razorpay_pos_transactions
CREATE INDEX IF NOT EXISTS idx_rpt_customer_name ON razorpay_pos_transactions(customer_name) WHERE customer_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rpt_mid_code ON razorpay_pos_transactions(mid_code) WHERE mid_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rpt_issuing_bank ON razorpay_pos_transactions(issuing_bank) WHERE issuing_bank IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rpt_settlement_status ON razorpay_pos_transactions(settlement_status) WHERE settlement_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rpt_tid ON razorpay_pos_transactions(tid) WHERE tid IS NOT NULL;

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON COLUMN pos_transactions.customer_name IS 'Consumer/cardholder name from Razorpay POS';
COMMENT ON COLUMN pos_transactions.payer_name IS 'Payer name from Razorpay POS';
COMMENT ON COLUMN pos_transactions.username IS 'Operator/agent username who processed the transaction';
COMMENT ON COLUMN pos_transactions.txn_type IS 'Transaction type: CHARGE, REFUND, VOID etc.';
COMMENT ON COLUMN pos_transactions.auth_code IS 'Authorization code from card issuer';
COMMENT ON COLUMN pos_transactions.card_number IS 'Masked card number: e.g. 4862-69XX-XXXX-3667';
COMMENT ON COLUMN pos_transactions.issuing_bank IS 'Card issuing bank: HDFC, SBI, AXIS, ICICI, etc.';
COMMENT ON COLUMN pos_transactions.card_classification IS 'Card tier: PLATINUM, GOLD, STANDARD, BUSINESS, SIGNATURE, etc.';
COMMENT ON COLUMN pos_transactions.mid IS 'Merchant ID from Razorpay: e.g. IDZ551';
COMMENT ON COLUMN pos_transactions.currency IS 'Transaction currency: INR';
COMMENT ON COLUMN pos_transactions.settled_on IS 'Date/time when transaction was settled';
COMMENT ON COLUMN pos_transactions.receipt_url IS 'Customer receipt URL from Razorpay';
COMMENT ON COLUMN pos_transactions.posting_date IS 'Posting date from Razorpay POS';

-- ============================================================================
-- BACKFILL: Extract data from raw_payload/raw_data JSONB into new columns
-- This updates existing records with data already stored in the JSON payload
-- ============================================================================

-- Backfill pos_transactions from raw_payload
UPDATE pos_transactions SET
  customer_name = COALESCE(raw_payload->>'customerName', raw_payload->>'payerName'),
  payer_name = raw_payload->>'payerName',
  username = raw_payload->>'username',
  txn_type = COALESCE(raw_payload->>'txnType', 'CHARGE'),
  auth_code = raw_payload->>'authCode',
  card_number = COALESCE(raw_payload->>'cardNumber', raw_payload->>'maskedCardNumber', raw_payload->>'cardLastFourDigit'),
  issuing_bank = COALESCE(raw_payload->>'issuingBankName', raw_payload->>'bankName', raw_payload->>'issuingBank'),
  card_classification = COALESCE(raw_payload->>'cardClassification', raw_payload->>'cardCategory'),
  mid = COALESCE(raw_payload->>'mid', raw_payload->>'merchantId'),
  currency = COALESCE(raw_payload->>'currencyCode', raw_payload->>'currency', 'INR'),
  receipt_url = COALESCE(raw_payload->>'customerReceiptUrl', raw_payload->>'receiptUrl'),
  posting_date = CASE 
    WHEN raw_payload->>'postingDate' IS NOT NULL THEN (raw_payload->>'postingDate')::timestamptz 
    ELSE NULL 
  END
WHERE raw_payload IS NOT NULL AND customer_name IS NULL;

-- Backfill razorpay_pos_transactions from raw_data
UPDATE razorpay_pos_transactions SET
  customer_name = COALESCE(raw_data->>'customerName', raw_data->>'payerName'),
  payer_name = raw_data->>'payerName',
  username = raw_data->>'username',
  txn_type = COALESCE(raw_data->>'txnType', 'CHARGE'),
  auth_code = raw_data->>'authCode',
  card_number = COALESCE(raw_data->>'cardNumber', raw_data->>'maskedCardNumber', raw_data->>'cardLastFourDigit'),
  issuing_bank = COALESCE(raw_data->>'issuingBankName', raw_data->>'bankName', raw_data->>'issuingBank'),
  card_classification = COALESCE(raw_data->>'cardClassification', raw_data->>'cardCategory'),
  mid_code = COALESCE(raw_data->>'mid', raw_data->>'merchantId'),
  currency = COALESCE(raw_data->>'currencyCode', raw_data->>'currency', 'INR'),
  card_brand = COALESCE(raw_data->>'paymentCardBrand', raw_data->>'cardBrand'),
  card_type = COALESCE(raw_data->>'paymentCardType', raw_data->>'cardType'),
  rrn = COALESCE(raw_data->>'rrNumber', raw_data->>'rrn'),
  external_ref = raw_data->>'externalRefNumber',
  settlement_status = raw_data->>'settlementStatus',
  receipt_url = COALESCE(raw_data->>'customerReceiptUrl', raw_data->>'receiptUrl'),
  posting_date = CASE 
    WHEN raw_data->>'postingDate' IS NOT NULL THEN (raw_data->>'postingDate')::timestamptz 
    ELSE NULL 
  END
WHERE raw_data IS NOT NULL AND customer_name IS NULL;

