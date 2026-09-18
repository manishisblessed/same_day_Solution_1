-- ============================================================================
-- AEPS KYC Verifications Migration
-- ============================================================================
-- Server-side trusted store of each AEPS KYC verification result (PAN, Aadhaar
-- via DigiLocker, and bank penny-drop), keyed by user_id (partner_id).
--
-- Purpose: merchant onboarding (/api/aeps/merchant/create) validates that the
-- PAN name, Aadhaar name and bank account-holder name all belong to the same
-- person using ONLY these server-verified values — so the check cannot be
-- bypassed by tampering with the client.
--
-- Names are written by the verify-* API routes when each step succeeds.
-- Idempotent + safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS aeps_kyc_verifications (
  user_id TEXT PRIMARY KEY,

  -- PAN (verify-pan360)
  pan TEXT,
  pan_name TEXT,
  pan_verified_at TIMESTAMPTZ,

  -- Aadhaar (fetch-digilocker-document)
  aadhaar_name TEXT,
  aadhaar_verification_id TEXT,
  aadhaar_verified_at TIMESTAMPTZ,

  -- Bank (verify-bank, penny drop) — account stored only as a salted hash.
  bank_account_hash TEXT,
  bank_ifsc TEXT,
  bank_account_name TEXT,
  bank_verified_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE aeps_kyc_verifications IS 'Trusted server-side AEPS KYC verification results used to enforce PAN=Aadhaar=Bank name match at merchant onboarding.';
