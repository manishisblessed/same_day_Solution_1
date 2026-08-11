-- Phase final: revoke authenticated public-schema access; drop open USING(true) policies
-- After this, only service_role (API routes) can touch public data.
-- Pair: phase-final-rollback.sql
BEGIN;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM authenticated;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('postgres','supabase_admin') LOOP
    BEGIN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated', r.rolname);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated', r.rolname);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM authenticated', r.rolname);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipping default privileges for role %: %', r.rolname, SQLERRM;
    END;
  END LOOP;
END $$;

-- Explicit revoke on balance RPCs (defense in depth)
REVOKE ALL ON FUNCTION public.get_partner_wallet_balance(p_partner_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_wallet_balance(p_partner_id uuid) TO service_role;
REVOKE ALL ON FUNCTION public.get_wallet_balance(p_retailer_id text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_wallet_balance(p_retailer_id text) TO service_role;
REVOKE ALL ON FUNCTION public.get_wallet_balance_v2(p_user_id text, p_wallet_type text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_wallet_balance_v2(p_user_id text, p_wallet_type text) TO service_role;

-- Drop permissive USING(true) policies (RLS stays on → default deny for non-service roles)
DROP POLICY IF EXISTS activity_logs_insert_service ON public.activity_logs;
DROP POLICY IF EXISTS admin_audit_log_insert_service ON public.admin_audit_log;
DROP POLICY IF EXISTS "Admins can create impersonation sessions" ON public.admin_impersonation_sessions;
DROP POLICY IF EXISTS "Admins can update impersonation sessions" ON public.admin_impersonation_sessions;
DROP POLICY IF EXISTS "Admins can view their impersonation sessions" ON public.admin_impersonation_sessions;
DROP POLICY IF EXISTS admin_impersonation_sessions_insert_service ON public.admin_impersonation_sessions;
DROP POLICY IF EXISTS "Admins can delete admin_users" ON public.admin_users;
DROP POLICY IF EXISTS "Admins can insert admin_users" ON public.admin_users;
DROP POLICY IF EXISTS "Admins can read admin_users" ON public.admin_users;
DROP POLICY IF EXISTS "Admins can update admin_users" ON public.admin_users;
DROP POLICY IF EXISTS "Allow all" ON public.admin_users;
DROP POLICY IF EXISTS "Anyone can view banks" ON public.aeps_banks;
DROP POLICY IF EXISTS aeps_settle_acct_insert ON public.aeps_settlement_accounts;
DROP POLICY IF EXISTS aeps_settlements_insert ON public.aeps_settlements;
DROP POLICY IF EXISTS "Service can insert AEPS transactions" ON public.aeps_transactions;
DROP POLICY IF EXISTS "Allow all" ON public.bbps_billers;
DROP POLICY IF EXISTS bbps_transactions_insert ON public.bbps_transactions;
DROP POLICY IF EXISTS "Admins can manage distributors" ON public.distributors;
DROP POLICY IF EXISTS "Anyone can read distributors" ON public.distributors;
DROP POLICY IF EXISTS distributors_insert ON public.distributors;
DROP POLICY IF EXISTS "Service role full access" ON public.export_jobs;
DROP POLICY IF EXISTS "Admins can manage master_distributors" ON public.master_distributors;
DROP POLICY IF EXISTS "Anyone can read master_distributors" ON public.master_distributors;
DROP POLICY IF EXISTS master_distributors_insert ON public.master_distributors;
DROP POLICY IF EXISTS "Service role full access" ON public.partner_api_keys;
DROP POLICY IF EXISTS "Service role full access" ON public.partner_export_limits;
DROP POLICY IF EXISTS "Service role full access" ON public.partner_merchant_links;
DROP POLICY IF EXISTS "Service role full access" ON public.partner_pos_machines;
DROP POLICY IF EXISTS "Service role full access" ON public.partner_retailers;
DROP POLICY IF EXISTS "Service role full access" ON public.partner_schemes;
DROP POLICY IF EXISTS "Service role full access" ON public.partner_t1_cron_settings;
DROP POLICY IF EXISTS "Service role full access" ON public.partner_wallet_ledger;
DROP POLICY IF EXISTS "Service role full access" ON public.partner_wallets;
DROP POLICY IF EXISTS "Service role full access" ON public.partners;
DROP POLICY IF EXISTS "Retailers can insert their own payout transactions" ON public.payout_transactions;
DROP POLICY IF EXISTS "Service role can manage all payout transactions" ON public.payout_transactions;
DROP POLICY IF EXISTS "Admin full access on portal_audit_log" ON public.portal_audit_log;
DROP POLICY IF EXISTS "Admin full access on portal_settings" ON public.portal_settings;
DROP POLICY IF EXISTS "Allow all on pos_assignment_history" ON public.pos_assignment_history;
DROP POLICY IF EXISTS "Admins can manage pos_device_mapping" ON public.pos_device_mapping;
DROP POLICY IF EXISTS "Admins can manage pos_machines" ON public.pos_machines;
DROP POLICY IF EXISTS "Allow all" ON public.pos_machines;
DROP POLICY IF EXISTS "Anyone can read pos_machines" ON public.pos_machines;
DROP POLICY IF EXISTS "Allow all" ON public.pos_terminals;
DROP POLICY IF EXISTS "Service role full access" ON public.pos_transactions;
DROP POLICY IF EXISTS "Admins can read razorpay_pos_transactions" ON public.razorpay_pos_transactions;
DROP POLICY IF EXISTS "Allow read razorpay_transactions" ON public.razorpay_transactions;
DROP POLICY IF EXISTS "Admins can manage retailers" ON public.retailers;
DROP POLICY IF EXISTS "Anyone can read retailers" ON public.retailers;
DROP POLICY IF EXISTS retailers_insert ON public.retailers;
DROP POLICY IF EXISTS "Retailers can insert own beneficiaries" ON public.saved_beneficiaries;
DROP POLICY IF EXISTS scheme_aeps_insert_policy ON public.scheme_aeps_commissions;
DROP POLICY IF EXISTS aeps_settle_insert_policy ON public.scheme_aeps_settlement_charges;
DROP POLICY IF EXISTS scheme_bbps_insert_policy ON public.scheme_bbps_commissions;
DROP POLICY IF EXISTS scheme_mappings_insert_policy ON public.scheme_mappings;
DROP POLICY IF EXISTS scheme_mappings_insert_service ON public.scheme_mappings;
DROP POLICY IF EXISTS scheme_mdr_insert_policy ON public.scheme_mdr_rates;
DROP POLICY IF EXISTS scheme_payout_insert_policy ON public.scheme_payout_charges;
DROP POLICY IF EXISTS "Service role full access scheme_shadval_settlement_charges" ON public.scheme_shadval_settlement_charges;
DROP POLICY IF EXISTS schemes_insert_policy ON public.schemes;
DROP POLICY IF EXISTS schemes_insert_service ON public.schemes;
DROP POLICY IF EXISTS "Service role full access" ON public.settlement_callback_logs;
DROP POLICY IF EXISTS "Service role full access shadval_settlement" ON public.shadval_settlement;
DROP POLICY IF EXISTS "Service role full access shadval_settlement_accounts" ON public.shadval_settlement_accounts;
DROP POLICY IF EXISTS "Service role full access on sub_partners" ON public.sub_partners;
DROP POLICY IF EXISTS "Allow all subscription_commissions" ON public.subscription_commissions;
DROP POLICY IF EXISTS "Admin all subscription_debits" ON public.subscription_debits;
DROP POLICY IF EXISTS "Users read own subscription_debits" ON public.subscription_debits;
DROP POLICY IF EXISTS "Allow all subscription_items" ON public.subscription_items;
DROP POLICY IF EXISTS "Allow all subscription_product_rates" ON public.subscription_product_rates;
DROP POLICY IF EXISTS "Allow all subscription_products" ON public.subscription_products;
DROP POLICY IF EXISTS "Admin all subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS "Users read own subscriptions" ON public.subscriptions;
DROP POLICY IF EXISTS wallet_ledger_insert ON public.wallet_ledger;
DROP POLICY IF EXISTS wallet_transfers_insert ON public.wallet_transfers;
DROP POLICY IF EXISTS wallets_insert ON public.wallets;

COMMIT;
