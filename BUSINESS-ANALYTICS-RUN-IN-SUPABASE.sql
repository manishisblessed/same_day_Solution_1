-- ============================================================================
-- BUSINESS ANALYTICS — v2 (net-of-refunds volume + real charges)
-- Run this once in the Supabase SQL editor. Idempotent (drops + recreates).
--
-- Definitions:
--   volume            : money the user actually moved through a service,
--                       NET of refunds/reversals (spend debits − refund credits,
--                       plus received credits for POS/AEPS/settlement credits)
--   charges_paid      : fees the user paid to the platform, from source-of-truth
--                       transaction tables (bbps retailer_charge, payout charges,
--                       shadval charges, aeps settlement charge, parsed CC GST,
--                       account-verification charges)
--   commission_earned : commission credited minus reversals/TDS
--   company_revenue   : COMPANY_REVENUE/REVENUE_CREDIT credits minus reversals
--   commission_paid   : commission credits minus reversals/TDS (network payouts)
--
-- Ledger facts (verified against live data):
--   user id column in wallet_ledger is `retailer_id` for ALL roles
--   refunds:   transaction_type ILIKE '%REFUND%'  (credits back to user)
--   reversals: transaction_type ILIKE '%REVERSAL%'
--   platform revenue rows: fund_category='revenue'
--   commission rows: fund_category IN ('commission','tds')
-- ============================================================================

-- ============================================================================
-- 0) SHARED FUNCTION — per-user x per-service usage for any date window.
--    Single source of truth: the all-time MV and the date-range report
--    (API ?from=&to=) both use this.
-- ============================================================================
DROP MATERIALIZED VIEW IF EXISTS mv_ba_user_service CASCADE;
DROP FUNCTION IF EXISTS ba_user_service_usage(timestamptz, timestamptz);

