-- ============================================================================
-- PARTNER / MASTER PARTNER ONBOARDING (FULL KYC) MIGRATION
-- ============================================================================
-- Enables the existing onboarding-invite KYC wizard (PAN 360, Aadhaar DigiLocker,
-- bank penny-drop, selfie, liveness video, documents, self-declaration) to create
-- rows in the `partners` table for the `partner` and `master_partner` target roles.
--
-- The wizard's register step writes a rich set of verified-KYC columns and uses
-- status 'pending_verification' until an admin approves. The partners table was
-- built for API integrators and lacks those columns + that status value, so we
-- add them here (all nullable; existing rows are unaffected).
--
-- Run in Supabase SQL Editor (or via the repo migration runner).
-- ============================================================================

-- 0) Allow inviting partner / master_partner through the onboarding wizard.
ALTER TABLE onboarding_invites DROP CONSTRAINT IF EXISTS onboarding_invites_target_role_check;
ALTER TABLE onboarding_invites ADD CONSTRAINT onboarding_invites_target_role_check
  CHECK (target_role IN ('master_distributor', 'distributor', 'retailer', 'partner', 'master_partner'));

-- 1) Allow the KYC "pending_verification" lifecycle state on partners.
ALTER TABLE partners DROP CONSTRAINT IF EXISTS partners_status_check;
ALTER TABLE partners ADD CONSTRAINT partners_status_check
  CHECK (status IN ('active', 'inactive', 'suspended', 'pending_verification'));

-- 2) Verification lifecycle
ALTER TABLE partners ADD COLUMN IF NOT EXISTS verification_status TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS verified_by TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS auto_verification_score INTEGER;

-- 3) PAN (eKYC Hub / PAN 360)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS pan_verified BOOLEAN DEFAULT false;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS pan_registered_name TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS pan_type TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS pan_verified_at TIMESTAMPTZ;

-- 4) Aadhaar (DigiLocker)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS aadhar_number TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS aadhaar_verified BOOLEAN DEFAULT false;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS aadhaar_name TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS aadhaar_dob TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS aadhaar_gender TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS aadhaar_address TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS aadhaar_uid TEXT;

-- 5) Bank (penny-drop)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS account_number TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS ifsc_code TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS bank_verified BOOLEAN DEFAULT false;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS bank_verified_name TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS bank_utr TEXT;

-- 6) GST (optional in wizard)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS gst_verified BOOLEAN DEFAULT false;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS gst_legal_name TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS gst_trade_name TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS gst_status TEXT;

COMMENT ON COLUMN partners.verification_status IS
  'KYC review state set by the onboarding wizard (pending) and admin approval (approved/rejected).';
