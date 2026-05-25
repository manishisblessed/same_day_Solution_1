-- Migration: Add eKYC Hub API verification fields
-- Run this SQL in your Supabase SQL Editor
--
-- These fields store API-verified data from eKYC Hub (connect.ekychub.in)
-- replacing the need for manual document uploads.

-- ============================================================================
-- MASTER DISTRIBUTORS
-- ============================================================================
ALTER TABLE master_distributors
ADD COLUMN IF NOT EXISTS pan_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS pan_registered_name TEXT,
ADD COLUMN IF NOT EXISTS pan_type TEXT,
ADD COLUMN IF NOT EXISTS pan_verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS bank_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS bank_verified_name TEXT,
ADD COLUMN IF NOT EXISTS bank_utr TEXT,
ADD COLUMN IF NOT EXISTS bank_branch TEXT,
ADD COLUMN IF NOT EXISTS bank_city TEXT,
ADD COLUMN IF NOT EXISTS bank_verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS gst_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS gst_legal_name TEXT,
ADD COLUMN IF NOT EXISTS gst_trade_name TEXT,
ADD COLUMN IF NOT EXISTS gst_status TEXT,
ADD COLUMN IF NOT EXISTS gst_taxpayer_type TEXT,
ADD COLUMN IF NOT EXISTS gst_constitution TEXT,
ADD COLUMN IF NOT EXISTS gst_address TEXT,
ADD COLUMN IF NOT EXISTS gst_verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS cin_number TEXT,
ADD COLUMN IF NOT EXISTS cin_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS cin_company_name TEXT,
ADD COLUMN IF NOT EXISTS cin_status TEXT,
ADD COLUMN IF NOT EXISTS cin_incorporation_date TEXT,
ADD COLUMN IF NOT EXISTS aadhaar_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS aadhaar_name TEXT,
ADD COLUMN IF NOT EXISTS aadhaar_dob TEXT,
ADD COLUMN IF NOT EXISTS aadhaar_gender TEXT,
ADD COLUMN IF NOT EXISTS aadhaar_address TEXT,
ADD COLUMN IF NOT EXISTS aadhaar_uid TEXT,
ADD COLUMN IF NOT EXISTS digilocker_verification_id TEXT,
ADD COLUMN IF NOT EXISTS ekychub_order_ids JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS auto_verification_score INTEGER DEFAULT 0;

-- ============================================================================
-- DISTRIBUTORS
-- ============================================================================
ALTER TABLE distributors
ADD COLUMN IF NOT EXISTS pan_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS pan_registered_name TEXT,
ADD COLUMN IF NOT EXISTS pan_type TEXT,
ADD COLUMN IF NOT EXISTS pan_verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS bank_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS bank_verified_name TEXT,
ADD COLUMN IF NOT EXISTS bank_utr TEXT,
ADD COLUMN IF NOT EXISTS bank_branch TEXT,
ADD COLUMN IF NOT EXISTS bank_city TEXT,
ADD COLUMN IF NOT EXISTS bank_verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS gst_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS gst_legal_name TEXT,
ADD COLUMN IF NOT EXISTS gst_trade_name TEXT,
ADD COLUMN IF NOT EXISTS gst_status TEXT,
ADD COLUMN IF NOT EXISTS gst_taxpayer_type TEXT,
ADD COLUMN IF NOT EXISTS gst_constitution TEXT,
ADD COLUMN IF NOT EXISTS gst_address TEXT,
ADD COLUMN IF NOT EXISTS gst_verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS cin_number TEXT,
ADD COLUMN IF NOT EXISTS cin_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS cin_company_name TEXT,
ADD COLUMN IF NOT EXISTS cin_status TEXT,
ADD COLUMN IF NOT EXISTS cin_incorporation_date TEXT,
ADD COLUMN IF NOT EXISTS aadhaar_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS aadhaar_name TEXT,
ADD COLUMN IF NOT EXISTS aadhaar_dob TEXT,
ADD COLUMN IF NOT EXISTS aadhaar_gender TEXT,
ADD COLUMN IF NOT EXISTS aadhaar_address TEXT,
ADD COLUMN IF NOT EXISTS aadhaar_uid TEXT,
ADD COLUMN IF NOT EXISTS digilocker_verification_id TEXT,
ADD COLUMN IF NOT EXISTS ekychub_order_ids JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS auto_verification_score INTEGER DEFAULT 0;

-- ============================================================================
-- RETAILERS
-- ============================================================================
ALTER TABLE retailers
ADD COLUMN IF NOT EXISTS pan_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS pan_registered_name TEXT,
ADD COLUMN IF NOT EXISTS pan_type TEXT,
ADD COLUMN IF NOT EXISTS pan_verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS bank_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS bank_verified_name TEXT,
ADD COLUMN IF NOT EXISTS bank_utr TEXT,
ADD COLUMN IF NOT EXISTS bank_branch TEXT,
ADD COLUMN IF NOT EXISTS bank_city TEXT,
ADD COLUMN IF NOT EXISTS bank_verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS gst_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS gst_legal_name TEXT,
ADD COLUMN IF NOT EXISTS gst_trade_name TEXT,
ADD COLUMN IF NOT EXISTS gst_status TEXT,
ADD COLUMN IF NOT EXISTS gst_taxpayer_type TEXT,
ADD COLUMN IF NOT EXISTS gst_constitution TEXT,
ADD COLUMN IF NOT EXISTS gst_address TEXT,
ADD COLUMN IF NOT EXISTS gst_verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS cin_number TEXT,
ADD COLUMN IF NOT EXISTS cin_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS cin_company_name TEXT,
ADD COLUMN IF NOT EXISTS cin_status TEXT,
ADD COLUMN IF NOT EXISTS cin_incorporation_date TEXT,
ADD COLUMN IF NOT EXISTS aadhaar_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS aadhaar_name TEXT,
ADD COLUMN IF NOT EXISTS aadhaar_dob TEXT,
ADD COLUMN IF NOT EXISTS aadhaar_gender TEXT,
ADD COLUMN IF NOT EXISTS aadhaar_address TEXT,
ADD COLUMN IF NOT EXISTS aadhaar_uid TEXT,
ADD COLUMN IF NOT EXISTS digilocker_verification_id TEXT,
ADD COLUMN IF NOT EXISTS ekychub_order_ids JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS auto_verification_score INTEGER DEFAULT 0;

