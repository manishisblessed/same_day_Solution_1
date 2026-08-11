-- Phase 1: Lock out anon from public schema + revoke danger SECURITY DEFINER funcs
-- from anon and authenticated. Keeps authenticated table access + balance RPCs.
-- Pair: phase1-rollback.sql
BEGIN;

-- 1) Revoke all anon access on existing public objects
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- 2) Prevent future objects from auto-granting to anon
-- Current role's defaults
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
-- Best-effort for known grantors (skip roles we cannot alter)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('postgres','supabase_admin') LOOP
    BEGIN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM anon',
        r.rolname);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon',
        r.rolname);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon',
        r.rolname);
    EXCEPTION WHEN insufficient_privilege OR OTHERS THEN
      RAISE NOTICE 'Skipping default privileges for role %: %', r.rolname, SQLERRM;
    END;
  END LOOP;
END $$;

-- 3) Revoke EXECUTE on server-only SECURITY DEFINER (and related) funcs
-- from both anon and authenticated. service_role keeps EXECUTE.
REVOKE EXECUTE ON FUNCTION public.assign_pos_device(p_machine_id uuid, p_assign_to text, p_assign_to_role text, p_assigned_by text, p_assigned_by_role text, p_inventory_status text, p_owner_field text, p_clear_fields text[], p_notes text, p_sync_partner_pos boolean, p_partner_machine_data jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.backfill_pos_retailer_ids() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.calculate_aeps_commission_from_scheme(p_scheme_id uuid, p_amount numeric, p_transaction_type text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.calculate_shadval_settlement_charge_from_scheme(p_scheme_id uuid, p_amount numeric, p_transfer_mode text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_admin_permission(p_admin_id uuid, p_department text, p_action text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_admin_permission(p_admin_id uuid, p_permission_key text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(p_key text, p_max_requests integer, p_window_ms integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_sessions() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.credit_partner_wallet(p_partner_id uuid, p_amount numeric, p_description text, p_reference_id text, p_transaction_type text, p_service_type text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.debit_partner_wallet(p_partner_id uuid, p_amount numeric, p_payout_transaction_id uuid, p_description text, p_reference_id text, p_service_type text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_partner_wallet(p_partner_id uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_aeps_stats(p_user_id text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_partner_scheme(p_partner_id uuid, p_mode text, p_card_type text, p_brand_type text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_paused_partner_ids() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_pos_stats() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_pos_tracking_summary(p_date_from timestamp with time zone, p_date_to timestamp with time zone) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_activity(p_user_id text, p_user_role text, p_activity_type text, p_activity_category text, p_activity_description text, p_reference_id text, p_reference_table text, p_latitude numeric, p_longitude numeric, p_geo_accuracy numeric, p_geo_source text, p_ip_address inet, p_user_agent text, p_device_info jsonb, p_request_path text, p_request_method text, p_status text, p_error_message text, p_metadata jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_business_analytics() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_partner_wallet(p_partner_id uuid, p_amount numeric, p_payout_transaction_id uuid, p_description text, p_reference_id text, p_service_type text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.return_pos_device(p_machine_id uuid, p_returned_by text, p_notes text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_distributor_tpin(p_distributor_id text, p_tpin text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_partner_tpin(p_partner_id text, p_tpin text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_partner_wallet_frozen(p_partner_id uuid, p_frozen boolean, p_reason text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_retailer_tpin(p_retailer_id text, p_tpin text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.settle_pos_txn_t1(p_txn_id uuid, p_retailer_id text, p_gross numeric, p_retailer_mdr numeric, p_retailer_fee numeric, p_retailer_net numeric, p_scheme_id text, p_scheme_type text, p_distributor_id text, p_distributor_mdr numeric, p_distributor_commission numeric, p_tid text, p_retailer_name text, p_retailer_ref text, p_commission_ref text, p_distributor_tds numeric, p_master_distributor_id text, p_md_mdr numeric, p_md_commission numeric, p_md_commission_ref text, p_md_tds numeric) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_distributor_tpin(p_distributor_id text, p_tpin text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_partner_tpin(p_partner_id text, p_tpin text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_retailer_tpin(p_retailer_id text, p_tpin text) FROM anon, authenticated;

-- Keep authenticated EXECUTE on balance RPCs used by browser until Phase 3-final:
--   get_partner_wallet_balance, get_wallet_balance, get_wallet_balance_v2

COMMIT;
