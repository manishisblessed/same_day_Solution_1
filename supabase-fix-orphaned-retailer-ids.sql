-- Fix: Clear orphaned retailer_id / distributor_id / master_distributor_id / partner_id
-- on machines that have inventory_status = 'in_stock' but still have ownership IDs set.
-- This happens when inventory_status was changed without clearing the owner fields.

-- Preview what will be fixed (run this first to see affected rows):
-- SELECT id, machine_id, inventory_status, retailer_id, distributor_id, master_distributor_id, partner_id
-- FROM pos_machines
-- WHERE inventory_status IN ('in_stock', 'received_from_bank', 'damaged_from_bank')
--   AND (retailer_id IS NOT NULL OR distributor_id IS NOT NULL OR master_distributor_id IS NOT NULL OR partner_id IS NOT NULL);

-- Apply the fix:
UPDATE pos_machines
SET retailer_id = NULL,
    distributor_id = NULL,
    master_distributor_id = NULL,
    partner_id = NULL,
    assigned_by = NULL,
    assigned_by_role = NULL,
    last_assigned_at = NULL,
    updated_at = NOW()
WHERE inventory_status IN ('in_stock', 'received_from_bank', 'damaged_from_bank')
  AND (retailer_id IS NOT NULL OR distributor_id IS NOT NULL OR master_distributor_id IS NOT NULL OR partner_id IS NOT NULL);
