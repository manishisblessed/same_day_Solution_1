-- ============================================================================
-- RLS LOCKDOWN (COMPLETE)
-- ============================================================================
-- Purpose: Close the Supabase "rls_disabled_in_public" / "Table publicly
-- accessible" alert by enabling Row-Level Security on EVERY public table that
-- is currently missing it, with a safe, uniform policy model.
--
-- Policy model (per table):
--   * service_role : full access (FOR ALL). All server API routes use the
--     service role key, which already bypasses RLS, so backend keeps working.
--   * authenticated: read-only (FOR SELECT). Preserves client-side reads used
--     by login/getCurrentUser and the scheme/report pages.
--   * anon         : no access. Privileges are revoked so an unauthenticated
--     project URL + anon key can no longer read or write these tables.
--
-- Writes from the browser are intentionally NOT permitted; those flows are
-- migrated to service-role API routes in the application code.
--
-- This script is idempotent and safe to run multiple times. It only touches
-- tables that still have RLS disabled, so it will not disturb tables that
-- already have hand-tuned policies from earlier migrations.
--
-- NOTE: We deliberately do NOT apply "auth.uid()::text = partner_id" ownership
-- policies here. In this app `partner_id` is a data identifier (not the
-- Supabase auth uid), and getCurrentUser reads identity tables by email from
-- the browser, so a uid-based policy would break login. Per-user row-level
-- tightening is a separate, deferred effort.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ENABLE RLS + DEFAULT POLICIES ON EVERY UNPROTECTED PUBLIC TABLE
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'            -- ordinary tables only (skip views, etc.)
      AND c.relrowsecurity = false   -- only tables where RLS is still OFF
  LOOP
    -- Enable RLS
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tbl);

    -- service_role: full access
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.tbl || '_service_all', r.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')',
      r.tbl || '_service_all', r.tbl
    );

    -- authenticated: read-only
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.tbl || '_auth_read', r.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (auth.role() IN (''authenticated'', ''service_role''))',
      r.tbl || '_auth_read', r.tbl
    );

    -- Remove any lingering direct grants to the anonymous role
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', r.tbl);

    RAISE NOTICE 'RLS enabled + policies applied on public.%', r.tbl;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 2. VERIFICATION
-- ----------------------------------------------------------------------------
-- 2a. Any public tables STILL without RLS? Expect ZERO rows.
SELECT n.nspname AS schema, c.relname AS table_without_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = false
ORDER BY c.relname;

-- 2b. Every public table with its RLS flag + policy count (for a quick audit).
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relrowsecurity ASC, c.relname;
