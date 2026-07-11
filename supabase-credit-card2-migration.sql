-- Migration: Add credit_card2_enabled (Credit Card-2 / Rechargekit)
-- Independent from Credit Card (Pay2New / BBPS) so admin can enable/disable separately.

-- RETAILERS
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS credit_card2_enabled BOOLEAN NOT NULL DEFAULT false;

-- DISTRIBUTORS
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS credit_card2_enabled BOOLEAN NOT NULL DEFAULT false;

-- MASTER DISTRIBUTORS
ALTER TABLE master_distributors ADD COLUMN IF NOT EXISTS credit_card2_enabled BOOLEAN NOT NULL DEFAULT false;

-- PARTNERS
ALTER TABLE partners ADD COLUMN IF NOT EXISTS credit_card2_enabled BOOLEAN NOT NULL DEFAULT false;

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_retailers_credit_card2_enabled ON retailers (credit_card2_enabled);
CREATE INDEX IF NOT EXISTS idx_distributors_credit_card2_enabled ON distributors (credit_card2_enabled);
CREATE INDEX IF NOT EXISTS idx_master_distributors_credit_card2_enabled ON master_distributors (credit_card2_enabled);
CREATE INDEX IF NOT EXISTS idx_partners_credit_card2_enabled ON partners (credit_card2_enabled);
