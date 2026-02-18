-- Fix: Clear retailer_id, distributor_id, master_distributor_id for machines assigned to partners
-- This ensures machines assigned to partners are properly unassigned from hierarchical entities

-- Update pos_machines table
UPDATE pos_machines
SET 
  retailer_id = NULL,
  distributor_id = NULL,
  master_distributor_id = NULL,
  updated_at = NOW()
WHERE 
  inventory_status = 'assigned_to_partner'
  AND (retailer_id IS NOT NULL OR distributor_id IS NOT NULL OR master_distributor_id IS NOT NULL);

-- Update pos_device_mapping table to clear hierarchical assignments for partner-assigned machines
UPDATE pos_device_mapping pdm
SET 
  retailer_id = NULL,
  distributor_id = NULL,
  master_distributor_id = NULL,
  status = 'INACTIVE',
  updated_at = NOW()
FROM pos_machines pm
WHERE 
  pm.serial_number = pdm.device_serial
  AND pm.inventory_status = 'assigned_to_partner'
  AND (pdm.retailer_id IS NOT NULL OR pdm.distributor_id IS NOT NULL OR pdm.master_distributor_id IS NOT NULL);

-- Show affected machines (for verification)
SELECT 
  machine_id,
  serial_number,
  retailer_id,
  distributor_id,
  master_distributor_id,
  partner_id,
  inventory_status
FROM pos_machines
WHERE inventory_status = 'assigned_to_partner';

