-- Migration: Fix POS Assignment System
-- Adds proper assignment status tracking, atomic transactions, and one-active-assignment enforcement
-- Run this in Supabase SQL Editor

-- ============================================================
-- 1. Add `status` and `returned_date` to pos_assignment_history
-- ============================================================

ALTER TABLE pos_assignment_history
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'
  CHECK (status IN ('active', 'returned'));

ALTER TABLE pos_assignment_history
ADD COLUMN IF NOT EXISTS returned_date TIMESTAMP WITH TIME ZONE;

-- Backfill: mark all existing unassign actions as 'returned'
UPDATE pos_assignment_history
SET status = 'returned',
    returned_date = created_at
WHERE action LIKE 'unassigned_from_%'
  AND status = 'active';

-- Backfill: mark assignment actions as 'returned' if a later unassign exists for the same device
UPDATE pos_assignment_history h
SET status = 'returned',
    returned_date = (
      SELECT MIN(h2.created_at)
      FROM pos_assignment_history h2
      WHERE h2.pos_machine_id = h.pos_machine_id
        AND h2.action LIKE 'unassigned_from_%'
        AND h2.created_at > h.created_at
    )
WHERE h.action LIKE 'assigned_to_%'
  AND h.status = 'active'
  AND EXISTS (
    SELECT 1 FROM pos_assignment_history h2
    WHERE h2.pos_machine_id = h.pos_machine_id
      AND h2.action LIKE 'unassigned_from_%'
      AND h2.created_at > h.created_at
  );

-- Also mark assignments as returned if the device is currently in_stock
UPDATE pos_assignment_history h
SET status = 'returned',
    returned_date = COALESCE(
      (SELECT MIN(h2.created_at) FROM pos_assignment_history h2
       WHERE h2.pos_machine_id = h.pos_machine_id
         AND h2.action LIKE 'unassigned_from_%'
         AND h2.created_at > h.created_at),
      NOW()
    )
WHERE h.action LIKE 'assigned_to_%'
  AND h.status = 'active'
  AND EXISTS (
    SELECT 1 FROM pos_machines m
    WHERE m.id = h.pos_machine_id
      AND m.inventory_status = 'in_stock'
  );

-- ============================================================
-- 2. Unique partial index: only ONE active assignment per POS
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_assignment_one_active
ON pos_assignment_history (pos_machine_id)
WHERE status = 'active' AND action LIKE 'assigned_to_%';

-- ============================================================
-- 3. Add index on status for fast queries
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_pos_assignment_history_status
ON pos_assignment_history (status);

CREATE INDEX IF NOT EXISTS idx_pos_assignment_history_returned_date
ON pos_assignment_history (returned_date);

-- ============================================================
-- 4. RPC: Atomic POS Assignment
-- ============================================================

CREATE OR REPLACE FUNCTION assign_pos_device(
  p_machine_id UUID,
  p_assign_to TEXT,
  p_assign_to_role TEXT,
  p_assigned_by TEXT,
  p_assigned_by_role TEXT,
  p_inventory_status TEXT,
  p_owner_field TEXT,
  p_clear_fields TEXT[] DEFAULT '{}',
  p_notes TEXT DEFAULT NULL,
  p_sync_partner_pos BOOLEAN DEFAULT FALSE,
  p_partner_machine_data JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_machine RECORD;
  v_active_count INT;
  v_result JSONB;
BEGIN
  -- Lock the device row to prevent concurrent assignments
  SELECT * INTO v_machine
  FROM pos_machines
  WHERE id = p_machine_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'POS machine not found');
  END IF;

  -- Check for existing active assignment
  SELECT COUNT(*) INTO v_active_count
  FROM pos_assignment_history
  WHERE pos_machine_id = p_machine_id
    AND status = 'active'
    AND action LIKE 'assigned_to_%';

  IF v_active_count > 0 THEN
    -- Close existing active assignment(s) before creating new one
    UPDATE pos_assignment_history
    SET status = 'returned',
        returned_date = NOW()
    WHERE pos_machine_id = p_machine_id
      AND status = 'active'
      AND action LIKE 'assigned_to_%';
  END IF;

  -- Update pos_machines: set new owner and inventory status
  EXECUTE format(
    'UPDATE pos_machines SET
      inventory_status = $1,
      assigned_by = $2,
      assigned_by_role = $3,
      last_assigned_at = NOW(),
      updated_at = NOW(),
      status = CASE WHEN status = ''returned'' THEN ''active'' ELSE status END,
      %s = $4
      %s
    WHERE id = $5',
    quote_ident(p_owner_field),
    CASE WHEN array_length(p_clear_fields, 1) > 0 THEN
      ', ' || array_to_string(
        ARRAY(SELECT quote_ident(f) || ' = NULL' FROM unnest(p_clear_fields) f),
        ', '
      )
    ELSE ''
    END
  ) USING p_inventory_status, p_assigned_by, p_assigned_by_role, p_assign_to, p_machine_id;

  -- Create new assignment history record
  INSERT INTO pos_assignment_history (
    pos_machine_id, machine_id, action,
    assigned_by, assigned_by_role,
    assigned_to, assigned_to_role,
    previous_holder, previous_holder_role,
    status, notes
  ) VALUES (
    p_machine_id,
    v_machine.machine_id,
    'assigned_to_' || p_assign_to_role,
    p_assigned_by,
    p_assigned_by_role,
    p_assign_to,
    p_assign_to_role,
    COALESCE(v_machine.partner_id::text, v_machine.retailer_id, v_machine.distributor_id, v_machine.master_distributor_id),
    CASE
      WHEN v_machine.partner_id IS NOT NULL THEN 'partner'
      WHEN v_machine.retailer_id IS NOT NULL THEN 'retailer'
      WHEN v_machine.distributor_id IS NOT NULL THEN 'distributor'
      WHEN v_machine.master_distributor_id IS NOT NULL THEN 'master_distributor'
      ELSE NULL
    END,
    'active',
    p_notes
  );

  RETURN jsonb_build_object(
    'success', true,
    'machine_id', v_machine.machine_id,
    'previous_inventory_status', v_machine.inventory_status
  );
