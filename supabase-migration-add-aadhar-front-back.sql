-- Migration: Add AADHAR Front and Back URL columns
-- Run this SQL in your Supabase SQL Editor
-- This replaces the single aadhar_attachment_url with separate front and back URLs

-- Add new columns to master_distributors table
ALTER TABLE master_distributors
ADD COLUMN IF NOT EXISTS aadhar_front_url TEXT,
ADD COLUMN IF NOT EXISTS aadhar_back_url TEXT;

-- Add new columns to distributors table
ALTER TABLE distributors
ADD COLUMN IF NOT EXISTS aadhar_front_url TEXT,
ADD COLUMN IF NOT EXISTS aadhar_back_url TEXT;

-- Add new columns to retailers table
ALTER TABLE retailers
ADD COLUMN IF NOT EXISTS aadhar_front_url TEXT,
ADD COLUMN IF NOT EXISTS aadhar_back_url TEXT;

-- Add comments for documentation
COMMENT ON COLUMN master_distributors.aadhar_front_url IS 'URL to AADHAR front side document (mandatory)';
COMMENT ON COLUMN master_distributors.aadhar_back_url IS 'URL to AADHAR back side document (mandatory)';
COMMENT ON COLUMN distributors.aadhar_front_url IS 'URL to AADHAR front side document (mandatory)';
COMMENT ON COLUMN distributors.aadhar_back_url IS 'URL to AADHAR back side document (mandatory)';
COMMENT ON COLUMN retailers.aadhar_front_url IS 'URL to AADHAR front side document (mandatory)';
COMMENT ON COLUMN retailers.aadhar_back_url IS 'URL to AADHAR back side document (mandatory)';

-- Note: The old aadhar_attachment_url column is kept for backward compatibility
-- You can migrate existing data if needed:
-- UPDATE retailers SET aadhar_front_url = aadhar_attachment_url WHERE aadhar_attachment_url IS NOT NULL AND aadhar_front_url IS NULL;
-- UPDATE distributors SET aadhar_front_url = aadhar_attachment_url WHERE aadhar_attachment_url IS NOT NULL AND aadhar_front_url IS NULL;
-- UPDATE master_distributors SET aadhar_front_url = aadhar_attachment_url WHERE aadhar_attachment_url IS NOT NULL AND aadhar_front_url IS NULL;













