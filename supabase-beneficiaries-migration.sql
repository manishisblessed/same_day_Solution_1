-- Migration: Add saved beneficiaries for retailers
-- Run this in Supabase SQL Editor

-- Create saved_beneficiaries table
CREATE TABLE IF NOT EXISTS saved_beneficiaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer_id TEXT NOT NULL REFERENCES retailers(partner_id) ON DELETE CASCADE,
  account_number TEXT NOT NULL,
  ifsc_code TEXT NOT NULL,
  account_holder_name TEXT NOT NULL,
  bank_id INTEGER,
  bank_name TEXT NOT NULL,
  beneficiary_mobile TEXT,
  nickname TEXT, -- Optional friendly name for the account
  is_verified BOOLEAN DEFAULT FALSE,
  is_default BOOLEAN DEFAULT FALSE, -- Mark as default account
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Unique constraint: One retailer can't have duplicate accounts
  UNIQUE(retailer_id, account_number, ifsc_code)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_saved_beneficiaries_retailer ON saved_beneficiaries(retailer_id);

-- Enable RLS
ALTER TABLE saved_beneficiaries ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
-- Allow retailers to see only their own beneficiaries
CREATE POLICY "Retailers can view own beneficiaries" ON saved_beneficiaries
  FOR SELECT USING (
    retailer_id IN (
      SELECT partner_id FROM retailers WHERE email = auth.jwt()->>'email'
    )
  );

-- Allow retailers to insert their own beneficiaries
CREATE POLICY "Retailers can insert own beneficiaries" ON saved_beneficiaries
  FOR INSERT WITH CHECK (
    retailer_id IN (
      SELECT partner_id FROM retailers WHERE email = auth.jwt()->>'email'
    )
  );

-- Allow retailers to update their own beneficiaries
CREATE POLICY "Retailers can update own beneficiaries" ON saved_beneficiaries
  FOR UPDATE USING (
    retailer_id IN (
      SELECT partner_id FROM retailers WHERE email = auth.jwt()->>'email'
    )
  );

-- Allow retailers to delete their own beneficiaries
CREATE POLICY "Retailers can delete own beneficiaries" ON saved_beneficiaries
  FOR DELETE USING (
    retailer_id IN (
      SELECT partner_id FROM retailers WHERE email = auth.jwt()->>'email'
    )
  );

-- Allow service role full access
CREATE POLICY "Service role has full access to beneficiaries" ON saved_beneficiaries
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- Grant permissions
GRANT ALL ON saved_beneficiaries TO authenticated;
GRANT ALL ON saved_beneficiaries TO service_role;

-- Add comment
COMMENT ON TABLE saved_beneficiaries IS 'Saved bank accounts for retailer payouts';

