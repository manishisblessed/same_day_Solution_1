-- API Payment (POS card sale via ECR) service permission flag.
-- One boolean column per role table, matching the existing service-permission pattern.
-- Disabled by default: the retailer-facing "API Payment" tab only appears once an admin enables it.

ALTER TABLE retailers            ADD COLUMN IF NOT EXISTS api_payment_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE distributors         ADD COLUMN IF NOT EXISTS api_payment_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE master_distributors  ADD COLUMN IF NOT EXISTS api_payment_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE partners             ADD COLUMN IF NOT EXISTS api_payment_enabled BOOLEAN NOT NULL DEFAULT false;
