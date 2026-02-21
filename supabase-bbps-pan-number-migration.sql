-- Add PAN number column to bbps_transactions
-- Required for payments exceeding ₹49,999 as per RBI/BBPS compliance

ALTER TABLE bbps_transactions
ADD COLUMN IF NOT EXISTS pan_number TEXT;

COMMENT ON COLUMN bbps_transactions.pan_number IS 'PAN number of the payer, required for transactions above ₹49,999';

-- Index for audit queries on PAN-based transactions
CREATE INDEX IF NOT EXISTS idx_bbps_transactions_pan
ON bbps_transactions(pan_number)
WHERE pan_number IS NOT NULL;
