-- Fix RLS policies so users can read their own row during login.
-- The existing policies only allow partner_id match (for partners viewing
-- their downline) and service_role. Users logging in via the browser client
-- need to read their own row by email to complete authentication.

-- ── retailers ──
DROP POLICY IF EXISTS retailers_select_own ON retailers;
CREATE POLICY retailers_select_own ON retailers FOR SELECT USING (
  auth.uid()::text = partner_id          -- partner viewing their downline
  OR email = (auth.jwt() ->> 'email')    -- user reading own row (login + dashboard)
  OR auth.role() = 'service_role'        -- server-side operations
);

-- ── distributors ──
DROP POLICY IF EXISTS distributors_select_own ON distributors;
CREATE POLICY distributors_select_own ON distributors FOR SELECT USING (
  auth.uid()::text = partner_id
  OR email = (auth.jwt() ->> 'email')
  OR auth.role() = 'service_role'
);

-- ── master_distributors ──
DROP POLICY IF EXISTS master_distributors_select_own ON master_distributors;
CREATE POLICY master_distributors_select_own ON master_distributors FOR SELECT USING (
  auth.uid()::text = partner_id
  OR email = (auth.jwt() ->> 'email')
  OR auth.role() = 'service_role'
);
