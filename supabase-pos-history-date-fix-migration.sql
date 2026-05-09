-- Migration: Fix missing dates on pos_assignment_history records
-- 1. Add assigned_date column for explicit assignment date tracking
-- 2. Backfill missing returned_date on existing returned records
-- 3. Update get_pos_stats RPC to count unique machines

-- Step 1: Add assigned_date column (explicit assignment date, separate from created_at)
ALTER TABLE pos_assignment_history
  ADD COLUMN IF NOT EXISTS assigned_date timestamptz;

-- Step 2: Backfill assigned_date from created_at for all existing records
UPDATE pos_assignment_history
SET assigned_date = created_at
WHERE assigned_date IS NULL;

-- Step 3: For "returned" records that have no returned_date, set it to created_at
UPDATE pos_assignment_history
SET returned_date = created_at
WHERE status = 'returned'
  AND returned_date IS NULL;

-- Step 2: Update the get_pos_stats RPC to count unique machines instead of history rows
DROP FUNCTION IF EXISTS get_pos_stats();
CREATE OR REPLACE FUNCTION get_pos_stats()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_build_object(
    'total', (SELECT COUNT(*) FROM pos_machines),
    'in_stock', (SELECT COUNT(*) FROM pos_machines WHERE inventory_status IN ('in_stock', 'received_from_bank')),
    'assigned', (SELECT COUNT(*) FROM pos_machines WHERE inventory_status LIKE 'assigned_to_%'),
    'returned_history', (
      SELECT COUNT(DISTINCT pos_machine_id)
      FROM pos_assignment_history
      WHERE status = 'returned' AND action LIKE 'assigned_to_%'
    ),
    'active_assignments', (
      SELECT COUNT(*)
      FROM pos_assignment_history
      WHERE status = 'active' AND action LIKE 'assigned_to_%'
    ),
    'by_status', (
      SELECT COALESCE(json_object_agg(inventory_status, cnt), '{}'::json)
      FROM (
        SELECT inventory_status, COUNT(*) AS cnt
        FROM pos_machines
        GROUP BY inventory_status
      ) sub
    )
  ) INTO result;

  RETURN result;
END;
$$;
