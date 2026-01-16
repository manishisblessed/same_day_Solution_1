-- Migration: Add inventory_status field to pos_machines table
-- This field tracks the inventory state of POS machines for better inventory management

-- Add inventory_status column
ALTER TABLE pos_machines 
ADD COLUMN IF NOT EXISTS inventory_status TEXT DEFAULT 'in_stock' 
CHECK (inventory_status IN (
  'in_stock',
  'received_from_bank',
  'assigned_to_master_distributor',
  'assigned_to_distributor',
  'assigned_to_retailer',
  'damaged_from_bank'
));

-- Create index for inventory_status for faster queries
CREATE INDEX IF NOT EXISTS idx_pos_machines_inventory_status ON pos_machines(inventory_status);

-- Update existing records to have default inventory_status
UPDATE pos_machines 
SET inventory_status = CASE 
  WHEN status = 'damaged' THEN 'damaged_from_bank'
  WHEN retailer_id IS NOT NULL THEN 'assigned_to_retailer'
  WHEN distributor_id IS NOT NULL THEN 'assigned_to_distributor'
  WHEN master_distributor_id IS NOT NULL THEN 'assigned_to_master_distributor'
  ELSE 'in_stock'
END
WHERE inventory_status IS NULL;

-- Add comment to explain the field
COMMENT ON COLUMN pos_machines.inventory_status IS 'Tracks inventory state: in_stock, received_from_bank, assigned_to_master_distributor, assigned_to_distributor, assigned_to_retailer, damaged_from_bank';

