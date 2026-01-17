-- Migration: Add bank account fields for retailers, distributors, and master_distributors
-- Run this SQL in your Supabase SQL Editor
-- 
-- This migration adds mandatory bank account details:
-- - bank_name: Bank name (mandatory)
-- - account_number: Bank account number (mandatory)
-- - ifsc_code: IFSC code (mandatory)
-- - bank_document_url: URL to passbook or cheque attachment (mandatory)
--
-- Note: Udyam and GST fields already exist from previous migration

-- Add new columns to master_distributors table
ALTER TABLE master_distributors
ADD COLUMN IF NOT EXISTS bank_name TEXT,
ADD COLUMN IF NOT EXISTS account_number TEXT,
ADD COLUMN IF NOT EXISTS ifsc_code TEXT,
ADD COLUMN IF NOT EXISTS bank_document_url TEXT;

-- Add new columns to distributors table
ALTER TABLE distributors
ADD COLUMN IF NOT EXISTS bank_name TEXT,
ADD COLUMN IF NOT EXISTS account_number TEXT,
ADD COLUMN IF NOT EXISTS ifsc_code TEXT,
ADD COLUMN IF NOT EXISTS bank_document_url TEXT;

-- Add new columns to retailers table
ALTER TABLE retailers
ADD COLUMN IF NOT EXISTS bank_name TEXT,
ADD COLUMN IF NOT EXISTS account_number TEXT,
ADD COLUMN IF NOT EXISTS ifsc_code TEXT,
ADD COLUMN IF NOT EXISTS bank_document_url TEXT;

-- Add comments for documentation
COMMENT ON COLUMN master_distributors.bank_name IS 'Bank name (mandatory)';
COMMENT ON COLUMN master_distributors.account_number IS 'Bank account number (mandatory)';
COMMENT ON COLUMN master_distributors.ifsc_code IS 'IFSC code (mandatory)';
COMMENT ON COLUMN master_distributors.bank_document_url IS 'URL to passbook or cheque attachment (mandatory)';

COMMENT ON COLUMN distributors.bank_name IS 'Bank name (mandatory)';
COMMENT ON COLUMN distributors.account_number IS 'Bank account number (mandatory)';
COMMENT ON COLUMN distributors.ifsc_code IS 'IFSC code (mandatory)';
COMMENT ON COLUMN distributors.bank_document_url IS 'URL to passbook or cheque attachment (mandatory)';

COMMENT ON COLUMN retailers.bank_name IS 'Bank name (mandatory)';
COMMENT ON COLUMN retailers.account_number IS 'Bank account number (mandatory)';
COMMENT ON COLUMN retailers.ifsc_code IS 'IFSC code (mandatory)';
COMMENT ON COLUMN retailers.bank_document_url IS 'URL to passbook or cheque attachment (mandatory)';

