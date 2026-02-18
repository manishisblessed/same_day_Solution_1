-- Migration: Add Partner Assignment Support to POS Machines
-- Allows Admin to assign POS machines directly to Partners (co-branding partners)
-- Similar to how machines are assigned to retailers

-- 1. Add partner_id column to pos_machines table
ALTER TABLE pos_machines 
ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES partners(id) ON DELETE SET NULL;

-- 2. Create index for partner_id
CREATE INDEX IF NOT EXISTS idx_pos_machines_partner_id ON pos_machines(partner_id);

-- 3. Update inventory_status check constraint to include 'assigned_to_partner'
-- First, drop the existing constraint if it exists
ALTER TABLE pos_machines 
DROP CONSTRAINT IF EXISTS pos_machines_inventory_status_check;

-- Add new constraint with partner assignment status
ALTER TABLE pos_machines 
ADD CONSTRAINT pos_machines_inventory_status_check 
CHECK (inventory_status IN (
  'in_stock', 
  'received_from_bank', 
  'assigned_to_master_distributor', 
  'assigned_to_distributor', 
  'assigned_to_retailer', 
  'assigned_to_partner',
  'damaged_from_bank'
));

-- 4. Update pos_assignment_history action enum to include partner assignment
ALTER TABLE pos_assignment_history 
DROP CONSTRAINT IF EXISTS pos_assignment_history_action_check;

ALTER TABLE pos_assignment_history 
ADD CONSTRAINT pos_assignment_history_action_check 
CHECK (action IN (
  'created',
  'assigned_to_master_distributor',
  'assigned_to_distributor', 
  'assigned_to_retailer',
  'assigned_to_partner',
  'unassigned_from_master_distributor',
  'unassigned_from_distributor',
  'unassigned_from_retailer',
  'unassigned_from_partner',
  'reassigned'
));

-- 5. Update pos_assignment_history assigned_to_role to include 'partner'
ALTER TABLE pos_assignment_history 
DROP CONSTRAINT IF EXISTS pos_assignment_history_assigned_to_role_check;

ALTER TABLE pos_assignment_history 
ADD CONSTRAINT pos_assignment_history_assigned_to_role_check 
CHECK (assigned_to_role IN ('master_distributor', 'distributor', 'retailer', 'partner'));

-- 6. Update pos_assignment_history previous_holder_role to include 'partner'
ALTER TABLE pos_assignment_history 
DROP CONSTRAINT IF EXISTS pos_assignment_history_previous_holder_role_check;

ALTER TABLE pos_assignment_history 
ADD CONSTRAINT pos_assignment_history_previous_holder_role_check 
CHECK (previous_holder_role IN ('master_distributor', 'distributor', 'retailer', 'partner'));

-- 7. Add comment
COMMENT ON COLUMN pos_machines.partner_id IS 'UUID reference to partners table - allows direct assignment of POS machines to co-branding partners by Admin';

