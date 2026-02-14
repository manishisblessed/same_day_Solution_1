-- ============================================================================
-- SCHEME MANAGEMENT - ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
-- Production-ready RLS for: schemes, scheme_mappings, scheme_bbps_commissions,
-- scheme_payout_charges, scheme_mdr_rates
-- ============================================================================
-- NOTE: API routes use the service_role key (via lib/scheme/scheme.service.ts),
-- which bypasses RLS. These policies protect against direct client-side access
-- using the anon key (e.g., from browser Supabase client).
--
-- STRATEGY:
-- - SELECT: Allow all authenticated users to read (client code already filters)
-- - INSERT/UPDATE/DELETE: Restrict to authenticated users only
--   (Server-side API routes do deeper ownership checks and use service_role key)
-- ============================================================================

-- ============================================================================
-- 1. ENABLE RLS ON ALL SCHEME TABLES
-- ============================================================================

ALTER TABLE schemes ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheme_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheme_bbps_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheme_payout_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheme_mdr_rates ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2. DROP EXISTING POLICIES (if any) TO AVOID CONFLICTS
-- ============================================================================

DROP POLICY IF EXISTS "schemes_select_policy" ON schemes;
DROP POLICY IF EXISTS "schemes_insert_policy" ON schemes;
DROP POLICY IF EXISTS "schemes_update_policy" ON schemes;
DROP POLICY IF EXISTS "schemes_delete_policy" ON schemes;

DROP POLICY IF EXISTS "scheme_mappings_select_policy" ON scheme_mappings;
DROP POLICY IF EXISTS "scheme_mappings_insert_policy" ON scheme_mappings;
DROP POLICY IF EXISTS "scheme_mappings_update_policy" ON scheme_mappings;
DROP POLICY IF EXISTS "scheme_mappings_delete_policy" ON scheme_mappings;

DROP POLICY IF EXISTS "scheme_bbps_select_policy" ON scheme_bbps_commissions;
DROP POLICY IF EXISTS "scheme_bbps_insert_policy" ON scheme_bbps_commissions;
DROP POLICY IF EXISTS "scheme_bbps_update_policy" ON scheme_bbps_commissions;
DROP POLICY IF EXISTS "scheme_bbps_delete_policy" ON scheme_bbps_commissions;

DROP POLICY IF EXISTS "scheme_payout_select_policy" ON scheme_payout_charges;
DROP POLICY IF EXISTS "scheme_payout_insert_policy" ON scheme_payout_charges;
DROP POLICY IF EXISTS "scheme_payout_update_policy" ON scheme_payout_charges;
DROP POLICY IF EXISTS "scheme_payout_delete_policy" ON scheme_payout_charges;

DROP POLICY IF EXISTS "scheme_mdr_select_policy" ON scheme_mdr_rates;
DROP POLICY IF EXISTS "scheme_mdr_insert_policy" ON scheme_mdr_rates;
DROP POLICY IF EXISTS "scheme_mdr_update_policy" ON scheme_mdr_rates;
DROP POLICY IF EXISTS "scheme_mdr_delete_policy" ON scheme_mdr_rates;

-- ============================================================================
-- 3. SCHEMES TABLE POLICIES
-- ============================================================================

-- SELECT: Any authenticated user can read schemes
-- (Client code already filters by created_by_id, entity_id, etc.)
CREATE POLICY "schemes_select_policy" ON schemes
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- INSERT: Any authenticated user can create schemes
-- (API routes enforce role-based restrictions: only admin/MD/distributor)
CREATE POLICY "schemes_insert_policy" ON schemes
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- UPDATE: Any authenticated user can update schemes
-- (API routes verify ownership: only creator or admin can update)
CREATE POLICY "schemes_update_policy" ON schemes
  FOR UPDATE
  USING (auth.role() = 'authenticated');

-- DELETE: Any authenticated user can delete schemes
-- (API routes verify: only admin can delete global, creator can delete custom)
CREATE POLICY "schemes_delete_policy" ON schemes
  FOR DELETE
  USING (auth.role() = 'authenticated');

-- ============================================================================
-- 4. SCHEME MAPPINGS TABLE POLICIES
-- ============================================================================

CREATE POLICY "scheme_mappings_select_policy" ON scheme_mappings
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "scheme_mappings_insert_policy" ON scheme_mappings
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "scheme_mappings_update_policy" ON scheme_mappings
  FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "scheme_mappings_delete_policy" ON scheme_mappings
  FOR DELETE
  USING (auth.role() = 'authenticated');

-- ============================================================================
-- 5. SCHEME BBPS COMMISSIONS POLICIES
-- ============================================================================

CREATE POLICY "scheme_bbps_select_policy" ON scheme_bbps_commissions
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "scheme_bbps_insert_policy" ON scheme_bbps_commissions
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "scheme_bbps_update_policy" ON scheme_bbps_commissions
  FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "scheme_bbps_delete_policy" ON scheme_bbps_commissions
  FOR DELETE
  USING (auth.role() = 'authenticated');

-- ============================================================================
-- 6. SCHEME PAYOUT CHARGES POLICIES
-- ============================================================================

CREATE POLICY "scheme_payout_select_policy" ON scheme_payout_charges
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "scheme_payout_insert_policy" ON scheme_payout_charges
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "scheme_payout_update_policy" ON scheme_payout_charges
  FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "scheme_payout_delete_policy" ON scheme_payout_charges
  FOR DELETE
  USING (auth.role() = 'authenticated');

-- ============================================================================
-- 7. SCHEME MDR RATES POLICIES
-- ============================================================================

CREATE POLICY "scheme_mdr_select_policy" ON scheme_mdr_rates
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "scheme_mdr_insert_policy" ON scheme_mdr_rates
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "scheme_mdr_update_policy" ON scheme_mdr_rates
  FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "scheme_mdr_delete_policy" ON scheme_mdr_rates
  FOR DELETE
  USING (auth.role() = 'authenticated');

-- ============================================================================
-- DONE: Run this migration in your Supabase SQL editor
-- ============================================================================
-- After running, verify with:
-- SELECT tablename, policyname FROM pg_policies WHERE tablename LIKE 'scheme%';
-- ============================================================================
--
-- SECURITY NOTE:
-- These RLS policies allow any authenticated user to read/write scheme tables.
-- The real authorization is enforced at the API route level:
--   - POST /api/schemes: Only admin/MD/distributor can create
--   - PUT /api/schemes/[id]: Only creator or admin can update
--   - DELETE /api/schemes/[id]: Only admin or creator can delete
--   - POST /api/schemes/mappings: Ownership verification (distributor owns retailer, etc.)
--   - DELETE /api/schemes/mappings: Only the assigner can delete
-- Client-side queries also filter by created_by_id and entity_id.
-- ============================================================================
