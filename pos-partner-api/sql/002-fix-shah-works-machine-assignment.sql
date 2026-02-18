-- ============================================================================
-- Fix: Assign TID 29196333 to Shah Works Partner
-- ============================================================================
-- This script:
-- 1. Creates a default retailer for Shah Works (if none exists)
-- 2. Updates partner_pos_machines to assign TID 29196333 to Shah Works
-- ============================================================================

-- Step 1: Create default retailer for Shah Works (if it doesn't exist)
INSERT INTO partner_retailers (
  partner_id,
  retailer_code,
  name,
  business_name,
  status
)
SELECT 
  '078ebf34-5593-47c2-98ff-101e4e275c39'::uuid,  -- Shah Works partner_id
  'RET-SHAH-001',
  'Shah Works Default Retailer',
  'Shah Works',
  'active'
WHERE NOT EXISTS (
  SELECT 1 FROM partner_retailers 
  WHERE partner_id = '078ebf34-5593-47c2-98ff-101e4e275c39'::uuid
);

-- Step 2: Get the retailer_id we just created (or existing one)
DO $$
DECLARE
  v_retailer_id UUID;
BEGIN
  -- Get retailer_id for Shah Works
  SELECT id INTO v_retailer_id
  FROM partner_retailers
  WHERE partner_id = '078ebf34-5593-47c2-98ff-101e4e275c39'::uuid
  LIMIT 1;

  -- Update partner_pos_machines for TID 29196333
  UPDATE partner_pos_machines
  SET 
    partner_id = '078ebf34-5593-47c2-98ff-101e4e275c39'::uuid,  -- Shah Works
    retailer_id = v_retailer_id,
    updated_at = NOW()
  WHERE terminal_id = '29196333';

  RAISE NOTICE 'Updated TID 29196333 to Shah Works (partner_id: %, retailer_id: %)', 
    '078ebf34-5593-47c2-98ff-101e4e275c39', v_retailer_id;
END $$;

-- Step 3: Verify the update
SELECT 
  pm.terminal_id,
  pm.device_serial,
  p.name AS partner_name,
  pr.retailer_code,
  pr.name AS retailer_name
FROM partner_pos_machines pm
JOIN partners p ON p.id = pm.partner_id
LEFT JOIN partner_retailers pr ON pr.id = pm.retailer_id
WHERE pm.terminal_id = '29196333';

