-- ============================================================================
-- Add billing_day to subscriptions so each subscription can bill on a
-- specific day of the month (1-28). Run AFTER previous subscription migrations.
-- ============================================================================

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS billing_day INT DEFAULT 1
  CHECK (billing_day >= 1 AND billing_day <= 28);

-- Back-fill existing rows from next_billing_date day
UPDATE subscriptions
SET billing_day = EXTRACT(DAY FROM next_billing_date)::INT
WHERE billing_day IS NULL OR billing_day = 1;
