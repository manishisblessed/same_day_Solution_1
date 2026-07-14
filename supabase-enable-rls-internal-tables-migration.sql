-- ============================================================================
-- Fix Supabase security advisory: rls_disabled_in_public
-- ============================================================================
-- Tables: _migrations, rate_limit_entries, settlement_alerts
--
-- These are internal-only tables:
--   _migrations        -> written by migration scripts over direct pg connection
--   rate_limit_entries -> accessed only via check_rate_limit() SECURITY DEFINER RPC
--   settlement_alerts  -> accessed only via service-role admin client (API/cron)
--
-- Enabling RLS with no policies denies all access through the public
-- PostgREST API (anon/authenticated keys). The service role and direct
-- Postgres connections bypass RLS, so the app is unaffected.
--
-- Run in Supabase SQL Editor
-- ============================================================================

ALTER TABLE _migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_alerts ENABLE ROW LEVEL SECURITY;

-- Belt and braces: drop PostgREST grants for public API roles
REVOKE ALL ON _migrations FROM anon, authenticated;
REVOKE ALL ON rate_limit_entries FROM anon, authenticated;
REVOKE ALL ON settlement_alerts FROM anon, authenticated;
