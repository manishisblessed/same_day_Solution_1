-- Migration: Add Government, Doorstep Banking, and Settlement service columns
-- to retailers, distributors, master_distributors, and partners tables

-- ============================================
-- RETAILERS
-- ============================================
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS government_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS doorstep_banking_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS settlement_enabled BOOLEAN NOT NULL DEFAULT false;

-- ============================================
-- DISTRIBUTORS
-- ============================================
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS government_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS doorstep_banking_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS settlement_enabled BOOLEAN NOT NULL DEFAULT false;

-- ============================================
-- MASTER DISTRIBUTORS
-- ============================================
ALTER TABLE master_distributors ADD COLUMN IF NOT EXISTS government_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE master_distributors ADD COLUMN IF NOT EXISTS doorstep_banking_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE master_distributors ADD COLUMN IF NOT EXISTS settlement_enabled BOOLEAN NOT NULL DEFAULT false;

-- ============================================
-- PARTNERS (government + doorstep_banking only; settlement_enabled already exists)
-- ============================================
ALTER TABLE partners ADD COLUMN IF NOT EXISTS government_enabled BOOLEAN DEFAULT false;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS doorstep_banking_enabled BOOLEAN DEFAULT false;
