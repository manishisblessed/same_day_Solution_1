-- Migration: Add service enabled columns to partners table
-- This allows admin to control which services are available to each partner

-- Add service enabled columns to partners table (matching retailers/distributors/master_distributors)
ALTER TABLE partners 
ADD COLUMN IF NOT EXISTS banking_payments_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS mini_atm_pos_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS aeps_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS aadhaar_pay_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS dmt_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS bbps_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS recharge_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS travel_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS cash_management_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS lic_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS insurance_enabled BOOLEAN DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN partners.banking_payments_enabled IS 'Enable Banking Payments service for this partner';
COMMENT ON COLUMN partners.mini_atm_pos_enabled IS 'Enable Mini ATM / POS service for this partner';
COMMENT ON COLUMN partners.aeps_enabled IS 'Enable AEPS service for this partner';
COMMENT ON COLUMN partners.aadhaar_pay_enabled IS 'Enable Aadhaar Pay service for this partner';
COMMENT ON COLUMN partners.dmt_enabled IS 'Enable DMT (Direct Money Transfer) service for this partner';
COMMENT ON COLUMN partners.bbps_enabled IS 'Enable BBPS (Bharat Bill Payment System) service for this partner';
COMMENT ON COLUMN partners.recharge_enabled IS 'Enable Mobile/DTH Recharge service for this partner';
COMMENT ON COLUMN partners.travel_enabled IS 'Enable Travel Booking service for this partner';
COMMENT ON COLUMN partners.cash_management_enabled IS 'Enable Cash Management service for this partner';
COMMENT ON COLUMN partners.lic_enabled IS 'Enable LIC Premium service for this partner';
COMMENT ON COLUMN partners.insurance_enabled IS 'Enable Insurance service for this partner';

-- Optionally enable mini_atm_pos for all existing active partners
-- Uncomment the following line to enable it:
-- UPDATE partners SET mini_atm_pos_enabled = true WHERE status = 'active';
