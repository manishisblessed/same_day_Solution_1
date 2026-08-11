-- Phase 1b: Revoke PUBLIC EXECUTE on public functions; re-grant selectively.
-- anon loses all function EXECUTE. authenticated keeps non-danger + balance RPCs.
-- service_role keeps EXECUTE on everything.
-- Pair: phase1b-rollback.sql
BEGIN;

REVOKE ALL ON FUNCTION public.add_ledger_entry(p_user_id text, p_user_role text, p_wallet_type text, p_fund_category text, p_service_type text, p_tx_type text, p_credit numeric, p_debit numeric, p_reference_id text, p_transaction_id uuid, p_status text, p_remarks text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_ledger_entry(p_user_id text, p_user_role text, p_wallet_type text, p_fund_category text, p_service_type text, p_tx_type text, p_credit numeric, p_debit numeric, p_reference_id text, p_transaction_id uuid, p_status text, p_remarks text) FROM anon;
GRANT EXECUTE ON FUNCTION public.add_ledger_entry(p_user_id text, p_user_role text, p_wallet_type text, p_fund_category text, p_service_type text, p_tx_type text, p_credit numeric, p_debit numeric, p_reference_id text, p_transaction_id uuid, p_status text, p_remarks text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_ledger_entry(p_user_id text, p_user_role text, p_wallet_type text, p_fund_category text, p_service_type text, p_tx_type text, p_credit numeric, p_debit numeric, p_reference_id text, p_transaction_id uuid, p_status text, p_remarks text) TO service_role;

REVOKE ALL ON FUNCTION public.assign_pos_device(p_machine_id uuid, p_assign_to text, p_assign_to_role text, p_assigned_by text, p_assigned_by_role text, p_inventory_status text, p_owner_field text, p_clear_fields text[], p_notes text, p_sync_partner_pos boolean, p_partner_machine_data jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_pos_device(p_machine_id uuid, p_assign_to text, p_assign_to_role text, p_assigned_by text, p_assigned_by_role text, p_inventory_status text, p_owner_field text, p_clear_fields text[], p_notes text, p_sync_partner_pos boolean, p_partner_machine_data jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.assign_pos_device(p_machine_id uuid, p_assign_to text, p_assign_to_role text, p_assigned_by text, p_assigned_by_role text, p_inventory_status text, p_owner_field text, p_clear_fields text[], p_notes text, p_sync_partner_pos boolean, p_partner_machine_data jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.assign_pos_device(p_machine_id uuid, p_assign_to text, p_assign_to_role text, p_assigned_by text, p_assigned_by_role text, p_inventory_status text, p_owner_field text, p_clear_fields text[], p_notes text, p_sync_partner_pos boolean, p_partner_machine_data jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.ba_user_service_usage(p_from timestamp with time zone, p_to timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ba_user_service_usage(p_from timestamp with time zone, p_to timestamp with time zone) FROM anon;
GRANT EXECUTE ON FUNCTION public.ba_user_service_usage(p_from timestamp with time zone, p_to timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ba_user_service_usage(p_from timestamp with time zone, p_to timestamp with time zone) TO service_role;

REVOKE ALL ON FUNCTION public.backfill_pos_retailer_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backfill_pos_retailer_ids() FROM anon;
REVOKE ALL ON FUNCTION public.backfill_pos_retailer_ids() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_pos_retailer_ids() TO service_role;

REVOKE ALL ON FUNCTION public.block_mutation_activity_logs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.block_mutation_activity_logs() FROM anon;
GRANT EXECUTE ON FUNCTION public.block_mutation_activity_logs() TO authenticated;
GRANT EXECUTE ON FUNCTION public.block_mutation_activity_logs() TO service_role;

REVOKE ALL ON FUNCTION public.block_mutation_admin_audit_log() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.block_mutation_admin_audit_log() FROM anon;
GRANT EXECUTE ON FUNCTION public.block_mutation_admin_audit_log() TO authenticated;
GRANT EXECUTE ON FUNCTION public.block_mutation_admin_audit_log() TO service_role;

REVOKE ALL ON FUNCTION public.block_mutation_admin_impersonation_sessions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.block_mutation_admin_impersonation_sessions() FROM anon;
GRANT EXECUTE ON FUNCTION public.block_mutation_admin_impersonation_sessions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.block_mutation_admin_impersonation_sessions() TO service_role;

REVOKE ALL ON FUNCTION public.calculate_aeps_commission_from_scheme(p_scheme_id uuid, p_amount numeric, p_transaction_type text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calculate_aeps_commission_from_scheme(p_scheme_id uuid, p_amount numeric, p_transaction_type text) FROM anon;
REVOKE ALL ON FUNCTION public.calculate_aeps_commission_from_scheme(p_scheme_id uuid, p_amount numeric, p_transaction_type text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_aeps_commission_from_scheme(p_scheme_id uuid, p_amount numeric, p_transaction_type text) TO service_role;

REVOKE ALL ON FUNCTION public.calculate_aeps_settlement_charge_from_scheme(p_scheme_id uuid, p_amount numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calculate_aeps_settlement_charge_from_scheme(p_scheme_id uuid, p_amount numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.calculate_aeps_settlement_charge_from_scheme(p_scheme_id uuid, p_amount numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_aeps_settlement_charge_from_scheme(p_scheme_id uuid, p_amount numeric) TO service_role;

REVOKE ALL ON FUNCTION public.calculate_bbps_charge_from_scheme(p_scheme_id uuid, p_amount numeric, p_category text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calculate_bbps_charge_from_scheme(p_scheme_id uuid, p_amount numeric, p_category text) FROM anon;
GRANT EXECUTE ON FUNCTION public.calculate_bbps_charge_from_scheme(p_scheme_id uuid, p_amount numeric, p_category text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_bbps_charge_from_scheme(p_scheme_id uuid, p_amount numeric, p_category text) TO service_role;

REVOKE ALL ON FUNCTION public.calculate_commission_hierarchy(p_transaction_id uuid, p_transaction_type text, p_gross_amount numeric, p_retailer_id text, p_distributor_id text, p_master_distributor_id text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calculate_commission_hierarchy(p_transaction_id uuid, p_transaction_type text, p_gross_amount numeric, p_retailer_id text, p_distributor_id text, p_master_distributor_id text) FROM anon;
GRANT EXECUTE ON FUNCTION public.calculate_commission_hierarchy(p_transaction_id uuid, p_transaction_type text, p_gross_amount numeric, p_retailer_id text, p_distributor_id text, p_master_distributor_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_commission_hierarchy(p_transaction_id uuid, p_transaction_type text, p_gross_amount numeric, p_retailer_id text, p_distributor_id text, p_master_distributor_id text) TO service_role;

REVOKE ALL ON FUNCTION public.calculate_payout_charge_from_scheme(p_scheme_id uuid, p_amount numeric, p_transfer_mode text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calculate_payout_charge_from_scheme(p_scheme_id uuid, p_amount numeric, p_transfer_mode text) FROM anon;
GRANT EXECUTE ON FUNCTION public.calculate_payout_charge_from_scheme(p_scheme_id uuid, p_amount numeric, p_transfer_mode text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_payout_charge_from_scheme(p_scheme_id uuid, p_amount numeric, p_transfer_mode text) TO service_role;

REVOKE ALL ON FUNCTION public.calculate_shadval_charge_from_scheme(p_scheme_id uuid, p_amount numeric, p_transfer_mode text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calculate_shadval_charge_from_scheme(p_scheme_id uuid, p_amount numeric, p_transfer_mode text) FROM anon;
GRANT EXECUTE ON FUNCTION public.calculate_shadval_charge_from_scheme(p_scheme_id uuid, p_amount numeric, p_transfer_mode text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_shadval_charge_from_scheme(p_scheme_id uuid, p_amount numeric, p_transfer_mode text) TO service_role;

REVOKE ALL ON FUNCTION public.calculate_shadval_settlement_charge_from_scheme(p_scheme_id uuid, p_amount numeric, p_transfer_mode text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calculate_shadval_settlement_charge_from_scheme(p_scheme_id uuid, p_amount numeric, p_transfer_mode text) FROM anon;
REVOKE ALL ON FUNCTION public.calculate_shadval_settlement_charge_from_scheme(p_scheme_id uuid, p_amount numeric, p_transfer_mode text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_shadval_settlement_charge_from_scheme(p_scheme_id uuid, p_amount numeric, p_transfer_mode text) TO service_role;

REVOKE ALL ON FUNCTION public.calculate_transaction_charge(p_amount numeric, p_transaction_type text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calculate_transaction_charge(p_amount numeric, p_transaction_type text) FROM anon;
GRANT EXECUTE ON FUNCTION public.calculate_transaction_charge(p_amount numeric, p_transaction_type text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_transaction_charge(p_amount numeric, p_transaction_type text) TO service_role;

REVOKE ALL ON FUNCTION public.check_admin_permission(p_admin_id uuid, p_department text, p_action text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_admin_permission(p_admin_id uuid, p_department text, p_action text) FROM anon;
REVOKE ALL ON FUNCTION public.check_admin_permission(p_admin_id uuid, p_department text, p_action text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_admin_permission(p_admin_id uuid, p_department text, p_action text) TO service_role;

REVOKE ALL ON FUNCTION public.check_admin_permission(p_admin_id uuid, p_permission_key text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_admin_permission(p_admin_id uuid, p_permission_key text) FROM anon;
REVOKE ALL ON FUNCTION public.check_admin_permission(p_admin_id uuid, p_permission_key text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_admin_permission(p_admin_id uuid, p_permission_key text) TO service_role;

REVOKE ALL ON FUNCTION public.check_rate_limit(p_key text, p_max_requests integer, p_window_ms integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_rate_limit(p_key text, p_max_requests integer, p_window_ms integer) FROM anon;
REVOKE ALL ON FUNCTION public.check_rate_limit(p_key text, p_max_requests integer, p_window_ms integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(p_key text, p_max_requests integer, p_window_ms integer) TO service_role;

REVOKE ALL ON FUNCTION public.cleanup_expired_sessions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_expired_sessions() FROM anon;
REVOKE ALL ON FUNCTION public.cleanup_expired_sessions() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_sessions() TO service_role;

REVOKE ALL ON FUNCTION public.create_next_month_partition() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_next_month_partition() FROM anon;
GRANT EXECUTE ON FUNCTION public.create_next_month_partition() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_next_month_partition() TO service_role;

REVOKE ALL ON FUNCTION public.credit_partner_wallet(p_partner_id uuid, p_amount numeric, p_description text, p_reference_id text, p_transaction_type text, p_service_type text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.credit_partner_wallet(p_partner_id uuid, p_amount numeric, p_description text, p_reference_id text, p_transaction_type text, p_service_type text) FROM anon;
REVOKE ALL ON FUNCTION public.credit_partner_wallet(p_partner_id uuid, p_amount numeric, p_description text, p_reference_id text, p_transaction_type text, p_service_type text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.credit_partner_wallet(p_partner_id uuid, p_amount numeric, p_description text, p_reference_id text, p_transaction_type text, p_service_type text) TO service_role;

REVOKE ALL ON FUNCTION public.credit_wallet(p_retailer_id text, p_transaction_id uuid, p_amount numeric, p_description text, p_reference_id text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.credit_wallet(p_retailer_id text, p_transaction_id uuid, p_amount numeric, p_description text, p_reference_id text) FROM anon;
GRANT EXECUTE ON FUNCTION public.credit_wallet(p_retailer_id text, p_transaction_id uuid, p_amount numeric, p_description text, p_reference_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credit_wallet(p_retailer_id text, p_transaction_id uuid, p_amount numeric, p_description text, p_reference_id text) TO service_role;

REVOKE ALL ON FUNCTION public.credit_wallet_v2(p_user_id text, p_user_role text, p_wallet_type text, p_fund_category text, p_service_type text, p_amount numeric, p_credit numeric, p_transaction_id uuid, p_reference_id text, p_remarks text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.credit_wallet_v2(p_user_id text, p_user_role text, p_wallet_type text, p_fund_category text, p_service_type text, p_amount numeric, p_credit numeric, p_transaction_id uuid, p_reference_id text, p_remarks text) FROM anon;
GRANT EXECUTE ON FUNCTION public.credit_wallet_v2(p_user_id text, p_user_role text, p_wallet_type text, p_fund_category text, p_service_type text, p_amount numeric, p_credit numeric, p_transaction_id uuid, p_reference_id text, p_remarks text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.credit_wallet_v2(p_user_id text, p_user_role text, p_wallet_type text, p_fund_category text, p_service_type text, p_amount numeric, p_credit numeric, p_transaction_id uuid, p_reference_id text, p_remarks text) TO service_role;

REVOKE ALL ON FUNCTION public.debit_partner_wallet(p_partner_id uuid, p_amount numeric, p_payout_transaction_id uuid, p_description text, p_reference_id text, p_service_type text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.debit_partner_wallet(p_partner_id uuid, p_amount numeric, p_payout_transaction_id uuid, p_description text, p_reference_id text, p_service_type text) FROM anon;
REVOKE ALL ON FUNCTION public.debit_partner_wallet(p_partner_id uuid, p_amount numeric, p_payout_transaction_id uuid, p_description text, p_reference_id text, p_service_type text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.debit_partner_wallet(p_partner_id uuid, p_amount numeric, p_payout_transaction_id uuid, p_description text, p_reference_id text, p_service_type text) TO service_role;

REVOKE ALL ON FUNCTION public.debit_wallet_bbps(p_retailer_id text, p_transaction_id uuid, p_amount numeric, p_description text, p_reference_id text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.debit_wallet_bbps(p_retailer_id text, p_transaction_id uuid, p_amount numeric, p_description text, p_reference_id text) FROM anon;
GRANT EXECUTE ON FUNCTION public.debit_wallet_bbps(p_retailer_id text, p_transaction_id uuid, p_amount numeric, p_description text, p_reference_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.debit_wallet_bbps(p_retailer_id text, p_transaction_id uuid, p_amount numeric, p_description text, p_reference_id text) TO service_role;

REVOKE ALL ON FUNCTION public.debit_wallet_v2(p_user_id text, p_user_role text, p_wallet_type text, p_fund_category text, p_service_type text, p_amount numeric, p_debit numeric, p_transaction_id uuid, p_reference_id text, p_remarks text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.debit_wallet_v2(p_user_id text, p_user_role text, p_wallet_type text, p_fund_category text, p_service_type text, p_amount numeric, p_debit numeric, p_transaction_id uuid, p_reference_id text, p_remarks text) FROM anon;
GRANT EXECUTE ON FUNCTION public.debit_wallet_v2(p_user_id text, p_user_role text, p_wallet_type text, p_fund_category text, p_service_type text, p_amount numeric, p_debit numeric, p_transaction_id uuid, p_reference_id text, p_remarks text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.debit_wallet_v2(p_user_id text, p_user_role text, p_wallet_type text, p_fund_category text, p_service_type text, p_amount numeric, p_debit numeric, p_transaction_id uuid, p_reference_id text, p_remarks text) TO service_role;

REVOKE ALL ON FUNCTION public.ensure_partner_wallet(p_partner_id uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_partner_wallet(p_partner_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.ensure_partner_wallet(p_partner_id uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_partner_wallet(p_partner_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.ensure_wallet(p_user_id text, p_user_role text, p_wallet_type text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_wallet(p_user_id text, p_user_role text, p_wallet_type text) FROM anon;
GRANT EXECUTE ON FUNCTION public.ensure_wallet(p_user_id text, p_user_role text, p_wallet_type text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_wallet(p_user_id text, p_user_role text, p_wallet_type text) TO service_role;

REVOKE ALL ON FUNCTION public.get_aeps_stats(p_user_id text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_aeps_stats(p_user_id text) FROM anon;
REVOKE ALL ON FUNCTION public.get_aeps_stats(p_user_id text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_aeps_stats(p_user_id text) TO service_role;

REVOKE ALL ON FUNCTION public.get_daily_export_count(p_partner_id uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_daily_export_count(p_partner_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_daily_export_count(p_partner_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_export_count(p_partner_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.get_partner_scheme(p_partner_id uuid, p_mode text, p_card_type text, p_brand_type text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_partner_scheme(p_partner_id uuid, p_mode text, p_card_type text, p_brand_type text) FROM anon;
REVOKE ALL ON FUNCTION public.get_partner_scheme(p_partner_id uuid, p_mode text, p_card_type text, p_brand_type text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_scheme(p_partner_id uuid, p_mode text, p_card_type text, p_brand_type text) TO service_role;

REVOKE ALL ON FUNCTION public.get_partner_wallet_balance(p_partner_id uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_partner_wallet_balance(p_partner_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_partner_wallet_balance(p_partner_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_wallet_balance(p_partner_id uuid) TO service_role;

REVOKE ALL ON FUNCTION public.get_paused_partner_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_paused_partner_ids() FROM anon;
REVOKE ALL ON FUNCTION public.get_paused_partner_ids() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_paused_partner_ids() TO service_role;

REVOKE ALL ON FUNCTION public.get_pos_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pos_stats() FROM anon;
REVOKE ALL ON FUNCTION public.get_pos_stats() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_pos_stats() TO service_role;

REVOKE ALL ON FUNCTION public.get_pos_tracking_summary(p_date_from timestamp with time zone, p_date_to timestamp with time zone) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pos_tracking_summary(p_date_from timestamp with time zone, p_date_to timestamp with time zone) FROM anon;
REVOKE ALL ON FUNCTION public.get_pos_tracking_summary(p_date_from timestamp with time zone, p_date_to timestamp with time zone) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_pos_tracking_summary(p_date_from timestamp with time zone, p_date_to timestamp with time zone) TO service_role;

REVOKE ALL ON FUNCTION public.get_wallet_balance(p_retailer_id text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_wallet_balance(p_retailer_id text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_wallet_balance(p_retailer_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_wallet_balance(p_retailer_id text) TO service_role;

REVOKE ALL ON FUNCTION public.get_wallet_balance_v2(p_user_id text, p_wallet_type text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_wallet_balance_v2(p_user_id text, p_wallet_type text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_wallet_balance_v2(p_user_id text, p_wallet_type text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_wallet_balance_v2(p_user_id text, p_wallet_type text) TO service_role;

REVOKE ALL ON FUNCTION public.log_activity(p_user_id text, p_user_role text, p_activity_type text, p_activity_category text, p_activity_description text, p_reference_id text, p_reference_table text, p_latitude numeric, p_longitude numeric, p_geo_accuracy numeric, p_geo_source text, p_ip_address inet, p_user_agent text, p_device_info jsonb, p_request_path text, p_request_method text, p_status text, p_error_message text, p_metadata jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_activity(p_user_id text, p_user_role text, p_activity_type text, p_activity_category text, p_activity_description text, p_reference_id text, p_reference_table text, p_latitude numeric, p_longitude numeric, p_geo_accuracy numeric, p_geo_source text, p_ip_address inet, p_user_agent text, p_device_info jsonb, p_request_path text, p_request_method text, p_status text, p_error_message text, p_metadata jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.log_activity(p_user_id text, p_user_role text, p_activity_type text, p_activity_category text, p_activity_description text, p_reference_id text, p_reference_table text, p_latitude numeric, p_longitude numeric, p_geo_accuracy numeric, p_geo_source text, p_ip_address inet, p_user_agent text, p_device_info jsonb, p_request_path text, p_request_method text, p_status text, p_error_message text, p_metadata jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.log_activity(p_user_id text, p_user_role text, p_activity_type text, p_activity_category text, p_activity_description text, p_reference_id text, p_reference_table text, p_latitude numeric, p_longitude numeric, p_geo_accuracy numeric, p_geo_source text, p_ip_address inet, p_user_agent text, p_device_info jsonb, p_request_path text, p_request_method text, p_status text, p_error_message text, p_metadata jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.process_transaction_commission(p_transaction_id uuid, p_transaction_type text, p_gross_amount numeric, p_retailer_id text, p_distributor_id text, p_master_distributor_id text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_transaction_commission(p_transaction_id uuid, p_transaction_type text, p_gross_amount numeric, p_retailer_id text, p_distributor_id text, p_master_distributor_id text) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_transaction_commission(p_transaction_id uuid, p_transaction_type text, p_gross_amount numeric, p_retailer_id text, p_distributor_id text, p_master_distributor_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_transaction_commission(p_transaction_id uuid, p_transaction_type text, p_gross_amount numeric, p_retailer_id text, p_distributor_id text, p_master_distributor_id text) TO service_role;

REVOKE ALL ON FUNCTION public.recent_failed_logins(p_email text, p_window_minutes integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recent_failed_logins(p_email text, p_window_minutes integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.recent_failed_logins(p_email text, p_window_minutes integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recent_failed_logins(p_email text, p_window_minutes integer) TO service_role;

REVOKE ALL ON FUNCTION public.refresh_business_analytics() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_business_analytics() FROM anon;
REVOKE ALL ON FUNCTION public.refresh_business_analytics() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_business_analytics() TO service_role;

REVOKE ALL ON FUNCTION public.refund_partner_wallet(p_partner_id uuid, p_amount numeric, p_payout_transaction_id uuid, p_description text, p_reference_id text, p_service_type text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refund_partner_wallet(p_partner_id uuid, p_amount numeric, p_payout_transaction_id uuid, p_description text, p_reference_id text, p_service_type text) FROM anon;
REVOKE ALL ON FUNCTION public.refund_partner_wallet(p_partner_id uuid, p_amount numeric, p_payout_transaction_id uuid, p_description text, p_reference_id text, p_service_type text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refund_partner_wallet(p_partner_id uuid, p_amount numeric, p_payout_transaction_id uuid, p_description text, p_reference_id text, p_service_type text) TO service_role;

REVOKE ALL ON FUNCTION public.refund_wallet_bbps(p_retailer_id text, p_transaction_id uuid, p_amount numeric, p_description text, p_reference_id text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refund_wallet_bbps(p_retailer_id text, p_transaction_id uuid, p_amount numeric, p_description text, p_reference_id text) FROM anon;
GRANT EXECUTE ON FUNCTION public.refund_wallet_bbps(p_retailer_id text, p_transaction_id uuid, p_amount numeric, p_description text, p_reference_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refund_wallet_bbps(p_retailer_id text, p_transaction_id uuid, p_amount numeric, p_description text, p_reference_id text) TO service_role;

REVOKE ALL ON FUNCTION public.reject_pinelab_non_success() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_pinelab_non_success() FROM anon;
GRANT EXECUTE ON FUNCTION public.reject_pinelab_non_success() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_pinelab_non_success() TO service_role;

REVOKE ALL ON FUNCTION public.resolve_scheme_for_user(p_user_id text, p_user_role text, p_service_type text, p_distributor_id text, p_md_id text, p_partner_entity_id text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_scheme_for_user(p_user_id text, p_user_role text, p_service_type text, p_distributor_id text, p_md_id text, p_partner_entity_id text) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_scheme_for_user(p_user_id text, p_user_role text, p_service_type text, p_distributor_id text, p_md_id text, p_partner_entity_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_scheme_for_user(p_user_id text, p_user_role text, p_service_type text, p_distributor_id text, p_md_id text, p_partner_entity_id text) TO service_role;

REVOKE ALL ON FUNCTION public.return_pos_device(p_machine_id uuid, p_returned_by text, p_notes text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.return_pos_device(p_machine_id uuid, p_returned_by text, p_notes text) FROM anon;
REVOKE ALL ON FUNCTION public.return_pos_device(p_machine_id uuid, p_returned_by text, p_notes text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.return_pos_device(p_machine_id uuid, p_returned_by text, p_notes text) TO service_role;

REVOKE ALL ON FUNCTION public.set_distributor_tpin(p_distributor_id text, p_tpin text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_distributor_tpin(p_distributor_id text, p_tpin text) FROM anon;
REVOKE ALL ON FUNCTION public.set_distributor_tpin(p_distributor_id text, p_tpin text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_distributor_tpin(p_distributor_id text, p_tpin text) TO service_role;

REVOKE ALL ON FUNCTION public.set_partner_tpin(p_partner_id text, p_tpin text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_partner_tpin(p_partner_id text, p_tpin text) FROM anon;
REVOKE ALL ON FUNCTION public.set_partner_tpin(p_partner_id text, p_tpin text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_partner_tpin(p_partner_id text, p_tpin text) TO service_role;

REVOKE ALL ON FUNCTION public.set_partner_wallet_frozen(p_partner_id uuid, p_frozen boolean, p_reason text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_partner_wallet_frozen(p_partner_id uuid, p_frozen boolean, p_reason text) FROM anon;
REVOKE ALL ON FUNCTION public.set_partner_wallet_frozen(p_partner_id uuid, p_frozen boolean, p_reason text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_partner_wallet_frozen(p_partner_id uuid, p_frozen boolean, p_reason text) TO service_role;

REVOKE ALL ON FUNCTION public.set_retailer_tpin(p_retailer_id text, p_tpin text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_retailer_tpin(p_retailer_id text, p_tpin text) FROM anon;
REVOKE ALL ON FUNCTION public.set_retailer_tpin(p_retailer_id text, p_tpin text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_retailer_tpin(p_retailer_id text, p_tpin text) TO service_role;

REVOKE ALL ON FUNCTION public.settle_pos_txn_t1(p_txn_id uuid, p_retailer_id text, p_gross numeric, p_retailer_mdr numeric, p_retailer_fee numeric, p_retailer_net numeric, p_scheme_id text, p_scheme_type text, p_distributor_id text, p_distributor_mdr numeric, p_distributor_commission numeric, p_tid text, p_retailer_name text, p_retailer_ref text, p_commission_ref text, p_distributor_tds numeric, p_master_distributor_id text, p_md_mdr numeric, p_md_commission numeric, p_md_commission_ref text, p_md_tds numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.settle_pos_txn_t1(p_txn_id uuid, p_retailer_id text, p_gross numeric, p_retailer_mdr numeric, p_retailer_fee numeric, p_retailer_net numeric, p_scheme_id text, p_scheme_type text, p_distributor_id text, p_distributor_mdr numeric, p_distributor_commission numeric, p_tid text, p_retailer_name text, p_retailer_ref text, p_commission_ref text, p_distributor_tds numeric, p_master_distributor_id text, p_md_mdr numeric, p_md_commission numeric, p_md_commission_ref text, p_md_tds numeric) FROM anon;
REVOKE ALL ON FUNCTION public.settle_pos_txn_t1(p_txn_id uuid, p_retailer_id text, p_gross numeric, p_retailer_mdr numeric, p_retailer_fee numeric, p_retailer_net numeric, p_scheme_id text, p_scheme_type text, p_distributor_id text, p_distributor_mdr numeric, p_distributor_commission numeric, p_tid text, p_retailer_name text, p_retailer_ref text, p_commission_ref text, p_distributor_tds numeric, p_master_distributor_id text, p_md_mdr numeric, p_md_commission numeric, p_md_commission_ref text, p_md_tds numeric) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.settle_pos_txn_t1(p_txn_id uuid, p_retailer_id text, p_gross numeric, p_retailer_mdr numeric, p_retailer_fee numeric, p_retailer_net numeric, p_scheme_id text, p_scheme_type text, p_distributor_id text, p_distributor_mdr numeric, p_distributor_commission numeric, p_tid text, p_retailer_name text, p_retailer_ref text, p_commission_ref text, p_distributor_tds numeric, p_master_distributor_id text, p_md_mdr numeric, p_md_commission numeric, p_md_commission_ref text, p_md_tds numeric) TO service_role;

REVOKE ALL ON FUNCTION public.update_aeps_settle_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_aeps_settle_updated_at() FROM anon;
GRANT EXECUTE ON FUNCTION public.update_aeps_settle_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_aeps_settle_updated_at() TO service_role;

REVOKE ALL ON FUNCTION public.update_aeps_settlement_accounts_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_aeps_settlement_accounts_updated_at() FROM anon;
GRANT EXECUTE ON FUNCTION public.update_aeps_settlement_accounts_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_aeps_settlement_accounts_updated_at() TO service_role;

REVOKE ALL ON FUNCTION public.update_aeps_settlements_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_aeps_settlements_updated_at() FROM anon;
GRANT EXECUTE ON FUNCTION public.update_aeps_settlements_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_aeps_settlements_updated_at() TO service_role;

REVOKE ALL ON FUNCTION public.update_aeps_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_aeps_updated_at() FROM anon;
GRANT EXECUTE ON FUNCTION public.update_aeps_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_aeps_updated_at() TO service_role;

REVOKE ALL ON FUNCTION public.update_partner_schemes_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_partner_schemes_updated_at() FROM anon;
GRANT EXECUTE ON FUNCTION public.update_partner_schemes_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_partner_schemes_updated_at() TO service_role;

REVOKE ALL ON FUNCTION public.update_partner_t1_cron_settings_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_partner_t1_cron_settings_updated_at() FROM anon;
GRANT EXECUTE ON FUNCTION public.update_partner_t1_cron_settings_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_partner_t1_cron_settings_updated_at() TO service_role;

REVOKE ALL ON FUNCTION public.update_payout_transactions_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_payout_transactions_updated_at() FROM anon;
GRANT EXECUTE ON FUNCTION public.update_payout_transactions_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_payout_transactions_updated_at() TO service_role;

REVOKE ALL ON FUNCTION public.update_pos_device_mapping_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_pos_device_mapping_updated_at() FROM anon;
GRANT EXECUTE ON FUNCTION public.update_pos_device_mapping_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_pos_device_mapping_updated_at() TO service_role;

REVOKE ALL ON FUNCTION public.update_razorpay_pos_transactions_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_razorpay_pos_transactions_updated_at() FROM anon;
GRANT EXECUTE ON FUNCTION public.update_razorpay_pos_transactions_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_razorpay_pos_transactions_updated_at() TO service_role;

REVOKE ALL ON FUNCTION public.update_scheme_aeps_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_scheme_aeps_updated_at() FROM anon;
GRANT EXECUTE ON FUNCTION public.update_scheme_aeps_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_scheme_aeps_updated_at() TO service_role;

REVOKE ALL ON FUNCTION public.update_service_slabs_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_service_slabs_updated_at() FROM anon;
GRANT EXECUTE ON FUNCTION public.update_service_slabs_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_service_slabs_updated_at() TO service_role;

REVOKE ALL ON FUNCTION public.update_shadval_settlement_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_shadval_settlement_updated_at() FROM anon;
GRANT EXECUTE ON FUNCTION public.update_shadval_settlement_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_shadval_settlement_updated_at() TO service_role;

REVOKE ALL ON FUNCTION public.update_sub_partners_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_sub_partners_updated_at() FROM anon;
GRANT EXECUTE ON FUNCTION public.update_sub_partners_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_sub_partners_updated_at() TO service_role;

REVOKE ALL ON FUNCTION public.update_subscription_cron_settings_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_subscription_cron_settings_updated_at() FROM anon;
GRANT EXECUTE ON FUNCTION public.update_subscription_cron_settings_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_subscription_cron_settings_updated_at() TO service_role;

REVOKE ALL ON FUNCTION public.update_t1_cron_settings_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_t1_cron_settings_updated_at() FROM anon;
GRANT EXECUTE ON FUNCTION public.update_t1_cron_settings_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_t1_cron_settings_updated_at() TO service_role;

REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM anon;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO service_role;

REVOKE ALL ON FUNCTION public.verify_distributor_tpin(p_distributor_id text, p_tpin text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_distributor_tpin(p_distributor_id text, p_tpin text) FROM anon;
REVOKE ALL ON FUNCTION public.verify_distributor_tpin(p_distributor_id text, p_tpin text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.verify_distributor_tpin(p_distributor_id text, p_tpin text) TO service_role;

REVOKE ALL ON FUNCTION public.verify_partner_tpin(p_partner_id text, p_tpin text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_partner_tpin(p_partner_id text, p_tpin text) FROM anon;
REVOKE ALL ON FUNCTION public.verify_partner_tpin(p_partner_id text, p_tpin text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.verify_partner_tpin(p_partner_id text, p_tpin text) TO service_role;

REVOKE ALL ON FUNCTION public.verify_retailer_tpin(p_retailer_id text, p_tpin text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_retailer_tpin(p_retailer_id text, p_tpin text) FROM anon;
REVOKE ALL ON FUNCTION public.verify_retailer_tpin(p_retailer_id text, p_tpin text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.verify_retailer_tpin(p_retailer_id text, p_tpin text) TO service_role;

COMMIT;
