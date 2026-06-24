-- ============================================================================
-- SECURITY HARDENING MIGRATION
-- ============================================================================
-- Goal: lock down the database against fraud, hijacking, and unauthorized
-- access. Safe to run multiple times (idempotent). Run in Supabase SQL Editor.
--
-- What this does:
--   1. Enables RLS + sensible default policies on every table currently
--      flagged UNRESTRICTED. Default-deny, then explicit allows.
--   2. Replaces the old permissive USING (true) wallet policies with
--      ownership / service_role checks.
--   3. Makes audit logs append-only (no UPDATE / DELETE).
--   4. Adds wallet-ledger integrity constraints (NOT VALID so legacy rows are
--      not rejected, but all NEW rows must pass).
--   5. Adds idempotency support (idempotency_keys table + columns on money
--      tables + unique indexes).
--   6. Adds login_attempts table for brute-force protection.
--   7. Adds provider-txn uniqueness to block double-credit fraud.
--
-- NOTE: This script only references auth.role() in policies so it is safe
-- regardless of each table's exact column layout. Per-user row filtering for
-- tables that already had it is preserved by supabase-rls-tighten-migration.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENABLE RLS + DEFAULT POLICIES ON UNRESTRICTED TABLES
-- ----------------------------------------------------------------------------
-- Three security classes:
--   A. SERVICE_ONLY    -> only service_role can read or write (admin/internal)
--   B. AUTH_READ       -> authenticated may read, only service_role writes
--                         (reference / config / catalog data)
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  t TEXT;
  -- Admin / internal tables: service_role only (no anon, no authenticated)
  service_only_tables TEXT[] := ARRAY[
    'admin_users', 'admin_permissions', 'admin_role_permissions',
    'admin_audit_log', 'admin_impersonation_sessions',
    'instacash_batches', 'instacash_batch_items',
    'users_current_locations',
    'transactions'
  ];
  -- Reference / catalog / config tables: authenticated read, service write
  auth_read_tables TEXT[] := ARRAY[
    'bbps_billers', 'bbps_charge_slabs', 'card_classifications',
    'global_schemes', 'partner_schemes', 'retailer_schemes',
    'subscription_plans'
  ];
BEGIN
  -- A. SERVICE_ONLY tables
  FOREACH t IN ARRAY service_only_tables LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_service_all', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')',
        t || '_service_all', t
      );
    END IF;
  END LOOP;

  -- B. AUTH_READ tables
  FOREACH t IN ARRAY auth_read_tables LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_auth_read', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT USING (auth.role() IN (''authenticated'', ''service_role''))',
        t || '_auth_read', t
      );
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_service_write', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')',
        t || '_service_write', t
      );
    END IF;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 1b. POS transaction partitions: service_role only.
--     These are accessed by the API using the service role, never the browser.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname LIKE 'pos_transactions_%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.relname || '_service_all', r.relname);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')',
      r.relname || '_service_all', r.relname
    );
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 2. REPLACE PERMISSIVE WALLET POLICIES (USING (true)) FROM BASE SCHEMA
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can read wallets" ON wallets;
DROP POLICY IF EXISTS "Admins can manage wallets" ON wallets;

DROP POLICY IF EXISTS "wallets_select_own" ON wallets;
CREATE POLICY "wallets_select_own" ON wallets
  FOR SELECT USING (auth.uid()::text = user_id OR auth.role() = 'service_role');

DROP POLICY IF EXISTS "wallets_write_service" ON wallets;
CREATE POLICY "wallets_write_service" ON wallets
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Sweep any remaining USING (true) policies on financial tables
DO $$
DECLARE
  r RECORD;
  fin_tables TEXT[] := ARRAY[
    'wallets', 'wallet_ledger', 'wallet_transfers', 'settlements',
    'commission_ledger', 'aeps_transactions', 'reversals', 'disputes',
    'user_limits', 'mdr_config'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY fin_tables LOOP
    FOR r IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND qual = 'true'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, t);
    END LOOP;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 3. AUDIT LOGS: APPEND-ONLY (no UPDATE / DELETE for anyone, incl. service_role)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
  audit_tables TEXT[] := ARRAY['admin_audit_log', 'activity_logs', 'admin_impersonation_sessions'];
