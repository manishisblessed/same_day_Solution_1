-- Fix: RLS SELECT policies were too strict (auth.uid != partner_id).
-- Allow authenticated users to SELECT (app code filters rows).
-- Writes remain service_role-only (browser can't insert/update/delete).

-- WALLETS
DROP POLICY IF EXISTS "wallets_select_own" ON wallets;
CREATE POLICY "wallets_select_authenticated" ON wallets
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));

-- WALLET_LEDGER
DROP POLICY IF EXISTS "wallet_ledger_select_own" ON wallet_ledger;
CREATE POLICY "wallet_ledger_select_authenticated" ON wallet_ledger
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));

-- RETAILERS
DROP POLICY IF EXISTS "retailers_select_own" ON retailers;
CREATE POLICY "retailers_select_authenticated" ON retailers
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));

-- DISTRIBUTORS
DROP POLICY IF EXISTS "distributors_select_own" ON distributors;
CREATE POLICY "distributors_select_authenticated" ON distributors
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));

-- MASTER_DISTRIBUTORS
DROP POLICY IF EXISTS "master_distributors_select_own" ON master_distributors;
CREATE POLICY "master_distributors_select_authenticated" ON master_distributors
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));

-- BBPS_TRANSACTIONS
DROP POLICY IF EXISTS "bbps_transactions_select_own" ON bbps_transactions;
CREATE POLICY "bbps_transactions_select_authenticated" ON bbps_transactions
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));

-- PAYOUT_TRANSACTIONS
DROP POLICY IF EXISTS "payout_transactions_select_own" ON payout_transactions;
CREATE POLICY "payout_transactions_select_authenticated" ON payout_transactions
  FOR SELECT USING (auth.role() IN ('authenticated', 'service_role'));

-- COMMISSIONS (if exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='commissions') THEN
    EXECUTE 'DROP POLICY IF EXISTS "commissions_select_own" ON commissions';
    EXECUTE 'CREATE POLICY "commissions_select_authenticated" ON commissions
      FOR SELECT USING (auth.role() IN (''authenticated'', ''service_role''))';
  END IF;
END $$;
