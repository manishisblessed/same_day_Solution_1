-- Migration: Add pending_verification status for partner verification workflow
-- Run this SQL in your Supabase SQL Editor

-- Update master_distributors table
ALTER TABLE master_distributors
DROP CONSTRAINT IF EXISTS master_distributors_status_check;

ALTER TABLE master_distributors
ADD CONSTRAINT master_distributors_status_check 
CHECK (status IN ('active', 'inactive', 'suspended', 'pending_verification'));

-- Update distributors table
ALTER TABLE distributors
DROP CONSTRAINT IF EXISTS distributors_status_check;

ALTER TABLE distributors
ADD CONSTRAINT distributors_status_check 
CHECK (status IN ('active', 'inactive', 'suspended', 'pending_verification'));

-- Update retailers table
ALTER TABLE retailers
DROP CONSTRAINT IF EXISTS retailers_status_check;

ALTER TABLE retailers
ADD CONSTRAINT retailers_status_check 
CHECK (status IN ('active', 'inactive', 'suspended', 'pending_verification'));

-- Add verification fields (optional - to track verification details)
ALTER TABLE master_distributors
ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS verified_by UUID;

ALTER TABLE distributors
ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS verified_by UUID;

ALTER TABLE retailers
ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS verified_by UUID;

-- Add comments
COMMENT ON COLUMN master_distributors.verification_status IS 'pending, approved, rejected';
COMMENT ON COLUMN master_distributors.verified_at IS 'Timestamp when verification was completed';
COMMENT ON COLUMN master_distributors.verified_by IS 'Admin user ID who verified';

COMMENT ON COLUMN distributors.verification_status IS 'pending, approved, rejected';
COMMENT ON COLUMN distributors.verified_at IS 'Timestamp when verification was completed';
COMMENT ON COLUMN distributors.verified_by IS 'Admin user ID who verified';

COMMENT ON COLUMN retailers.verification_status IS 'pending, approved, rejected';
COMMENT ON COLUMN retailers.verified_at IS 'Timestamp when verification was completed';
COMMENT ON COLUMN retailers.verified_by IS 'Admin user ID who verified';