-- ============================================================================
-- PARTNERS
-- ============================================================================
ALTER TABLE partners
ADD COLUMN IF NOT EXISTS pan_number TEXT,
ADD COLUMN IF NOT EXISTS pan_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS pan_registered_name TEXT,
ADD COLUMN IF NOT EXISTS pan_type TEXT,
ADD COLUMN IF NOT EXISTS pan_verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS bank_name TEXT,
ADD COLUMN IF NOT EXISTS account_number TEXT,
ADD COLUMN IF NOT EXISTS ifsc_code TEXT,
ADD COLUMN IF NOT EXISTS bank_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS bank_verified_name TEXT,
ADD COLUMN IF NOT EXISTS bank_utr TEXT,
ADD COLUMN IF NOT EXISTS bank_branch TEXT,
ADD COLUMN IF NOT EXISTS bank_city TEXT,
ADD COLUMN IF NOT EXISTS bank_verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS aadhar_number TEXT,
ADD COLUMN IF NOT EXISTS gst_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS gst_legal_name TEXT,
ADD COLUMN IF NOT EXISTS gst_trade_name TEXT,
ADD COLUMN IF NOT EXISTS gst_status TEXT,
ADD COLUMN IF NOT EXISTS gst_taxpayer_type TEXT,
ADD COLUMN IF NOT EXISTS gst_constitution TEXT,
ADD COLUMN IF NOT EXISTS gst_address TEXT,
ADD COLUMN IF NOT EXISTS gst_verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS cin_number TEXT,
ADD COLUMN IF NOT EXISTS cin_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS cin_company_name TEXT,
ADD COLUMN IF NOT EXISTS cin_status TEXT,
ADD COLUMN IF NOT EXISTS cin_incorporation_date TEXT,
ADD COLUMN IF NOT EXISTS udhyam_number TEXT,
ADD COLUMN IF NOT EXISTS aadhaar_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS aadhaar_name TEXT,
ADD COLUMN IF NOT EXISTS aadhaar_dob TEXT,
ADD COLUMN IF NOT EXISTS aadhaar_gender TEXT,
ADD COLUMN IF NOT EXISTS aadhaar_address TEXT,
ADD COLUMN IF NOT EXISTS aadhaar_uid TEXT,
ADD COLUMN IF NOT EXISTS digilocker_verification_id TEXT,
ADD COLUMN IF NOT EXISTS ekychub_order_ids JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS auto_verification_score INTEGER DEFAULT 0;

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON COLUMN master_distributors.pan_verified IS 'Whether PAN was verified via eKYC Hub API';
COMMENT ON COLUMN master_distributors.pan_registered_name IS 'Name registered with PAN from API';
COMMENT ON COLUMN master_distributors.pan_type IS 'PAN type: Individual, Company, etc.';
COMMENT ON COLUMN master_distributors.bank_verified IS 'Whether bank account was verified via eKYC Hub API';
COMMENT ON COLUMN master_distributors.bank_verified_name IS 'Account holder name from bank verification API';
COMMENT ON COLUMN master_distributors.bank_utr IS 'UTR from bank verification';
COMMENT ON COLUMN master_distributors.gst_verified IS 'Whether GST was verified via eKYC Hub API';
COMMENT ON COLUMN master_distributors.gst_legal_name IS 'Legal business name from GST verification';
COMMENT ON COLUMN master_distributors.gst_trade_name IS 'Trade name from GST verification';
COMMENT ON COLUMN master_distributors.gst_status IS 'GST status: Active, Inactive, etc.';
COMMENT ON COLUMN master_distributors.cin_verified IS 'Whether CIN was verified via eKYC Hub API';
COMMENT ON COLUMN master_distributors.cin_company_name IS 'Company name from CIN verification';
COMMENT ON COLUMN master_distributors.aadhaar_verified IS 'Whether Aadhaar was verified via Digilocker';
COMMENT ON COLUMN master_distributors.aadhaar_name IS 'Name from Aadhaar Digilocker verification';
COMMENT ON COLUMN master_distributors.aadhaar_uid IS 'Aadhaar UID from Digilocker verification';
COMMENT ON COLUMN master_distributors.digilocker_verification_id IS 'Digilocker verification ID for audit';
COMMENT ON COLUMN master_distributors.ekychub_order_ids IS 'JSON of eKYC Hub order IDs used for audit trail';
COMMENT ON COLUMN master_distributors.auto_verification_score IS 'Score 0-100 based on how many verifications passed';
