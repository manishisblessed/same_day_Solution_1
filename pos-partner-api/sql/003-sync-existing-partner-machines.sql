-- ============================================================================
-- Sync Existing Partner-Assigned Machines to partner_pos_machines
-- ============================================================================
-- This script syncs machines from pos_machines (admin table) to 
-- partner_pos_machines (partner API table) for machines that are assigned 
-- to partners but missing from partner_pos_machines.
-- ============================================================================

-- Step 1: Create default retailers for partners that don't have any
INSERT INTO partner_retailers (
  partner_id,
  retailer_code,
  name,
  business_name,
  status
)
SELECT DISTINCT
  pm.partner_id,
  'RET-' || UPPER(REPLACE(p.name, ' ', '-')) || '-001' AS retailer_code,
  p.name || ' Default Retailer' AS name,
  COALESCE(p.business_name, p.name) AS business_name,
  'active' AS status
FROM pos_machines pm
JOIN partners p ON p.id = pm.partner_id
WHERE pm.inventory_status = 'assigned_to_partner'
  AND pm.partner_id IS NOT NULL
  AND pm.tid IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM partner_retailers pr 
    WHERE pr.partner_id = pm.partner_id
  )
ON CONFLICT (partner_id, retailer_code) DO NOTHING;

-- Step 2: Insert missing machines into partner_pos_machines
INSERT INTO partner_pos_machines (
  partner_id,
  retailer_id,
  terminal_id,
  device_serial,
  machine_model,
  status,
  activated_at,
  metadata
)
SELECT 
  pm.partner_id,
  pr.id AS retailer_id,
  pm.tid AS terminal_id,
  pm.serial_number AS device_serial,
  CASE 
    WHEN pm.brand = 'RAZORPAY' THEN 'Razorpay POS'
    WHEN pm.brand IS NOT NULL THEN pm.brand
    ELSE 'POS'
  END AS machine_model,
  CASE 
    WHEN pm.status = 'active' THEN 'active'
    ELSE 'inactive'
  END AS status,
  COALESCE(pm.installation_date::timestamptz, pm.created_at) AS activated_at,
  CASE 
    WHEN pm.mid IS NOT NULL THEN jsonb_build_object('mid', pm.mid)
    ELSE '{}'::jsonb
  END AS metadata
FROM pos_machines pm
JOIN partners p ON p.id = pm.partner_id
LEFT JOIN partner_retailers pr ON pr.partner_id = pm.partner_id
WHERE pm.inventory_status = 'assigned_to_partner'
  AND pm.partner_id IS NOT NULL
  AND pm.tid IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM partner_pos_machines ppm 
    WHERE ppm.terminal_id = pm.tid
  )
ON CONFLICT (terminal_id) DO UPDATE SET
  partner_id = EXCLUDED.partner_id,
  retailer_id = EXCLUDED.retailer_id,
  device_serial = EXCLUDED.device_serial,
  machine_model = EXCLUDED.machine_model,
  status = EXCLUDED.status,
  activated_at = EXCLUDED.activated_at,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();

-- Step 3: Remove machines from partner_pos_machines that are no longer assigned to partners
DELETE FROM partner_pos_machines
WHERE terminal_id IN (
  SELECT ppm.terminal_id
  FROM partner_pos_machines ppm
  LEFT JOIN pos_machines pm ON pm.tid = ppm.terminal_id
  WHERE pm.id IS NULL 
     OR pm.inventory_status != 'assigned_to_partner'
     OR pm.partner_id IS NULL
     OR pm.partner_id != ppm.partner_id
);

-- Step 4: Verify the sync
SELECT 
  'Summary' AS report_type,
  COUNT(DISTINCT pm.id) AS machines_in_pos_machines,
  COUNT(DISTINCT ppm.id) AS machines_in_partner_pos_machines,
  COUNT(DISTINCT pm.id) - COUNT(DISTINCT ppm.id) AS missing_count
FROM pos_machines pm
LEFT JOIN partner_pos_machines ppm ON ppm.terminal_id = pm.tid
WHERE pm.inventory_status = 'assigned_to_partner'
  AND pm.partner_id IS NOT NULL
  AND pm.tid IS NOT NULL;

-- Step 5: Show machines that were synced
SELECT 
  pm.machine_id,
  pm.tid AS terminal_id,
  pm.serial_number AS device_serial,
  p.name AS partner_name,
  pr.retailer_code,
  ppm.status AS api_status
FROM pos_machines pm
JOIN partners p ON p.id = pm.partner_id
LEFT JOIN partner_retailers pr ON pr.partner_id = pm.partner_id
LEFT JOIN partner_pos_machines ppm ON ppm.terminal_id = pm.tid
WHERE pm.inventory_status = 'assigned_to_partner'
  AND pm.partner_id IS NOT NULL
  AND pm.tid IS NOT NULL
ORDER BY p.name, pm.tid;

