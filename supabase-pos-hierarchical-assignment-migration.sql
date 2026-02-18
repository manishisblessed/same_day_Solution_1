-- Migration: Hierarchical POS Machine Assignment
-- Flow: Admin → Master Distributor → Distributor → Retailer
-- Each level can only assign machines to the level directly below them

-- 1. Make retailer_id nullable (machines can be assigned to MD/Distributor without a retailer)
ALTER TABLE pos_machines ALTER COLUMN retailer_id DROP NOT NULL;

-- 2. Add assignment tracking columns to pos_machines
ALTER TABLE pos_machines ADD COLUMN IF NOT EXISTS assigned_by TEXT;
ALTER TABLE pos_machines ADD COLUMN IF NOT EXISTS assigned_by_role TEXT CHECK (assigned_by_role IN ('admin', 'master_distributor', 'distributor'));
ALTER TABLE pos_machines ADD COLUMN IF NOT EXISTS last_assigned_at TIMESTAMP WITH TIME ZONE;

-- 3. Create pos_assignment_history table for audit trail
CREATE TABLE IF NOT EXISTS pos_assignment_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pos_machine_id UUID NOT NULL REFERENCES pos_machines(id) ON DELETE CASCADE,
  machine_id TEXT NOT NULL, -- duplicate for easy reference
  action TEXT NOT NULL CHECK (action IN (
    'created',
    'assigned_to_master_distributor',
    'assigned_to_distributor', 
    'assigned_to_retailer',
    'unassigned_from_master_distributor',
    'unassigned_from_distributor',
    'unassigned_from_retailer',
    'reassigned'
  )),
  assigned_by TEXT NOT NULL, -- partner_id or admin email of who performed the action
  assigned_by_role TEXT NOT NULL CHECK (assigned_by_role IN ('admin', 'master_distributor', 'distributor')),
  assigned_to TEXT, -- partner_id of who it was assigned to
  assigned_to_role TEXT CHECK (assigned_to_role IN ('master_distributor', 'distributor', 'retailer')),
  previous_holder TEXT, -- partner_id of previous holder (for reassignments)
  previous_holder_role TEXT CHECK (previous_holder_role IN ('master_distributor', 'distributor', 'retailer')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for pos_assignment_history
CREATE INDEX IF NOT EXISTS idx_pos_assignment_history_machine_id ON pos_assignment_history(pos_machine_id);
CREATE INDEX IF NOT EXISTS idx_pos_assignment_history_assigned_by ON pos_assignment_history(assigned_by);
CREATE INDEX IF NOT EXISTS idx_pos_assignment_history_assigned_to ON pos_assignment_history(assigned_to);
CREATE INDEX IF NOT EXISTS idx_pos_assignment_history_action ON pos_assignment_history(action);
CREATE INDEX IF NOT EXISTS idx_pos_assignment_history_created_at ON pos_assignment_history(created_at);

-- Enable RLS
ALTER TABLE pos_assignment_history ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Allow all (API routes use service role key)
DROP POLICY IF EXISTS "Allow all on pos_assignment_history" ON pos_assignment_history;
CREATE POLICY "Allow all on pos_assignment_history" ON pos_assignment_history
  FOR ALL USING (true);

-- Update existing records: set inventory_status based on current assignments
UPDATE pos_machines 
SET inventory_status = CASE 
  WHEN retailer_id IS NOT NULL THEN 'assigned_to_retailer'
  WHEN distributor_id IS NOT NULL THEN 'assigned_to_distributor'
  WHEN master_distributor_id IS NOT NULL THEN 'assigned_to_master_distributor'
  WHEN status = 'damaged' THEN 'damaged_from_bank'
  ELSE 'in_stock'
END
WHERE inventory_status IS NULL OR inventory_status = 'in_stock';

-- Comment on the table
COMMENT ON TABLE pos_assignment_history IS 'Tracks the full history of POS machine assignments through the hierarchy: Admin → MD → Distributor → Retailer';
COMMENT ON COLUMN pos_machines.assigned_by IS 'partner_id or admin email of who last assigned this machine';
COMMENT ON COLUMN pos_machines.assigned_by_role IS 'Role of the person who last assigned this machine';
COMMENT ON COLUMN pos_machines.last_assigned_at IS 'Timestamp of the last assignment action';