CREATE FUNCTION ba_user_service_usage(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  user_id text,
  user_role text,
  service text,
  volume numeric,
  txns bigint,
  charges_paid numeric,
  commission_earned numeric,
  last_used timestamptz
)
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
WITH network_ledger AS (
  SELECT
    wl.retailer_id AS uid,
    COALESCE(wl.user_role, 'unknown') AS role,
    CASE
      WHEN wl.service_type IN ('payout', 'shadval_settlement') THEN 'settlement'
      WHEN wl.service_type IN ('pay2new', 'rechargekit', 'recharge') THEN 'recharge'
      ELSE wl.service_type
    END AS svc,
    wl.transaction_type AS tt,
    wl.fund_category AS fc,
    wl.credit, wl.debit, wl.created_at, wl.reference_id
  FROM public.wallet_ledger wl
  WHERE wl.status = 'completed'
    AND wl.created_at BETWEEN p_from AND p_to
    AND wl.service_type IN ('bbps', 'settlement', 'payout', 'shadval_settlement', 'recharge', 'pay2new', 'rechargekit')
),
network_usage AS (
  SELECT
    uid, role, svc,
    GREATEST(0, SUM(CASE
      WHEN fc IN ('commission', 'revenue', 'adjustment', 'tds') THEN 0
      WHEN tt ILIKE 'ACCOUNT_VERIFICATION%' THEN 0                          -- pure charge, not volume
      WHEN tt ILIKE '%REFUND%' OR tt ILIKE '%REVERSAL%' THEN -credit       -- money returned
      WHEN tt = 'SETTLEMENT_CREDIT' THEN credit
      ELSE debit
    END)) AS volume,
    COUNT(*) FILTER (
      WHERE fc NOT IN ('commission', 'revenue', 'adjustment', 'tds')
        AND tt NOT ILIKE '%REFUND%' AND tt NOT ILIKE '%REVERSAL%'
        AND tt NOT ILIKE 'ACCOUNT_VERIFICATION%'
    ) AS txns,
    COALESCE(SUM(credit - debit) FILTER (WHERE fc IN ('commission', 'tds')), 0) AS commission_earned,
    GREATEST(0, COALESCE(SUM(debit - credit) FILTER (WHERE tt ILIKE 'ACCOUNT_VERIFICATION%'), 0)) AS verification_charges,
    MAX(created_at) AS last_used
  FROM network_ledger
  GROUP BY 1, 2, 3
),
-- Fees paid, from source-of-truth transaction tables (success only)
network_charges AS (
  SELECT b.retailer_id AS uid, 'bbps'::text AS svc, SUM(COALESCE(b.retailer_charge, 0)) AS ch
  FROM public.bbps_transactions b
  WHERE b.status = 'success' AND b.created_at BETWEEN p_from AND p_to
  GROUP BY 1
  UNION ALL
  SELECT pt.retailer_id, 'settlement', SUM(COALESCE(pt.retailer_charge, pt.charges, 0))
  FROM public.payout_transactions pt
  WHERE pt.status = 'success' AND pt.retailer_id IS NOT NULL AND pt.created_at BETWEEN p_from AND p_to
  GROUP BY 1
  UNION ALL
  -- Exclude shadval rows that belong to partner-API settlements (they carry a
  -- retailer_id too, but the fee is the partner's — counted separately below)
  SELECT ss.retailer_id, 'settlement', SUM(COALESCE(ss.charges, 0))
  FROM public.shadval_settlement ss
  WHERE ss.status = 'SUCCESS' AND ss.created_at BETWEEN p_from AND p_to
    AND NOT EXISTS (SELECT 1 FROM public.partner_wallet_ledger pw WHERE pw.payout_transaction_id = ss.id)
  GROUP BY 1
  UNION ALL
  -- Credit-card recharge GST/charge is embedded in the debit description ("+ ₹X GST");
  -- count it only for debits that were NOT refunded.
  SELECT d.retailer_id, 'recharge',
         SUM(COALESCE((substring(d.description FROM '\+ ₹([0-9.]+)'))::numeric, 0))
  FROM public.wallet_ledger d
  WHERE d.transaction_type IN ('PAY2NEW_DEBIT', 'RECHARGEKIT_CC_DEBIT')
    AND d.status = 'completed' AND d.created_at BETWEEN p_from AND p_to
    AND NOT EXISTS (
      SELECT 1 FROM public.wallet_ledger r
      WHERE r.transaction_type IN ('PAY2NEW_REFUND', 'RECHARGEKIT_CC_REFUND')
        AND r.reference_id = 'REFUND_' || d.reference_id
    )
  GROUP BY 1
),
network_charges_agg AS (
  SELECT uid, svc, SUM(ch) AS charges FROM network_charges GROUP BY 1, 2
),
-- API partners: service inferred from description / payout link
partner_rows AS (
  SELECT
    pwl.partner_id::text AS uid,
    -- Verification fee debits are pure charges (not usage volume)
    (pwl.description ILIKE 'account verification%') AS is_verification,
    CASE
      WHEN pwl.description ILIKE 'account verification%' THEN 'settlement'
      WHEN pwl.payout_transaction_id IS NOT NULL THEN 'settlement'
      WHEN pwl.description ILIKE '%bbps%' THEN 'bbps'
      WHEN pwl.description ILIKE '%pay2new%' OR pwl.description ILIKE '%cc-1%' THEN 'recharge'
      WHEN pwl.description ILIKE '%rechargekit%' OR pwl.description ILIKE '%cc-2%' OR pwl.description ILIKE '%recharge%' THEN 'recharge'
      WHEN pwl.description ILIKE '%payout%' OR pwl.description ILIKE '%transfer%' OR pwl.description ILIKE '%settl%' THEN 'settlement'
      ELSE NULL  -- skip unrecognised rows
    END AS svc,
    pwl.transaction_type AS tt,
    pwl.credit, pwl.debit, pwl.created_at,
    -- CC recharge GST parsed from description ("₹1000 + ₹5.9 GST"), only when not refunded
    CASE
      WHEN pwl.transaction_type = 'DEBIT' AND pwl.payout_transaction_id IS NULL AND NOT EXISTS (
        SELECT 1 FROM public.partner_wallet_ledger r
        WHERE r.transaction_type = 'REFUND' AND r.reference_id = 'REFUND_' || pwl.reference_id
      ) THEN COALESCE((substring(pwl.description FROM '\+ ₹([0-9.]+)'))::numeric, 0)
      ELSE 0
    END AS row_charge
  FROM public.partner_wallet_ledger pwl
  WHERE pwl.status = 'completed' AND pwl.created_at BETWEEN p_from AND p_to
    AND (  -- only rows that map to one of the 3 tracked services
      pwl.description ILIKE 'account verification%'
      OR pwl.payout_transaction_id IS NOT NULL
      OR pwl.description ILIKE '%bbps%'
      OR pwl.description ILIKE '%pay2new%' OR pwl.description ILIKE '%cc-1%'
      OR pwl.description ILIKE '%rechargekit%' OR pwl.description ILIKE '%cc-2%' OR pwl.description ILIKE '%recharge%'
      OR pwl.description ILIKE '%payout%' OR pwl.description ILIKE '%transfer%' OR pwl.description ILIKE '%settl%'
    )
),
partner_usage AS (
  SELECT
    uid, 'partner'::text AS role, svc,
    GREATEST(0, SUM(CASE
      WHEN is_verification THEN 0
      WHEN tt = 'DEBIT' THEN debit
      WHEN tt = 'REFUND' THEN -credit
      ELSE 0
    END)) AS volume,
    COUNT(*) FILTER (WHERE tt = 'DEBIT' AND NOT is_verification) AS txns,
    0::numeric AS commission_earned,
    COALESCE(SUM(row_charge), 0)
      + COALESCE(SUM(CASE WHEN is_verification AND tt = 'DEBIT' THEN debit
                          WHEN is_verification AND tt = 'REFUND' THEN -credit
                          ELSE 0 END), 0) AS parsed_charges,
    MAX(created_at) FILTER (WHERE tt = 'DEBIT' AND NOT is_verification) AS last_used
  FROM partner_rows
  GROUP BY 1, 3
),
-- Partner settlement fees: the ledger's payout_transaction_id points at
-- shadval_settlement, whose `charges` column is the real fee (charge + GST)
partner_settlement_fees AS (
  SELECT pwl.partner_id::text AS uid, 'settlement'::text AS svc, SUM(COALESCE(ss.charges, 0)) AS ch
  FROM public.partner_wallet_ledger pwl
  JOIN public.shadval_settlement ss ON ss.id = pwl.payout_transaction_id
  WHERE pwl.transaction_type = 'DEBIT' AND pwl.status = 'completed'
    AND ss.status = 'SUCCESS' AND pwl.created_at BETWEEN p_from AND p_to
  GROUP BY 1
),
-- Plus any partner payouts routed through payout_transactions
partner_payout_charges AS (
  SELECT pt.partner_id::text AS uid, 'settlement'::text AS svc, SUM(COALESCE(pt.charges, 0)) AS ch
  FROM public.payout_transactions pt
  WHERE pt.status = 'success' AND pt.partner_id IS NOT NULL AND pt.created_at BETWEEN p_from AND p_to
  GROUP BY 1
),
partner_charges_agg AS (
  SELECT uid, svc, SUM(ch) AS ch FROM (
    SELECT * FROM partner_settlement_fees
    UNION ALL
    SELECT * FROM partner_payout_charges
  ) x GROUP BY 1, 2
)
SELECT
  nu.uid, nu.role, nu.svc,
  nu.volume,
  nu.txns,
  ROUND(COALESCE(nc.charges, 0) + nu.verification_charges, 2) AS charges_paid,
  ROUND(nu.commission_earned, 2) AS commission_earned,
  nu.last_used
FROM network_usage nu
LEFT JOIN network_charges_agg nc ON nc.uid = nu.uid AND nc.svc = nu.svc
UNION ALL
SELECT
  pu.uid, pu.role, pu.svc,
  pu.volume,
  pu.txns,
  ROUND(pu.parsed_charges + COALESCE(pc.ch, 0), 2) AS charges_paid,
  0 AS commission_earned,
  pu.last_used
FROM partner_usage pu
LEFT JOIN partner_charges_agg pc ON pc.uid = pu.uid AND pc.svc = pu.svc;
$fn$;

GRANT EXECUTE ON FUNCTION ba_user_service_usage(timestamptz, timestamptz) TO service_role;

-- ============================================================================
-- 1) MONTHLY PLATFORM P&L (network, from wallet_ledger) — reversal-aware
-- ============================================================================
DROP MATERIALIZED VIEW IF EXISTS mv_ba_pnl_monthly CASCADE;
CREATE MATERIALIZED VIEW mv_ba_pnl_monthly AS
SELECT
  date_trunc('month', created_at)::date AS month,
  CASE
    WHEN service_type IN ('payout', 'shadval_settlement') THEN 'settlement'
    WHEN service_type IN ('pay2new', 'rechargekit', 'recharge') THEN 'recharge'
    ELSE COALESCE(NULLIF(service_type, ''), 'other')
  END AS service,
  COALESCE(user_role, 'unknown') AS user_role,
  -- Platform earnings (net of reversals)
  COALESCE(SUM(credit - debit) FILTER (WHERE fund_category = 'revenue'), 0) AS company_revenue,
  COALESCE(SUM(credit) FILTER (WHERE service_type = 'subscription' AND transaction_type = 'SUBSCRIPTION_REVENUE'), 0) AS subscription_revenue,
  COALESCE(SUM(credit) FILTER (WHERE reference_id LIKE 'SETTLEMENT_FEE_%'), 0) AS settlement_fees,
  -- Network payouts (net of reversals + TDS)
  COALESCE(SUM(credit - debit) FILTER (WHERE fund_category IN ('commission', 'tds')), 0) AS commission_paid,
  -- Usage volume, NET of refunds
  GREATEST(0, COALESCE(SUM(CASE
    WHEN service_type NOT IN ('bbps', 'settlement', 'payout', 'shadval_settlement', 'recharge', 'pay2new', 'rechargekit') THEN 0
    WHEN fund_category IN ('commission', 'revenue', 'adjustment', 'tds') THEN 0
    WHEN transaction_type ILIKE 'ACCOUNT_VERIFICATION%' THEN 0
    WHEN transaction_type ILIKE '%REFUND%' OR transaction_type ILIKE '%REVERSAL%' THEN -credit
    WHEN transaction_type = 'SETTLEMENT_CREDIT' THEN credit
    ELSE debit
  END), 0)) AS usage_volume,
  COUNT(*) FILTER (
    WHERE service_type IN ('bbps', 'settlement', 'payout', 'shadval_settlement', 'recharge', 'pay2new', 'rechargekit')
      AND fund_category NOT IN ('commission', 'revenue', 'adjustment', 'tds')
      AND transaction_type NOT ILIKE '%REFUND%'
      AND transaction_type NOT ILIKE '%REVERSAL%'
      AND transaction_type NOT ILIKE 'ACCOUNT_VERIFICATION%'
  ) AS txns
