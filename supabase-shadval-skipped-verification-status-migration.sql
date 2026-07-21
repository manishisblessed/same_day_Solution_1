-- ============================================================================
-- SHADVAL SETTLEMENT ACCOUNTS — Allow 'SKIPPED' verification status
-- ============================================================================
-- Purpose:
--   The Add Account flow now supports adding a "trusted" account WITHOUT
--   penny-drop verification (skip_verification). Such accounts are stored with
--   verification_status = 'SKIPPED'. The original CHECK constraint only allowed
--   ('SUCCESS','FAILED','PENDING'), so those inserts failed with a check
--   violation ("Failed to save account"). This migration widens the constraint.
--
-- Safe to run multiple times.
-- ============================================================================

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  -- Find the existing CHECK constraint on verification_status (auto-named)
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'shadval_settlement_accounts'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%verification_status%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE shadval_settlement_accounts DROP CONSTRAINT %I', v_constraint_name);
  END IF;

  ALTER TABLE shadval_settlement_accounts
    ADD CONSTRAINT shadval_settlement_accounts_verification_status_check
    CHECK (verification_status IN ('SUCCESS', 'FAILED', 'PENDING', 'SKIPPED'));
END $$;

-- Reload PostgREST schema cache so the API sees the change immediately
NOTIFY pgrst, 'reload schema';
