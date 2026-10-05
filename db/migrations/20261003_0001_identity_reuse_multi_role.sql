-- ============================================================================
-- Multi-Role Accounts: PAN reuse across MD / DT / RT with admin approval
-- ============================================================================
-- Business rules:
--   * One person (keyed by PAN) MAY hold multiple role accounts across
--     master_distributors / distributors / retailers.
--   * A person may NEVER hold two accounts of the SAME role (enforced by the
--     partial-unique PAN indexes below + app logic).
--   * Reusing a PAN that already exists under a DIFFERENT role requires an
--     admin / sub-admin approval raised INLINE during onboarding.
--
-- Aadhaar is intentionally NOT a uniqueness key: DigiLocker returns only a
-- masked Aadhaar (last 4 digits), so PAN is the sole reliable identity key.
-- The existing onboarding name-match gate (Aadhaar name == PAN name == bank)
-- already ties Aadhaar to the same person as the PAN.
--
-- Idempotent + safe to re-run.
-- ============================================================================

-- ── 1. Inline identity-reuse approval requests (one per onboarding invite) ───
CREATE TABLE IF NOT EXISTS identity_reuse_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id            UUID NOT NULL UNIQUE REFERENCES onboarding_invites(id) ON DELETE CASCADE,
  pan_number           TEXT NOT NULL,
  aadhaar_uid          TEXT,                    -- masked; stored for admin context only
  target_role          TEXT NOT NULL
                         CHECK (target_role IN ('master_distributor', 'distributor', 'retailer')),
  -- Snapshot of the existing account(s) that share this PAN, for admin review.
  conflicting_accounts JSONB NOT NULL DEFAULT '[]'::jsonb,
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'approved', 'rejected')),
  assigned_to          UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  reviewed_by          UUID REFERENCES admin_users(id) ON DELETE SET NULL,
  reviewed_at          TIMESTAMPTZ,
  reason               TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_identity_reuse_status      ON identity_reuse_requests (status);
CREATE INDEX IF NOT EXISTS idx_identity_reuse_assigned_to ON identity_reuse_requests (assigned_to);
CREATE INDEX IF NOT EXISTS idx_identity_reuse_pan         ON identity_reuse_requests (pan_number);

-- ── 2. Guard: fail loudly if legacy data already has two same-role rows for one
--       PAN (would make the unique indexes below impossible to create). ────────
DO $$
DECLARE
  v_tbl   TEXT;
  v_count INT;
  v_bad   TEXT := '';
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY['retailers', 'distributors', 'master_distributors'] LOOP
    EXECUTE format(
      'SELECT count(*) FROM (SELECT pan_number FROM %I WHERE pan_number IS NOT NULL AND pan_number <> '''' GROUP BY pan_number HAVING count(*) > 1) d',
      v_tbl
    ) INTO v_count;
    IF v_count > 0 THEN
      v_bad := v_bad || format(' %s(%s duplicate PANs)', v_tbl, v_count);
    END IF;
  END LOOP;

  IF v_bad <> '' THEN
    RAISE EXCEPTION 'Cannot create per-role unique PAN indexes — existing duplicate PANs found in:%. Clean these first (a single role must never have two accounts sharing one PAN).', v_bad;
  END IF;
END $$;

-- ── 3. Per-role unique PAN indexes (Rule 1: no two accounts of the same role).
--       Partial (WHERE pan_number IS NOT NULL) so legacy NULL PANs are ignored,
--       and per-table so the SAME PAN may still exist across different roles.
CREATE UNIQUE INDEX IF NOT EXISTS uq_retailers_pan
  ON retailers (pan_number) WHERE pan_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_distributors_pan
  ON distributors (pan_number) WHERE pan_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_master_distributors_pan
  ON master_distributors (pan_number) WHERE pan_number IS NOT NULL;