FROM wallet_ledger
WHERE status = 'completed'
GROUP BY 1, 2, 3;

CREATE UNIQUE INDEX idx_mv_ba_pnl_monthly ON mv_ba_pnl_monthly (month, service, user_role);

-- ============================================================================
-- 2) MONTHLY PARTNER-CHANNEL ACTIVITY — net of refunds
-- ============================================================================
DROP MATERIALIZED VIEW IF EXISTS mv_ba_partner_monthly CASCADE;
CREATE MATERIALIZED VIEW mv_ba_partner_monthly AS
WITH tagged AS (
  SELECT
    date_trunc('month', created_at)::date AS month,
    CASE
      WHEN description ILIKE 'account verification%' THEN 'settlement'
      WHEN payout_transaction_id IS NOT NULL THEN 'settlement'
      WHEN description ILIKE '%bbps%' THEN 'bbps'
      WHEN description ILIKE '%pay2new%' OR description ILIKE '%cc-1%' THEN 'recharge'
      WHEN description ILIKE '%rechargekit%' OR description ILIKE '%cc-2%' OR description ILIKE '%recharge%' THEN 'recharge'
      WHEN description ILIKE '%payout%' OR description ILIKE '%transfer%' OR description ILIKE '%settl%' THEN 'settlement'
    END AS service,
    (description ILIKE 'account verification%') AS is_verification,
    transaction_type, debit, credit
  FROM partner_wallet_ledger
  WHERE status = 'completed'
)
SELECT
  month, service,
  GREATEST(0, COALESCE(SUM(CASE
    WHEN is_verification THEN 0
    WHEN transaction_type = 'DEBIT' THEN debit
    WHEN transaction_type = 'REFUND' THEN -credit
    ELSE 0
  END), 0)) AS usage_volume,
  COUNT(*) FILTER (WHERE transaction_type = 'DEBIT' AND NOT is_verification) AS txns
