-- Migration: Tighten RLS policies to enforce row-level ownership
-- This replaces overly permissive USING (true) policies with proper ownership checks.
-- Run this in your Supabase SQL Editor.

-- ============================================================
-- WALLETS: Users can only read their own wallet
-- ============================================================
DROP POLICY IF EXISTS "wallets_select_own" ON wallets;
CREATE POLICY "wallets_select_own" ON wallets
  FOR SELECT USING (
    auth.uid()::text = user_id
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "wallets_update_own" ON wallets;
CREATE POLICY "wallets_update_own" ON wallets
  FOR UPDATE USING (
    auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "wallets_insert" ON wallets;
CREATE POLICY "wallets_insert" ON wallets
  FOR INSERT WITH CHECK (
    auth.role() = 'service_role'
  );

-- Revoke any old "allow all" policies on wallets
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE tablename = 'wallets' AND qual = 'true' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON wallets', r.policyname);
  END LOOP;
END $$;

-- ============================================================
-- WALLET_LEDGER: Users can only read their own ledger entries
-- ============================================================
DROP POLICY IF EXISTS "wallet_ledger_select_own" ON wallet_ledger;
CREATE POLICY "wallet_ledger_select_own" ON wallet_ledger
  FOR SELECT USING (
    auth.uid()::text = retailer_id
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "wallet_ledger_insert" ON wallet_ledger;
CREATE POLICY "wallet_ledger_insert" ON wallet_ledger
  FOR INSERT WITH CHECK (
    auth.role() = 'service_role'
  );

-- ============================================================
-- RETAILERS: Retailers can only read their own record
-- ============================================================
DROP POLICY IF EXISTS "retailers_select_own" ON retailers;
CREATE POLICY "retailers_select_own" ON retailers
  FOR SELECT USING (
    auth.uid()::text = partner_id
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "retailers_update_own" ON retailers;
CREATE POLICY "retailers_update_own" ON retailers
  FOR UPDATE USING (
    auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "retailers_insert" ON retailers;
CREATE POLICY "retailers_insert" ON retailers
  FOR INSERT WITH CHECK (
    auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "retailers_delete" ON retailers;
CREATE POLICY "retailers_delete" ON retailers
  FOR DELETE USING (
    auth.role() = 'service_role'
  );

-- ============================================================
-- DISTRIBUTORS: Distributors can only read their own record
-- ============================================================
DROP POLICY IF EXISTS "distributors_select_own" ON distributors;
CREATE POLICY "distributors_select_own" ON distributors
  FOR SELECT USING (
    auth.uid()::text = partner_id
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "distributors_update_own" ON distributors;
CREATE POLICY "distributors_update_own" ON distributors
  FOR UPDATE USING (
    auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "distributors_insert" ON distributors;
CREATE POLICY "distributors_insert" ON distributors
  FOR INSERT WITH CHECK (
    auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "distributors_delete" ON distributors;
CREATE POLICY "distributors_delete" ON distributors
  FOR DELETE USING (
    auth.role() = 'service_role'
  );

-- ============================================================
-- MASTER_DISTRIBUTORS: MDs can only read their own record
-- ============================================================
DROP POLICY IF EXISTS "master_distributors_select_own" ON master_distributors;
CREATE POLICY "master_distributors_select_own" ON master_distributors
  FOR SELECT USING (
    auth.uid()::text = partner_id
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "master_distributors_update_own" ON master_distributors;
CREATE POLICY "master_distributors_update_own" ON master_distributors
  FOR UPDATE USING (
    auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "master_distributors_insert" ON master_distributors;
CREATE POLICY "master_distributors_insert" ON master_distributors
  FOR INSERT WITH CHECK (
    auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "master_distributors_delete" ON master_distributors;
CREATE POLICY "master_distributors_delete" ON master_distributors
  FOR DELETE USING (
    auth.role() = 'service_role'
  );

-- ============================================================
-- SCHEMES: Only service_role can write (prevent browser-side writes)
-- ============================================================
DROP POLICY IF EXISTS "schemes_select_authenticated" ON schemes;
CREATE POLICY "schemes_select_authenticated" ON schemes
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));

DROP POLICY IF EXISTS "schemes_insert_service" ON schemes;
CREATE POLICY "schemes_insert_service" ON schemes
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "schemes_update_service" ON schemes;
CREATE POLICY "schemes_update_service" ON schemes
  FOR UPDATE USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "schemes_delete_service" ON schemes;
CREATE POLICY "schemes_delete_service" ON schemes
  FOR DELETE USING (auth.role() = 'service_role');

-- ============================================================
-- SCHEME_MAPPINGS: Only service_role can write
-- ============================================================
DROP POLICY IF EXISTS "scheme_mappings_select" ON scheme_mappings;
CREATE POLICY "scheme_mappings_select" ON scheme_mappings
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));

DROP POLICY IF EXISTS "scheme_mappings_insert_service" ON scheme_mappings;
CREATE POLICY "scheme_mappings_insert_service" ON scheme_mappings
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "scheme_mappings_update_service" ON scheme_mappings;
CREATE POLICY "scheme_mappings_update_service" ON scheme_mappings
  FOR UPDATE USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "scheme_mappings_delete_service" ON scheme_mappings;
CREATE POLICY "scheme_mappings_delete_service" ON scheme_mappings
  FOR DELETE USING (auth.role() = 'service_role');

-- ============================================================
-- BBPS_TRANSACTIONS: Users can only see their own transactions
-- ============================================================
DROP POLICY IF EXISTS "bbps_transactions_select_own" ON bbps_transactions;
CREATE POLICY "bbps_transactions_select_own" ON bbps_transactions
  FOR SELECT USING (
    auth.uid()::text = retailer_id
    OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "bbps_transactions_insert" ON bbps_transactions;
CREATE POLICY "bbps_transactions_insert" ON bbps_transactions
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "bbps_transactions_update" ON bbps_transactions;
CREATE POLICY "bbps_transactions_update" ON bbps_transactions
  FOR UPDATE USING (auth.role() = 'service_role');

-- ============================================================
-- COMMISSIONS: Users can only see their own commissions (if table exists)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'commissions') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'commissions' AND column_name = 'user_id') THEN
      EXECUTE 'DROP POLICY IF EXISTS "commissions_select_own" ON commissions';
      EXECUTE 'CREATE POLICY "commissions_select_own" ON commissions
        FOR SELECT USING (
          auth.uid()::text = user_id
          OR auth.role() = ''service_role''
        )';
    END IF;
  END IF;
END $$;

-- ============================================================
-- PAYOUT_TRANSACTIONS: Users can only see their own
-- ============================================================
DROP POLICY IF EXISTS "payout_transactions_select_own" ON payout_transactions;
CREATE POLICY "payout_transactions_select_own" ON payout_transactions
  FOR SELECT USING (
    auth.uid()::text = retailer_id
    OR auth.role() = 'service_role'
  );

-- ============================================================
-- Clean up all remaining USING (true) policies on financial tables
-- ============================================================
DO $$
DECLARE
  r RECORD;
  financial_tables TEXT[] := ARRAY[
    'wallets', 'wallet_ledger', 'retailers', 'distributors',
    'master_distributors', 'schemes', 'scheme_mappings',
    'bbps_transactions', 'payout_transactions', 'commissions'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY financial_tables LOOP
    FOR r IN
      SELECT policyname FROM pg_policies
      WHERE tablename = t AND qual = 'true'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, t);
    END LOOP;
  END LOOP;
END $$;
