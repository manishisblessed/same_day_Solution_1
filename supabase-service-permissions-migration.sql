-- Service Permission Control Migration
-- Adds all service enable/disable columns to retailers, distributors, and master_distributors
-- Default: false (services disabled until explicitly enabled by admin)

-- ============================================
-- RETAILERS
-- ============================================
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS banking_payments_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS mini_atm_pos_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS aeps_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS aadhaar_pay_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS dmt_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS bbps_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS recharge_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS travel_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS cash_management_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS lic_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS insurance_enabled BOOLEAN NOT NULL DEFAULT false;

-- ============================================
-- DISTRIBUTORS
-- ============================================
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS banking_payments_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS mini_atm_pos_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS aeps_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS aadhaar_pay_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS dmt_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS bbps_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS recharge_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS travel_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS cash_management_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS lic_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS insurance_enabled BOOLEAN NOT NULL DEFAULT false;

-- ============================================
-- MASTER DISTRIBUTORS
-- ============================================
ALTER TABLE master_distributors ADD COLUMN IF NOT EXISTS banking_payments_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE master_distributors ADD COLUMN IF NOT EXISTS mini_atm_pos_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE master_distributors ADD COLUMN IF NOT EXISTS aeps_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE master_distributors ADD COLUMN IF NOT EXISTS aadhaar_pay_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE master_distributors ADD COLUMN IF NOT EXISTS dmt_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE master_distributors ADD COLUMN IF NOT EXISTS bbps_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE master_distributors ADD COLUMN IF NOT EXISTS recharge_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE master_distributors ADD COLUMN IF NOT EXISTS travel_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE master_distributors ADD COLUMN IF NOT EXISTS cash_management_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE master_distributors ADD COLUMN IF NOT EXISTS lic_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE master_distributors ADD COLUMN IF NOT EXISTS insurance_enabled BOOLEAN NOT NULL DEFAULT false;

-- ============================================
-- INDEXES for fast filtering
-- ============================================
CREATE INDEX IF NOT EXISTS idx_retailers_aeps_enabled ON retailers (aeps_enabled);
CREATE INDEX IF NOT EXISTS idx_retailers_bbps_enabled ON retailers (bbps_enabled);
CREATE INDEX IF NOT EXISTS idx_retailers_dmt_enabled ON retailers (dmt_enabled);
CREATE INDEX IF NOT EXISTS idx_retailers_mini_atm_pos_enabled ON retailers (mini_atm_pos_enabled);
CREATE INDEX IF NOT EXISTS idx_distributors_aeps_enabled ON distributors (aeps_enabled);
CREATE INDEX IF NOT EXISTS idx_distributors_bbps_enabled ON distributors (bbps_enabled);
CREATE INDEX IF NOT EXISTS idx_distributors_dmt_enabled ON distributors (dmt_enabled);
CREATE INDEX IF NOT EXISTS idx_master_distributors_aeps_enabled ON master_distributors (aeps_enabled);
CREATE INDEX IF NOT EXISTS idx_master_distributors_bbps_enabled ON master_distributors (bbps_enabled);
CREATE INDEX IF NOT EXISTS idx_master_distributors_dmt_enabled ON master_distributors (dmt_enabled);