FROM tagged
WHERE service IS NOT NULL
GROUP BY 1, 2;

CREATE UNIQUE INDEX idx_mv_ba_partner_monthly ON mv_ba_partner_monthly (month, service);

-- ============================================================================
-- 3) PER-USER x PER-SERVICE USAGE (all-time) — via the shared function
-- ============================================================================
CREATE MATERIALIZED VIEW mv_ba_user_service AS
SELECT * FROM ba_user_service_usage('-infinity'::timestamptz, 'infinity'::timestamptz);

CREATE UNIQUE INDEX idx_mv_ba_user_service ON mv_ba_user_service (user_id, user_role, service);
CREATE INDEX idx_mv_ba_user_service_vol ON mv_ba_user_service (volume DESC);

-- ============================================================================
-- 4) CUMULATIVE USER GROWTH BY ROLE
-- ============================================================================
DROP MATERIALIZED VIEW IF EXISTS mv_ba_user_growth_monthly CASCADE;
CREATE MATERIALIZED VIEW mv_ba_user_growth_monthly AS
WITH onboards AS (
  SELECT 'retailer'::text AS user_role, date_trunc('month', created_at)::date AS month FROM retailers
  UNION ALL
  SELECT 'distributor', date_trunc('month', created_at)::date FROM distributors
  UNION ALL
  SELECT 'master_distributor', date_trunc('month', created_at)::date FROM master_distributors
  UNION ALL
  SELECT 'partner', date_trunc('month', created_at)::date FROM partners
)
SELECT month, user_role, COUNT(*) AS onboarded
FROM onboards
WHERE month IS NOT NULL
GROUP BY 1, 2;

