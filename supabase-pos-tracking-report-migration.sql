-- Migration: POS Tracking History Report
-- Adds return_reason to pos_assignment_history for better accountability
-- Run after: supabase-pos-partner-assignment-migration.sql

-- 1. Add return_reason column to pos_assignment_history
ALTER TABLE pos_assignment_history
ADD COLUMN IF NOT EXISTS return_reason TEXT;

-- 2. Add index on returned_date for date-wise queries
CREATE INDEX IF NOT EXISTS idx_pos_assignment_history_returned_date
ON pos_assignment_history(returned_date);

-- 3. Add composite index for merchant-wise tracking (assigned_to + action)
CREATE INDEX IF NOT EXISTS idx_pos_assignment_history_assigned_to_action
ON pos_assignment_history(assigned_to, action);

-- 4. Add composite index for date-range queries on created_at with action
CREATE INDEX IF NOT EXISTS idx_pos_assignment_history_created_at_action
ON pos_assignment_history(created_at, action);

-- 5. Add status column if missing (some older schemas may not have it)
ALTER TABLE pos_assignment_history
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';

ALTER TABLE pos_assignment_history
ADD COLUMN IF NOT EXISTS returned_date TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN pos_assignment_history.return_reason IS 'Reason for returning the POS machine (e.g., defective, merchant closed, upgrade, etc.)';
