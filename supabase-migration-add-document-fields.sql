-- Migration: Add document fields for retailers, distributors, and master_distributors
-- Run this SQL in your Supabase SQL Editor

-- Add new columns to master_distributors table
ALTER TABLE master_distributors
ADD COLUMN IF NOT EXISTS aadhar_number TEXT,
ADD COLUMN IF NOT EXISTS aadhar_attachment_url TEXT,
ADD COLUMN IF NOT EXISTS pan_number TEXT,
ADD COLUMN IF NOT EXISTS pan_attachment_url TEXT,
ADD COLUMN IF NOT EXISTS udhyam_number TEXT,
ADD COLUMN IF NOT EXISTS udhyam_certificate_url TEXT,
ADD COLUMN IF NOT EXISTS gst_certificate_url TEXT;

-- Add new columns to distributors table
ALTER TABLE distributors
ADD COLUMN IF NOT EXISTS aadhar_number TEXT,
ADD COLUMN IF NOT EXISTS aadhar_attachment_url TEXT,
ADD COLUMN IF NOT EXISTS pan_number TEXT,
ADD COLUMN IF NOT EXISTS pan_attachment_url TEXT,
ADD COLUMN IF NOT EXISTS udhyam_number TEXT,
ADD COLUMN IF NOT EXISTS udhyam_certificate_url TEXT,
ADD COLUMN IF NOT EXISTS gst_certificate_url TEXT;

-- Add new columns to retailers table
ALTER TABLE retailers
ADD COLUMN IF NOT EXISTS aadhar_number TEXT,
ADD COLUMN IF NOT EXISTS aadhar_attachment_url TEXT,
ADD COLUMN IF NOT EXISTS pan_number TEXT,
ADD COLUMN IF NOT EXISTS pan_attachment_url TEXT,
ADD COLUMN IF NOT EXISTS udhyam_number TEXT,
ADD COLUMN IF NOT EXISTS udhyam_certificate_url TEXT,
ADD COLUMN IF NOT EXISTS gst_certificate_url TEXT;

-- Add comments for documentation
COMMENT ON COLUMN master_distributors.aadhar_number IS 'AADHAR number (mandatory)';
COMMENT ON COLUMN master_distributors.aadhar_attachment_url IS 'URL to AADHAR document attachment (mandatory)';
COMMENT ON COLUMN master_distributors.pan_number IS 'PAN number (mandatory)';
COMMENT ON COLUMN master_distributors.pan_attachment_url IS 'URL to PAN document attachment (mandatory)';
COMMENT ON COLUMN master_distributors.udhyam_number IS 'UDHYAM registration number (optional, but one of udhyam or gst required)';
COMMENT ON COLUMN master_distributors.udhyam_certificate_url IS 'URL to UDHYAM certificate attachment (optional)';
COMMENT ON COLUMN master_distributors.gst_certificate_url IS 'URL to GST certificate attachment (optional, but one of udhyam or gst required)';

COMMENT ON COLUMN distributors.aadhar_number IS 'AADHAR number (mandatory)';
COMMENT ON COLUMN distributors.aadhar_attachment_url IS 'URL to AADHAR document attachment (mandatory)';
COMMENT ON COLUMN distributors.pan_number IS 'PAN number (mandatory)';
COMMENT ON COLUMN distributors.pan_attachment_url IS 'URL to PAN document attachment (mandatory)';
COMMENT ON COLUMN distributors.udhyam_number IS 'UDHYAM registration number (optional, but one of udhyam or gst required)';
COMMENT ON COLUMN distributors.udhyam_certificate_url IS 'URL to UDHYAM certificate attachment (optional)';
COMMENT ON COLUMN distributors.gst_certificate_url IS 'URL to GST certificate attachment (optional, but one of udhyam or gst required)';

COMMENT ON COLUMN retailers.aadhar_number IS 'AADHAR number (mandatory)';
COMMENT ON COLUMN retailers.aadhar_attachment_url IS 'URL to AADHAR document attachment (mandatory)';
COMMENT ON COLUMN retailers.pan_number IS 'PAN number (mandatory)';
COMMENT ON COLUMN retailers.pan_attachment_url IS 'URL to PAN document attachment (mandatory)';
COMMENT ON COLUMN retailers.udhyam_number IS 'UDHYAM registration number (optional, but one of udhyam or gst required)';
COMMENT ON COLUMN retailers.udhyam_certificate_url IS 'URL to UDHYAM certificate attachment (optional)';
COMMENT ON COLUMN retailers.gst_certificate_url IS 'URL to GST certificate attachment (optional, but one of udhyam or gst required)';

