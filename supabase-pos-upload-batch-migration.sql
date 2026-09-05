-- POS machines: tag each bulk-upload with a batch label so batches can be
-- filtered and bulk-assigned later without needing the original spreadsheet.

ALTER TABLE pos_machines
  ADD COLUMN IF NOT EXISTS upload_batch TEXT;

-- Speeds up the "filter by batch" dropdown in the bulk-assign modal.
CREATE INDEX IF NOT EXISTS idx_pos_machines_upload_batch
  ON pos_machines (upload_batch);

COMMENT ON COLUMN pos_machines.upload_batch IS
  'Human-friendly label of the bulk-upload batch this machine came in with (e.g. "HDFC Eros Mall Sept"). Used to group/filter machines for bulk assignment.';