END;
$$;

-- ============================================================
-- 5. RPC: Atomic POS Return
-- ============================================================

CREATE OR REPLACE FUNCTION return_pos_device(
  p_machine_id UUID,
  p_returned_by TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_machine RECORD;
  v_assignment RECORD;
  v_previous_holder TEXT;
  v_previous_holder_role TEXT;
  v_unassign_action TEXT;
BEGIN
  -- Lock the device row
  SELECT * INTO v_machine
  FROM pos_machines
  WHERE id = p_machine_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'POS machine not found');
  END IF;

  -- Verify machine is currently assigned
  IF v_machine.inventory_status NOT IN (
    'assigned_to_retailer', 'assigned_to_distributor',
    'assigned_to_master_distributor', 'assigned_to_partner'
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Machine cannot be returned. Current status: %s', v_machine.inventory_status)
    );
  END IF;

  -- Determine previous holder
  v_previous_holder := COALESCE(
    v_machine.retailer_id,
    v_machine.distributor_id,
    v_machine.master_distributor_id,
    v_machine.partner_id::text
  );
  v_previous_holder_role := CASE
    WHEN v_machine.retailer_id IS NOT NULL THEN 'retailer'
    WHEN v_machine.distributor_id IS NOT NULL THEN 'distributor'
    WHEN v_machine.master_distributor_id IS NOT NULL THEN 'master_distributor'
    WHEN v_machine.partner_id IS NOT NULL THEN 'partner'
    ELSE NULL
  END;

  v_unassign_action := 'unassigned_from_' || COALESCE(v_previous_holder_role, 'retailer');

  -- 1. Update the active assignment record → returned
  UPDATE pos_assignment_history
  SET status = 'returned',
      returned_date = NOW()
  WHERE pos_machine_id = p_machine_id
    AND status = 'active'
    AND action LIKE 'assigned_to_%';

  -- 2. Insert unassign history record
  INSERT INTO pos_assignment_history (
    pos_machine_id, machine_id, action,
    assigned_by, assigned_by_role,
    assigned_to, assigned_to_role,
    previous_holder, previous_holder_role,
    status, notes
  ) VALUES (
    p_machine_id,
    v_machine.machine_id,
    v_unassign_action,
    p_returned_by,
    'admin',
    NULL, NULL,
    v_previous_holder,
    v_previous_holder_role,
    'returned',
    COALESCE(p_notes, format('Returned to stock by admin. Was %s.', v_machine.inventory_status))
  );

  -- 3. Clear all ownership fields on pos_machines
  UPDATE pos_machines
  SET inventory_status = 'in_stock',
      retailer_id = NULL,
      distributor_id = NULL,
      master_distributor_id = NULL,
      partner_id = NULL,
      assigned_by = NULL,
      assigned_by_role = NULL,
      last_assigned_at = NULL,
      updated_at = NOW()
  WHERE id = p_machine_id;

  -- 4. Remove from pos_device_mapping
  IF v_machine.serial_number IS NOT NULL THEN
    DELETE FROM pos_device_mapping
    WHERE device_serial = v_machine.serial_number;
  END IF;

  -- 5. Remove from partner_pos_machines
  IF v_machine.tid IS NOT NULL THEN
    DELETE FROM partner_pos_machines
    WHERE terminal_id = v_machine.tid;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'machine_id', v_machine.machine_id,
    'previous_status', v_machine.inventory_status,
    'previous_holder', v_previous_holder,
    'previous_holder_role', v_previous_holder_role
  );
END;
$$;

-- ============================================================
-- 6. RPC: Get POS Stats for Admin Dashboard
-- ============================================================

CREATE OR REPLACE FUNCTION get_pos_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total INT;
  v_in_stock INT;
  v_assigned INT;
  v_returned_history INT;
  v_by_status JSONB;
BEGIN
  SELECT COUNT(*) INTO v_total FROM pos_machines;

  SELECT COUNT(*) INTO v_in_stock
  FROM pos_machines
  WHERE inventory_status IN ('in_stock', 'received_from_bank');

  SELECT COUNT(*) INTO v_assigned
  FROM pos_machines
  WHERE inventory_status LIKE 'assigned_to_%';

  SELECT COUNT(*) INTO v_returned_history
  FROM pos_assignment_history
  WHERE status = 'returned';

  SELECT jsonb_object_agg(inventory_status, cnt)
  INTO v_by_status
  FROM (
    SELECT inventory_status, COUNT(*) as cnt
    FROM pos_machines
    GROUP BY inventory_status
  ) sub;

  RETURN jsonb_build_object(
    'total', v_total,
    'in_stock', v_in_stock,
    'assigned', v_assigned,
    'returned_history', v_returned_history,
    'by_status', COALESCE(v_by_status, '{}'::jsonb)
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION assign_pos_device TO service_role;
GRANT EXECUTE ON FUNCTION return_pos_device TO service_role;
GRANT EXECUTE ON FUNCTION get_pos_stats TO service_role;
