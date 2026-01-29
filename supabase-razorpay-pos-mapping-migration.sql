-- Razorpay POS Device Mapping - Phase 2 (Role-Based Visibility)
-- This migration creates a NEW table for POS device mapping to enable role-based transaction visibility
-- DO NOT modify existing razorpay_pos_transactions table or any other existing tables

-- Create new table for POS device mapping
CREATE TABLE IF NOT EXISTS pos_device_mapping (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_serial TEXT UNIQUE NOT NULL, -- Device serial number from Razorpay (matches razorpay_pos_transactions.device_serial)
  tid TEXT, -- Terminal ID (optional, for reference)
  retailer_id TEXT,
  distributor_id TEXT,
  master_distributor_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_pos_device_mapping_device_serial ON pos_device_mapping(device_serial);
CREATE INDEX IF NOT EXISTS idx_pos_device_mapping_retailer_id ON pos_device_mapping(retailer_id);
CREATE INDEX IF NOT EXISTS idx_pos_device_mapping_distributor_id ON pos_device_mapping(distributor_id);
CREATE INDEX IF NOT EXISTS idx_pos_device_mapping_master_distributor_id ON pos_device_mapping(master_distributor_id);
CREATE INDEX IF NOT EXISTS idx_pos_device_mapping_status ON pos_device_mapping(status);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_pos_device_mapping_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_pos_device_mapping_updated_at_trigger ON pos_device_mapping;
CREATE TRIGGER update_pos_device_mapping_updated_at_trigger
  BEFORE UPDATE ON pos_device_mapping
  FOR EACH ROW
  EXECUTE FUNCTION update_pos_device_mapping_updated_at();

-- Enable RLS (Row Level Security)
ALTER TABLE pos_device_mapping ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Only admins can read/write (API routes use service role key, so RLS is bypassed there)
-- But we set it up for future security if needed
DROP POLICY IF EXISTS "Admins can manage pos_device_mapping" ON pos_device_mapping;
CREATE POLICY "Admins can manage pos_device_mapping" ON pos_device_mapping
  FOR ALL USING (true); -- For Phase 2, allow all operations (API handles admin check)

-- Comment explaining the table purpose
COMMENT ON TABLE pos_device_mapping IS 'POS device mapping for role-based transaction visibility - Phase 2. Maps device_serial to retailer/distributor/master_distributor for filtering transactions.';
