CREATE UNIQUE INDEX idx_mv_ba_user_growth_monthly ON mv_ba_user_growth_monthly (month, user_role);

-- ============================================================================
-- REFRESH FUNCTION + GRANTS
-- ============================================================================
CREATE OR REPLACE FUNCTION refresh_business_analytics()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_ba_pnl_monthly;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_ba_partner_monthly;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_ba_user_service;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_ba_user_growth_monthly;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION refresh_business_analytics() TO service_role;
GRANT SELECT ON mv_ba_pnl_monthly, mv_ba_partner_monthly, mv_ba_user_service, mv_ba_user_growth_monthly TO service_role;

-- ============================================================================
-- NIGHTLY REFRESH via pg_cron (only if the extension is enabled).
-- Production refresh is otherwise driven by:
--   POST /api/admin/business-analytics/refresh  (header x-cron-secret: $CRON_SECRET)
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('refresh_business_analytics')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh_business_analytics');
    PERFORM cron.schedule('refresh_business_analytics', '30 20 * * *', 'SELECT refresh_business_analytics()');
  ELSE
    RAISE NOTICE 'pg_cron not installed — nightly refresh should be driven by the cron API endpoint.';
  END IF;
END $$;

-- Make PostgREST pick up the new objects immediately
NOTIFY pgrst, 'reload schema';
