-- ============================================================================
-- All-user balances RPC — Opening & Closing for every user on a given day
-- ============================================================================
-- Unlike daily_user_report (which only returns users with activity), this
-- returns ALL users from retailers, distributors, master_distributors, and
-- partners, each with their opening and closing wallet balance for the day.
--
-- Opening = last wallet_ledger/partner_wallet_ledger closing_balance before
-- day start (IST midnight). Closing = last balance before day end, or live
-- wallets/partner_wallets balance when p_date = today.
--
-- Users with no ledger history show their live wallet balance (if any) or 0.
--
-- Idempotent + safe to re-run. Restricted to service_role.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.all_user_balances(
  p_date  date,
  p_role  text DEFAULT NULL,
  p_q     text DEFAULT NULL
)
RETURNS TABLE (
  user_id    text,
  user_role  text,
  user_name  text,
  opening    numeric,
  closing    numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH bounds AS (
    SELECT
      ((p_date::text        || ' 00:00:00')::timestamp AT TIME ZONE 'Asia/Kolkata') AS day_start,
      (((p_date + 1)::text  || ' 00:00:00')::timestamp AT TIME ZONE 'Asia/Kolkata') AS day_end,
      (p_date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS is_today
  ),

  -- All users from all 4 tables
  all_users AS (
    SELECT r.partner_id AS uid, 'retailer'::text AS urole,
           COALESCE(r.name, r.business_name, r.partner_id) AS uname
    FROM retailers r
    WHERE (p_role IS NULL OR p_role = 'retailer')
    UNION ALL
    SELECT d.partner_id, 'distributor',
           COALESCE(d.name, d.business_name, d.partner_id)
    FROM distributors d
    WHERE (p_role IS NULL OR p_role = 'distributor')
    UNION ALL
    SELECT m.partner_id, 'master_distributor',
           COALESCE(m.name, m.business_name, m.partner_id)
    FROM master_distributors m
    WHERE (p_role IS NULL OR p_role = 'master_distributor')
    UNION ALL
    SELECT p.id::text,
           CASE WHEN p.is_master_partner THEN 'master_partner' ELSE 'partner' END,
           COALESCE(p.name, p.business_name, p.id::text)
    FROM partners p
    WHERE (p_role IS NULL OR p_role = 'partner' OR p_role = 'master_partner')
  ),

  -- Filter by search query if provided
  filtered_users AS (
    SELECT * FROM all_users
    WHERE p_q IS NULL
       OR LOWER(uname) LIKE '%' || LOWER(p_q) || '%'
       OR LOWER(uid)   LIKE '%' || LOWER(p_q) || '%'
  ),

  -- Opening: last wallet_ledger closing_balance before day start (RT/DT/MD)
  wl_opening AS (
    SELECT DISTINCT ON (wl.retailer_id)
      wl.retailer_id AS uid,
      COALESCE(wl.closing_balance, wl.balance_after, 0) AS bal
    FROM wallet_ledger wl, bounds b
    WHERE (wl.wallet_type = 'primary' OR wl.wallet_type IS NULL)
      AND wl.created_at < b.day_start
    ORDER BY wl.retailer_id, wl.created_at DESC
  ),

  -- Closing from ledger: last wallet_ledger closing_balance before day end
  wl_closing AS (
    SELECT DISTINCT ON (wl.retailer_id)
      wl.retailer_id AS uid,
      COALESCE(wl.closing_balance, wl.balance_after, 0) AS bal
    FROM wallet_ledger wl, bounds b
    WHERE (wl.wallet_type = 'primary' OR wl.wallet_type IS NULL)
      AND wl.created_at < b.day_end
    ORDER BY wl.retailer_id, wl.created_at DESC
  ),

  -- Opening: last partner_wallet_ledger closing_balance before day start
  pwl_opening AS (
    SELECT DISTINCT ON (pwl.partner_id)
      pwl.partner_id::text AS uid,
      COALESCE(pwl.closing_balance, 0) AS bal
    FROM partner_wallet_ledger pwl, bounds b
    WHERE pwl.created_at < b.day_start
    ORDER BY pwl.partner_id, pwl.created_at DESC
  ),

  -- Closing from partner ledger: last closing_balance before day end
  pwl_closing AS (
    SELECT DISTINCT ON (pwl.partner_id)
      pwl.partner_id::text AS uid,
      COALESCE(pwl.closing_balance, 0) AS bal
    FROM partner_wallet_ledger pwl, bounds b
    WHERE pwl.created_at < b.day_end
    ORDER BY pwl.partner_id, pwl.created_at DESC
  ),

  -- Live wallet balance (used for today's closing)
  live_wl AS (
    SELECT w.user_id AS uid, w.balance AS bal
    FROM wallets w
    WHERE w.wallet_type = 'primary'
  ),

  live_pwl AS (
    SELECT pw.partner_id::text AS uid, pw.balance AS bal
    FROM partner_wallets pw
  )

  SELECT
    u.uid                                                      AS user_id,
    u.urole                                                    AS user_role,
    u.uname                                                    AS user_name,
    -- Opening
    COALESCE(
      CASE WHEN u.urole IN ('partner', 'master_partner') THEN po.bal ELSE wo.bal END,
      0
    )                                                          AS opening,
    -- Closing: use live balance for today, ledger for past dates
    CASE
      WHEN (SELECT is_today FROM bounds) THEN
        COALESCE(
          CASE WHEN u.urole IN ('partner', 'master_partner') THEN lp.bal ELSE lw.bal END,
          CASE WHEN u.urole IN ('partner', 'master_partner') THEN pc.bal ELSE wc.bal END,
          CASE WHEN u.urole IN ('partner', 'master_partner') THEN po.bal ELSE wo.bal END,
          0
        )
      ELSE
        COALESCE(
          CASE WHEN u.urole IN ('partner', 'master_partner') THEN pc.bal ELSE wc.bal END,
          CASE WHEN u.urole IN ('partner', 'master_partner') THEN po.bal ELSE wo.bal END,
          0
        )
    END                                                        AS closing

  FROM filtered_users u
  LEFT JOIN wl_opening    wo ON wo.uid = u.uid AND u.urole NOT IN ('partner', 'master_partner')
  LEFT JOIN wl_closing    wc ON wc.uid = u.uid AND u.urole NOT IN ('partner', 'master_partner')
  LEFT JOIN pwl_opening   po ON po.uid = u.uid AND u.urole IN ('partner', 'master_partner')
  LEFT JOIN pwl_closing   pc ON pc.uid = u.uid AND u.urole IN ('partner', 'master_partner')
  LEFT JOIN live_wl       lw ON lw.uid = u.uid AND u.urole NOT IN ('partner', 'master_partner')
  LEFT JOIN live_pwl      lp ON lp.uid = u.uid AND u.urole IN ('partner', 'master_partner')
  ORDER BY closing DESC;
$$;

REVOKE ALL ON FUNCTION public.all_user_balances(date, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.all_user_balances(date, text, text) TO service_role;
