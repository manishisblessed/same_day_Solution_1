-- Migration: Add bbps_type column to scheme_bbps_commissions
-- This allows differentiating between bbps_1 and bbps_2 charge types

ALTER TABLE scheme_bbps_commissions
ADD COLUMN IF NOT EXISTS bbps_type text NOT NULL DEFAULT 'bbps_1';

-- Add a check constraint for allowed values
ALTER TABLE scheme_bbps_commissions
ADD CONSTRAINT scheme_bbps_commissions_bbps_type_check
CHECK (bbps_type IN ('bbps_1', 'bbps_2'));

-- Add index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_scheme_bbps_commissions_bbps_type
ON scheme_bbps_commissions(bbps_type);
