-- Razorpay POS multi-company: add merchant_slug to razorpay_pos_transactions
-- Companies: ashvam (base URL), teachway, newscenaric, lagoon

ALTER TABLE razorpay_pos_transactions ADD COLUMN IF NOT EXISTS merchant_slug TEXT;

CREATE INDEX IF NOT EXISTS idx_razorpay_pos_transactions_merchant_slug
  ON razorpay_pos_transactions(merchant_slug)
  WHERE merchant_slug IS NOT NULL;

COMMENT ON COLUMN razorpay_pos_transactions.merchant_slug IS 'Company identifier: ashvam (base URL), teachway, newscenaric, lagoon. NULL = legacy/ashvam.';
