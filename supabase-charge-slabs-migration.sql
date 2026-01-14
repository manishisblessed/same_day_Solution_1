-- ============================================================================
-- CHARGE SLABS MIGRATION FOR BBPS & SETTLEMENT
-- ============================================================================
-- Creates/updates charge slabs as per requirements:
-- 1. 0-49999: ₹20
-- 2. 50000-99999: ₹30
-- 3. 100000-149999: ₹50
-- 4. 150000-184999: ₹70
-- Maximum transaction limit: ₹2,00,000
-- ============================================================================

-- Create settlement_charge_slabs table if it doesn't exist
CREATE TABLE IF NOT EXISTS settlement_charge_slabs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  min_amount DECIMAL(12, 2) NOT NULL,
  max_amount DECIMAL(12, 2) NOT NULL,
  charge DECIMAL(12, 2) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CHECK (min_amount >= 0),
  CHECK (max_amount > min_amount),
  CHECK (charge >= 0)
);

CREATE INDEX IF NOT EXISTS idx_settlement_charge_slabs_amounts ON settlement_charge_slabs(min_amount, max_amount);
CREATE INDEX IF NOT EXISTS idx_settlement_charge_slabs_active ON settlement_charge_slabs(is_active);

-- Create bbps_charge_slabs table (same structure for BBPS transactions)
CREATE TABLE IF NOT EXISTS bbps_charge_slabs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  min_amount DECIMAL(12, 2) NOT NULL,
  max_amount DECIMAL(12, 2) NOT NULL,
  charge DECIMAL(12, 2) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CHECK (min_amount >= 0),
  CHECK (max_amount > min_amount),
  CHECK (charge >= 0)
);

CREATE INDEX IF NOT EXISTS idx_bbps_charge_slabs_amounts ON bbps_charge_slabs(min_amount, max_amount);
CREATE INDEX IF NOT EXISTS idx_bbps_charge_slabs_active ON bbps_charge_slabs(is_active);

-- Insert/Update settlement charge slabs
INSERT INTO settlement_charge_slabs (min_amount, max_amount, charge, is_active)
VALUES
  (0, 49999, 20, TRUE),
  (50000, 99999, 30, TRUE),
  (100000, 149999, 50, TRUE),
  (150000, 184999, 70, TRUE)
ON CONFLICT DO NOTHING;

-- Update existing slabs if they exist
UPDATE settlement_charge_slabs SET
  min_amount = 0, max_amount = 49999, charge = 20, is_active = TRUE, updated_at = NOW()
WHERE min_amount = 0 AND max_amount <= 50000;

UPDATE settlement_charge_slabs SET
  min_amount = 50000, max_amount = 99999, charge = 30, is_active = TRUE, updated_at = NOW()
WHERE min_amount >= 50000 AND max_amount <= 100000;

UPDATE settlement_charge_slabs SET
  min_amount = 100000, max_amount = 149999, charge = 50, is_active = TRUE, updated_at = NOW()
WHERE min_amount >= 100000 AND max_amount <= 150000;

UPDATE settlement_charge_slabs SET
  min_amount = 150000, max_amount = 184999, charge = 70, is_active = TRUE, updated_at = NOW()
WHERE min_amount >= 150000 AND max_amount <= 185000;

-- Insert/Update BBPS charge slabs (same as settlement)
INSERT INTO bbps_charge_slabs (min_amount, max_amount, charge, is_active)
VALUES
  (0, 49999, 20, TRUE),
  (50000, 99999, 30, TRUE),
  (100000, 149999, 50, TRUE),
  (150000, 184999, 70, TRUE)
ON CONFLICT DO NOTHING;

-- Update existing BBPS slabs if they exist
UPDATE bbps_charge_slabs SET
  min_amount = 0, max_amount = 49999, charge = 20, is_active = TRUE, updated_at = NOW()
WHERE min_amount = 0 AND max_amount <= 50000;

UPDATE bbps_charge_slabs SET
  min_amount = 50000, max_amount = 99999, charge = 30, is_active = TRUE, updated_at = NOW()
WHERE min_amount >= 50000 AND max_amount <= 100000;

UPDATE bbps_charge_slabs SET
  min_amount = 100000, max_amount = 149999, charge = 50, is_active = TRUE, updated_at = NOW()
WHERE min_amount >= 100000 AND max_amount <= 150000;

UPDATE bbps_charge_slabs SET
  min_amount = 150000, max_amount = 184999, charge = 70, is_active = TRUE, updated_at = NOW()
WHERE min_amount >= 150000 AND max_amount <= 185000;

-- Function to calculate charge for BBPS/Settlement
CREATE OR REPLACE FUNCTION calculate_transaction_charge(
  p_amount DECIMAL(12, 2),
  p_transaction_type TEXT -- 'bbps' or 'settlement'
)
RETURNS DECIMAL(12, 2) AS $$
DECLARE
  v_charge DECIMAL(12, 2);
  v_table_name TEXT;
BEGIN
  -- Determine table name
  IF p_transaction_type = 'bbps' THEN
    v_table_name := 'bbps_charge_slabs';
  ELSIF p_transaction_type = 'settlement' THEN
    v_table_name := 'settlement_charge_slabs';
  ELSE
    RETURN 0; -- Unknown type, no charge
  END IF;
  
  -- Get charge from appropriate table
  EXECUTE format('
    SELECT charge INTO v_charge
    FROM %I
    WHERE is_active = TRUE
      AND min_amount <= $1
      AND max_amount >= $1
    ORDER BY charge ASC
    LIMIT 1
  ', v_table_name) USING p_amount;
  
  -- Return charge or default to 20 if not found
  RETURN COALESCE(v_charge, 20);
END;
$$ LANGUAGE plpgsql;