BEGIN
  FOREACH t IN ARRAY audit_tables LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      -- Allow inserts by service_role only
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_insert_service', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (auth.role() = ''service_role'')',
        t || '_insert_service', t
      );
      -- Allow reads by service_role only
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_service', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT USING (auth.role() = ''service_role'')',
        t || '_select_service', t
      );
      -- Block UPDATE / DELETE at the privilege level for every app role
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON public.%I FROM anon, authenticated', t);
      -- Trigger that hard-blocks UPDATE/DELETE even for service_role / table owner
      EXECUTE format($f$
        CREATE OR REPLACE FUNCTION public.%I() RETURNS trigger AS $body$
        BEGIN
          RAISE EXCEPTION 'Audit log %% is append-only; UPDATE/DELETE is not permitted', TG_TABLE_NAME;
        END;
        $body$ LANGUAGE plpgsql;
      $f$, 'block_mutation_' || t);
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'trg_append_only_' || t, t);
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.%I()',
        'trg_append_only_' || t, t, 'block_mutation_' || t
      );
    END IF;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 4. WALLET LEDGER INTEGRITY CONSTRAINTS (NOT VALID -> only new rows checked)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  -- credit and debit cannot both be non-zero in the same row
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wallet_ledger_credit_xor_debit'
  ) THEN
    ALTER TABLE wallet_ledger
      ADD CONSTRAINT wallet_ledger_credit_xor_debit
      CHECK (NOT (COALESCE(credit,0) > 0 AND COALESCE(debit,0) > 0)) NOT VALID;
  END IF;

  -- amounts must be non-negative
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wallet_ledger_nonneg_amounts'
  ) THEN
    ALTER TABLE wallet_ledger
      ADD CONSTRAINT wallet_ledger_nonneg_amounts
      CHECK (COALESCE(credit,0) >= 0 AND COALESCE(debit,0) >= 0) NOT VALID;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 5. IDEMPOTENCY SUPPORT
-- ----------------------------------------------------------------------------
-- Central table used by lib/security/idempotency.ts to reserve a key before
-- performing a money movement. A unique constraint guarantees one-shot.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL,                 -- e.g. 'payout_transfer', 'bbps_pay'
  idempotency_key TEXT NOT NULL,
  user_id TEXT,
  request_hash TEXT,
  response JSONB,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'failed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (scope, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_created_at ON idempotency_keys(created_at);

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "idempotency_service_all" ON idempotency_keys;
CREATE POLICY "idempotency_service_all" ON idempotency_keys
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Optional per-table idempotency columns + unique index (defense in depth)
DO $$
DECLARE
  t TEXT;
  money_tables TEXT[] := ARRAY['payout_transactions', 'bbps_transactions', 'aeps_transactions', 'wallet_transfers'];
BEGIN
  FOREACH t IN ARRAY money_tables LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r'
    ) THEN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = t AND column_name = 'idempotency_key'
      ) THEN
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN idempotency_key TEXT', t);
      END IF;
      EXECUTE format(
        'CREATE UNIQUE INDEX IF NOT EXISTS %I ON public.%I(idempotency_key) WHERE idempotency_key IS NOT NULL',
        'uq_' || t || '_idem', t
      );
    END IF;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 6. PROVIDER TRANSACTION UNIQUENESS (block double-credit / replayed callbacks)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='payout_transactions' AND column_name='client_ref_id') THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_client_ref
      ON public.payout_transactions(client_ref_id) WHERE client_ref_id IS NOT NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='razorpay_transactions' AND column_name='razorpay_payment_id') THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_razorpay_payment_id
      ON public.razorpay_transactions(razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 7. LOGIN BRUTE-FORCE PROTECTION
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  ip_address TEXT,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip_address, created_at DESC);

ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "login_attempts_service_all" ON login_attempts;
CREATE POLICY "login_attempts_service_all" ON login_attempts
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Returns the number of failed attempts for an email within a recent window.
CREATE OR REPLACE FUNCTION public.recent_failed_logins(p_email TEXT, p_window_minutes INT DEFAULT 15)
RETURNS INTEGER AS $$
  SELECT COUNT(*)::int
  FROM login_attempts
  WHERE email = lower(p_email)
    AND success = FALSE
    AND created_at > NOW() - (p_window_minutes || ' minutes')::interval;
$$ LANGUAGE sql STABLE;

-- ============================================================================
-- END OF SECURITY HARDENING MIGRATION
-- ============================================================================
-- After running: also run supabase-rls-tighten-migration.sql (if not already)
-- to restore per-user row filtering on retailers/distributors/etc.
-- Then VALIDATE the ledger constraints once legacy data is clean:
--   ALTER TABLE wallet_ledger VALIDATE CONSTRAINT wallet_ledger_credit_xor_debit;
--   ALTER TABLE wallet_ledger VALIDATE CONSTRAINT wallet_ledger_nonneg_amounts;
-- ============================================================================
