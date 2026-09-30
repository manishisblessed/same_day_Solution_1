-- ============================================================================
-- Daily User Report — add Refunds bucket
-- ============================================================================
-- The original daily_user_report() RPC (20260824_0003) only bucketed
-- push / pull / commission out of total credit, so refund credits for
-- retailers / distributors / MDs stayed inside the residual "settlement"
-- amount and surfaced in the Credit column instead of the Refunds column.
--
-- This migration recreates the function with a `refunds` output so refunds
-- are broken out consistently with the partner_wallet_ledger path
-- (lib/reports/daily.ts). Refund credits are detected by transaction_type
-- (BBPS_REFUND / PAY2NEW_REFUND / SETTLEMENT2_REFUND / RECHARGEKIT_CC_REFUND /
-- REFUND / …) or a REFUND* reference_id.
--
-- Money-in stays non-overlapping: settlement = credit − push − refunds − comm.
-- (a refund row is never a push nor a commission row, so no double counting).
--
-- Return signature changes, so the old function is dropped first.
-- Idempotent + safe to re-run. Restricted to service_role.
-- ============================================================================

DROP FUNCTION IF EXISTS public.daily_user_report(date, text[]);

CREATE OR REPLACE FUNCTION public.daily_user_report(
  p_date date,
  p_ids  text[] DEFAULT NULL
)
RETURNS TABLE (
  user_id       text,
  user_role     text,
  opening       numeric,
  closing       numeric,
  credit_total  numeric,
  debit_total   numeric,
  push          numeric,
  pull          numeric,
  commission    numeric,
  refunds       numeric,
  txn_count     bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH bounds AS (
    SELECT
      ((p_date::text        || ' 00:00:00')::timestamp AT TIME ZONE 'Asia/Kolkata') AS day_start,
      (((p_date + 1)::text   || ' 00:00:00')::timestamp AT TIME ZONE 'Asia/Kolkata') AS day_end
  ),
  scoped AS (
    SELECT wl.*
    FROM wallet_ledger wl
    WHERE (wl.wallet_type = 'primary' OR wl.wallet_type IS NULL)
      AND (p_ids IS NULL OR wl.retailer_id = ANY (p_ids))
  ),
  active AS (
    SELECT DISTINCT s.retailer_id AS user_id
    FROM scoped s, bounds b
    WHERE s.created_at >= b.day_start AND s.created_at < b.day_end
  ),
  opening AS (
    SELECT DISTINCT ON (s.retailer_id)
      s.retailer_id AS user_id,
      COALESCE(s.closing_balance, s.balance_after, 0) AS bal
    FROM scoped s, bounds b
    WHERE s.created_at < b.day_start
    ORDER BY s.retailer_id, s.created_at DESC
  ),
  closing AS (
    SELECT DISTINCT ON (s.retailer_id)
      s.retailer_id AS user_id,
      COALESCE(s.closing_balance, s.balance_after, 0) AS bal
    FROM scoped s, bounds b
    WHERE s.created_at < b.day_end
    ORDER BY s.retailer_id, s.created_at DESC
  ),
  day_agg AS (
    SELECT
      s.retailer_id AS user_id,
      MAX(s.user_role) AS user_role,
      SUM(COALESCE(s.credit, 0)) AS credit_total,
      SUM(COALESCE(s.debit, 0))  AS debit_total,
      SUM(CASE WHEN s.reference_id ILIKE 'ADMIN_PUSH_%' OR s.reference_id ILIKE 'DIST_PUSH_%'
               THEN COALESCE(s.credit, 0) ELSE 0 END) AS push,
      SUM(CASE WHEN s.reference_id ILIKE 'ADMIN_PULL_%' OR s.reference_id ILIKE 'DIST_PULL_%'
               THEN COALESCE(s.debit, 0) ELSE 0 END) AS pull,
      SUM(CASE WHEN UPPER(COALESCE(s.transaction_type, '')) LIKE '%COMMISSION%'
                 OR LOWER(COALESCE(s.fund_category, '')) LIKE '%commission%'
               THEN COALESCE(s.credit, 0) ELSE 0 END) AS commission,
      SUM(CASE WHEN UPPER(COALESCE(s.transaction_type, '')) LIKE '%REFUND%'
                 OR s.reference_id ILIKE 'REFUND%'
               THEN COALESCE(s.credit, 0) ELSE 0 END) AS refunds,
      COUNT(*) AS txn_count
    FROM scoped s, bounds b
    WHERE s.created_at >= b.day_start AND s.created_at < b.day_end
    GROUP BY s.retailer_id
  )
  SELECT
    a.user_id,
    COALESCE(da.user_role, '')                 AS user_role,
    COALESCE(o.bal, 0)                         AS opening,
    COALESCE(c.bal, o.bal, 0)                  AS closing,
    COALESCE(da.credit_total, 0)               AS credit_total,
    COALESCE(da.debit_total, 0)                AS debit_total,
    COALESCE(da.push, 0)                       AS push,
    COALESCE(da.pull, 0)                       AS pull,
    COALESCE(da.commission, 0)                 AS commission,
    COALESCE(da.refunds, 0)                    AS refunds,
    COALESCE(da.txn_count, 0)                  AS txn_count
  FROM active a
  LEFT JOIN opening o ON o.user_id = a.user_id
  LEFT JOIN closing c ON c.user_id = a.user_id
  LEFT JOIN day_agg da ON da.user_id = a.user_id;
$$;

REVOKE ALL ON FUNCTION public.daily_user_report(date, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.daily_user_report(date, text[]) TO service_role;
