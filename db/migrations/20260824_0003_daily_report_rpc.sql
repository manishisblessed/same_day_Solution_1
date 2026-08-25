-- ============================================================================
-- Daily User Report aggregation RPC
-- ============================================================================
-- Ports NEXTGEN's per-user daily report (lib/reports/daily.ts) to same_day.
-- Computes, per wallet owner (retailer_id) for one IST calendar day:
--   opening / closing balance, total credit / debit, push, pull, commission.
--
-- Push / pull are identified by reference_id prefixes, consistent with
-- app/api/admin/reports/push-pull/route.ts:
--   ADMIN_PUSH_ / DIST_PUSH_  -> push (funds in)
--   ADMIN_PULL_ / DIST_PULL_  -> pull (funds out)
--
-- Opening = closing_balance of the last ledger row strictly before day start.
-- Closing = closing_balance of the last ledger row before day end.
-- Only users with activity during the day are returned.
--
-- Idempotent + safe to re-run. Restricted to service_role.
-- ============================================================================

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
    COALESCE(da.txn_count, 0)                  AS txn_count
  FROM active a
  LEFT JOIN opening o ON o.user_id = a.user_id
  LEFT JOIN closing c ON c.user_id = a.user_id
  LEFT JOIN day_agg da ON da.user_id = a.user_id;
$$;

REVOKE ALL ON FUNCTION public.daily_user_report(date, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.daily_user_report(date, text[]) TO service_role;
