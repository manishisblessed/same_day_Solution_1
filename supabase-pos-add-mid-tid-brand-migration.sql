-- Migration: Add MID, TID, and BRAND fields to pos_machines table
-- These fields are required for POS machine identification and assignment

-- Add MID (Merchant ID) column
ALTER TABLE pos_machines ADD COLUMN IF NOT EXISTS mid TEXT;

-- Add TID (Terminal ID) column
ALTER TABLE pos_machines ADD COLUMN IF NOT EXISTS tid TEXT;

-- Add BRAND column (RAZORPAY, PINELAB, etc.)
ALTER TABLE pos_machines ADD COLUMN IF NOT EXISTS brand TEXT CHECK (brand IN ('RAZORPAY', 'PINELAB', 'PAYTM', 'ICICI', 'HDFC', 'AXIS', 'OTHER'));

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_pos_machines_mid ON pos_machines(mid);
CREATE INDEX IF NOT EXISTS idx_pos_machines_tid ON pos_machines(tid);
CREATE INDEX IF NOT EXISTS idx_pos_machines_brand ON pos_machines(brand);

-- Add comments
COMMENT ON COLUMN pos_machines.mid IS 'Merchant ID (e.g., 7568516041)';
COMMENT ON COLUMN pos_machines.tid IS 'Terminal ID (e.g., 29196333)';
COMMENT ON COLUMN pos_machines.brand IS 'POS Brand: RAZORPAY, PINELAB, PAYTM, ICICI, HDFC, AXIS, OTHER';
COMMENT ON COLUMN pos_machines.serial_number IS 'Device Serial Number (e.g., 2841154268)';

