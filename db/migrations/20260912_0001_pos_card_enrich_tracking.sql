-- Attempt-tracking for Paytm ECR card-detail enrichment (status-enquiry backfill).
-- Lets the enrichment worker back off per row and give up after N attempts,
-- so rows Paytm never returns card data for don't get retried forever.

ALTER TABLE razorpay_pos_transactions
  ADD COLUMN IF NOT EXISTS card_enrich_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE razorpay_pos_transactions
  ADD COLUMN IF NOT EXISTS card_enrich_last_at timestamptz;
