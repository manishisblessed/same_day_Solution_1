-- Migration: Add gst_inclusive, vendor_rate, company_mdr_rate to all scheme service config tables
-- Safe to run multiple times (uses IF NOT EXISTS)

-- ============================================================================
-- scheme_bbps_commissions
-- ============================================================================
ALTER TABLE scheme_bbps_commissions ADD COLUMN IF NOT EXISTS gst_inclusive BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE scheme_bbps_commissions ADD COLUMN IF NOT EXISTS vendor_rate NUMERIC(10,4) NOT NULL DEFAULT 0;
ALTER TABLE scheme_bbps_commissions ADD COLUMN IF NOT EXISTS company_mdr_rate NUMERIC(10,4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN scheme_bbps_commissions.gst_inclusive IS 'Whether the rates already include GST';
COMMENT ON COLUMN scheme_bbps_commissions.vendor_rate IS 'Rate charged by the upstream vendor/API provider';
COMMENT ON COLUMN scheme_bbps_commissions.company_mdr_rate IS 'MDR rate retained by the company after vendor deduction';

-- ============================================================================
-- scheme_payout_charges
-- ============================================================================
ALTER TABLE scheme_payout_charges ADD COLUMN IF NOT EXISTS gst_inclusive BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE scheme_payout_charges ADD COLUMN IF NOT EXISTS vendor_rate NUMERIC(10,4) NOT NULL DEFAULT 0;
ALTER TABLE scheme_payout_charges ADD COLUMN IF NOT EXISTS company_mdr_rate NUMERIC(10,4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN scheme_payout_charges.gst_inclusive IS 'Whether the rates already include GST';
COMMENT ON COLUMN scheme_payout_charges.vendor_rate IS 'Rate charged by the upstream vendor/API provider';
COMMENT ON COLUMN scheme_payout_charges.company_mdr_rate IS 'MDR rate retained by the company after vendor deduction';

-- ============================================================================
-- scheme_mdr_rates
-- ============================================================================
ALTER TABLE scheme_mdr_rates ADD COLUMN IF NOT EXISTS gst_inclusive BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE scheme_mdr_rates ADD COLUMN IF NOT EXISTS vendor_rate NUMERIC(10,4) NOT NULL DEFAULT 0;
ALTER TABLE scheme_mdr_rates ADD COLUMN IF NOT EXISTS company_mdr_rate NUMERIC(10,4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN scheme_mdr_rates.gst_inclusive IS 'Whether the rates already include GST';
COMMENT ON COLUMN scheme_mdr_rates.vendor_rate IS 'Rate charged by the upstream vendor/API provider';
COMMENT ON COLUMN scheme_mdr_rates.company_mdr_rate IS 'MDR rate retained by the company after vendor deduction';

-- ============================================================================
-- scheme_aeps_commissions
-- ============================================================================
ALTER TABLE scheme_aeps_commissions ADD COLUMN IF NOT EXISTS gst_inclusive BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE scheme_aeps_commissions ADD COLUMN IF NOT EXISTS vendor_rate NUMERIC(10,4) NOT NULL DEFAULT 0;
ALTER TABLE scheme_aeps_commissions ADD COLUMN IF NOT EXISTS company_mdr_rate NUMERIC(10,4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN scheme_aeps_commissions.gst_inclusive IS 'Whether the rates already include GST';
COMMENT ON COLUMN scheme_aeps_commissions.vendor_rate IS 'Rate charged by the upstream vendor/API provider';
COMMENT ON COLUMN scheme_aeps_commissions.company_mdr_rate IS 'MDR rate retained by the company after vendor deduction';

-- ============================================================================
-- scheme_aeps_settlement_charges
-- ============================================================================
ALTER TABLE scheme_aeps_settlement_charges ADD COLUMN IF NOT EXISTS gst_inclusive BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE scheme_aeps_settlement_charges ADD COLUMN IF NOT EXISTS vendor_rate NUMERIC(10,4) NOT NULL DEFAULT 0;
ALTER TABLE scheme_aeps_settlement_charges ADD COLUMN IF NOT EXISTS company_mdr_rate NUMERIC(10,4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN scheme_aeps_settlement_charges.gst_inclusive IS 'Whether the rates already include GST';
COMMENT ON COLUMN scheme_aeps_settlement_charges.vendor_rate IS 'Rate charged by the upstream vendor/API provider';
COMMENT ON COLUMN scheme_aeps_settlement_charges.company_mdr_rate IS 'MDR rate retained by the company after vendor deduction';

-- ============================================================================
-- scheme_shadval_settlement_charges
-- ============================================================================
ALTER TABLE scheme_shadval_settlement_charges ADD COLUMN IF NOT EXISTS gst_inclusive BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE scheme_shadval_settlement_charges ADD COLUMN IF NOT EXISTS vendor_rate NUMERIC(10,4) NOT NULL DEFAULT 0;
ALTER TABLE scheme_shadval_settlement_charges ADD COLUMN IF NOT EXISTS company_mdr_rate NUMERIC(10,4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN scheme_shadval_settlement_charges.gst_inclusive IS 'Whether the rates already include GST';
COMMENT ON COLUMN scheme_shadval_settlement_charges.vendor_rate IS 'Rate charged by the upstream vendor/API provider';
COMMENT ON COLUMN scheme_shadval_settlement_charges.company_mdr_rate IS 'MDR rate retained by the company after vendor deduction';
