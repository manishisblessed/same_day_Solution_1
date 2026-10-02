-- ============================================================================
-- DATA AUDIT TRIGGER MIGRATION
-- ============================================================================
-- Closes the audit blind spot: application-level logging (activity_logs) only
-- records writes that go THROUGH the Next.js API routes. Any direct database
-- write using the service-role key (Supabase SQL Editor, Table Editor, scripts,
-- psql) bypasses it and leaves no trace.
--
-- This migration adds a DATABASE-LEVEL audit trail that captures EVERY
-- INSERT / UPDATE / DELETE on sensitive tables, no matter the source, including:
--   - which DB role performed it (session_user / current_user)
--   - the JWT identity when the write came via PostgREST (role / sub / email)
--   - an optional app-provided actor (app.actor GUC)
--   - the client IP (inet_client_addr)
--   - exactly which columns changed, with full old/new snapshots
--
-- The audit table is APPEND-ONLY and tamper-resistant: direct DML is revoked
-- from all app roles; only the SECURITY DEFINER trigger (owned by the migration
-- runner) can write to it.
--
-- Safe to run multiple times (idempotent).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Append-only audit table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_audit_log (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name       TEXT        NOT NULL,
  operation        TEXT        NOT NULL,            -- INSERT | UPDATE | DELETE
  row_pk           TEXT,                            -- id column of the affected row
  partner_id       TEXT,                            -- business id if the table has one
  changed_columns  TEXT[],                          -- columns that actually changed (UPDATE)
  old_data         JSONB,                           -- full row snapshot before (UPDATE/DELETE)
  new_data         JSONB,                           -- full row snapshot after  (INSERT/UPDATE)
  db_session_user  TEXT        NOT NULL,            -- login role (e.g. authenticator, postgres)
  db_current_user  TEXT        NOT NULL,            -- effective role (e.g. service_role, postgres)
  jwt_role         TEXT,                            -- PostgREST JWT role claim
  jwt_sub          TEXT,                            -- auth user id (sub) when present
  jwt_email        TEXT,                            -- auth email when present
  app_actor        TEXT,                            -- optional app-set actor (app.actor GUC)
  client_addr      INET,                            -- client IP (direct connections)
  txn_time         TIMESTAMPTZ NOT NULL DEFAULT now(),
  statement_time   TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp()
);

COMMENT ON TABLE data_audit_log IS
  'Append-only, DB-level audit trail for every write on sensitive tables. Captures direct SQL writes that bypass the application activity_logs.';

CREATE INDEX IF NOT EXISTS idx_data_audit_table      ON data_audit_log(table_name);
CREATE INDEX IF NOT EXISTS idx_data_audit_row_pk     ON data_audit_log(row_pk);
CREATE INDEX IF NOT EXISTS idx_data_audit_partner_id ON data_audit_log(partner_id);
CREATE INDEX IF NOT EXISTS idx_data_audit_txn_time   ON data_audit_log(txn_time DESC);
CREATE INDEX IF NOT EXISTS idx_data_audit_operation  ON data_audit_log(operation);
-- Fast lookup for status changes specifically.
CREATE INDEX IF NOT EXISTS idx_data_audit_status_changes
  ON data_audit_log(table_name, txn_time DESC)
  WHERE changed_columns @> ARRAY['status'];

-- ----------------------------------------------------------------------------
-- 2. Generic audit trigger function
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER so it can insert into data_audit_log even after we revoke
-- direct DML from the application roles below.
CREATE OR REPLACE FUNCTION audit_row_change()
RETURNS TRIGGER AS $$
DECLARE
  v_old      JSONB;
  v_new      JSONB;
  v_changed  TEXT[];
  v_claims   JSONB;
  v_pk       TEXT;
  v_partner  TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
  ELSE  -- UPDATE
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    SELECT array_agg(k ORDER BY k) INTO v_changed
    FROM jsonb_object_keys(v_new) AS k
    WHERE (v_new -> k) IS DISTINCT FROM (v_old -> k);

    -- No real change (e.g. updated_at-only touch with identical values) -> skip.
    IF v_changed IS NULL THEN
      RETURN NEW;
    END IF;
  END IF;

  v_pk      := COALESCE(v_new ->> 'id', v_old ->> 'id');
  v_partner := COALESCE(v_new ->> 'partner_id', v_old ->> 'partner_id');

  -- PostgREST sets request.jwt.claims for API traffic. Absent for direct SQL.
  BEGIN
    v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    v_claims := NULL;
  END;

  INSERT INTO data_audit_log (
    table_name, operation, row_pk, partner_id, changed_columns,
    old_data, new_data,
    db_session_user, db_current_user,
    jwt_role, jwt_sub, jwt_email, app_actor, client_addr
  ) VALUES (
    TG_TABLE_NAME, TG_OP, v_pk, v_partner, v_changed,
    v_old, v_new,
    session_user, current_user,
    v_claims ->> 'role',
    v_claims ->> 'sub',
    COALESCE(v_claims ->> 'email', v_claims #>> '{user_metadata,email}'),
    NULLIF(current_setting('app.actor', true), ''),
    inet_client_addr()
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION audit_row_change IS
  'Generic AFTER trigger: records every row change into data_audit_log with actor + source context.';

-- ----------------------------------------------------------------------------
-- 3. Attach the trigger to sensitive tables (only those that exist)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t       TEXT;
  tables  TEXT[] := ARRAY[
    'retailers',
    'distributors',
    'master_distributors',
    'partners',
    'admin_users',
    'pos_machines',
    'wallets'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS zz_audit_%1$s ON public.%1$I', t);
      EXECUTE format(
        'CREATE TRIGGER zz_audit_%1$s
           AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
           FOR EACH ROW EXECUTE FUNCTION audit_row_change()',
        t
      );
      RAISE NOTICE 'Audit trigger attached to %', t;
    ELSE
      RAISE NOTICE 'Skipped (table not found): %', t;
    END IF;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 4. Make the audit table append-only / tamper-resistant
-- ----------------------------------------------------------------------------
-- Remove direct write access from everyone. The SECURITY DEFINER function
-- (owned by the migration runner) is the ONLY path that can insert.
REVOKE ALL ON data_audit_log FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON data_audit_log FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON data_audit_log FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    -- Service role may READ the audit trail (for the admin UI) but NOT modify it.
    EXECUTE 'REVOKE ALL ON data_audit_log FROM service_role';
    EXECUTE 'GRANT SELECT ON data_audit_log TO service_role';
  END IF;
END $$;

-- Enable RLS so no accidental broad policy exposes it; service_role bypasses RLS
-- for reads, and no policy means no other role can touch it.
ALTER TABLE data_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_audit_log FORCE ROW LEVEL SECURITY;

-- ============================================================================
-- DONE
-- ============================================================================
-- Verify after running:
--   SELECT table_name, operation, changed_columns, jwt_email, db_current_user,
--          client_addr, txn_time
--   FROM data_audit_log
--   ORDER BY txn_time DESC
--   LIMIT 50;
--
-- To attribute service-role (server API) writes to a specific admin, have the
-- API set the actor at the start of the request's DB work:
--   SELECT set_config('app.actor', '<admin-email-or-id>', true);
-- The trigger records it in data_audit_log.app_actor.
-- ============================================================================
