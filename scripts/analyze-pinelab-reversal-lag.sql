-- ============================================================================
-- PHASE 0 — PINE LABS REVERSAL-LAG ANALYSIS  (READ-ONLY)
-- ============================================================================
-- Sizes the two knobs in the "instant but protected" design:
--   1. PINELAB_FORWARD_HOLD_SECONDS — how long to hold a fresh SUCCESS before
--      forwarding it to a partner. Pick the smallest hold that catches the bulk
--      of reversals (see the lag histogram / percentiles below).
--   2. Partner rolling-reserve % — how much rupee exposure lives in the tail
--      that lands AFTER any sane hold (see the tail-exposure section).
--
-- Nothing here writes. Run in Supabase SQL editor / psql. Optionally scope to a
-- single merchant by uncommenting the `AND merchant_slug = '...'` filters.
-- ============================================================================

-- ── 1. Reversal-lag histogram (transaction_time → reversed_at) ──────────────
-- How long after capture did Pine Labs flip the txn to a terminal state?
WITH rev AS (
  SELECT
    txn_id,
    merchant_slug,
    amount,
    display_status,
    transaction_time,
    reversed_at,
    EXTRACT(EPOCH FROM (reversed_at - transaction_time)) AS lag_seconds
  FROM razorpay_pos_transactions
  WHERE txn_id LIKE 'PL\_%'
    AND reversed_at IS NOT NULL
    AND transaction_time IS NOT NULL
    -- AND merchant_slug = 'samedaytours'
    AND reversed_at >= transaction_time
)
SELECT
  CASE
    WHEN lag_seconds < 60        THEN 'a. <1 min'
    WHEN lag_seconds < 120       THEN 'b. 1-2 min'
    WHEN lag_seconds < 300       THEN 'c. 2-5 min'
    WHEN lag_seconds < 900       THEN 'd. 5-15 min'
    WHEN lag_seconds < 1800      THEN 'e. 15-30 min'
    WHEN lag_seconds < 7200      THEN 'f. 30 min-2 h'
    WHEN lag_seconds < 86400     THEN 'g. 2-24 h'
    WHEN lag_seconds < 604800    THEN 'h. 1-7 days'
    ELSE                              'i. >7 days'
  END AS lag_bucket,
  COUNT(*)                                   AS txn_count,
  ROUND(SUM(amount)::numeric, 2)             AS total_amount,
  ROUND(AVG(lag_seconds)::numeric, 1)        AS avg_lag_seconds
FROM rev
GROUP BY 1
ORDER BY 1;

-- ── 2. Lag percentiles (the hold-sizing number) ────────────────────────────
-- e.g. if p95 = 90s and p99 = 150s, a 180s hold catches ~99% of reversals
-- before you ever tell the partner SUCCESS.
WITH rev AS (
  SELECT EXTRACT(EPOCH FROM (reversed_at - transaction_time)) AS lag_seconds
  FROM razorpay_pos_transactions
  WHERE txn_id LIKE 'PL\_%'
    AND reversed_at IS NOT NULL
    AND transaction_time IS NOT NULL
    -- AND merchant_slug = 'samedaytours'
    AND reversed_at >= transaction_time
)
SELECT
  COUNT(*)                                                             AS reversed_txns,
  ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY lag_seconds)::numeric, 1) AS p50_seconds,
  ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY lag_seconds)::numeric, 1) AS p90_seconds,
  ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY lag_seconds)::numeric, 1) AS p95_seconds,
  ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY lag_seconds)::numeric, 1) AS p99_seconds
FROM rev;

-- ── 3. Overall reversal rate (how big is the problem at all?) ───────────────
SELECT
  merchant_slug,
  COUNT(*)                                                          AS total_pl_txns,
  COUNT(*) FILTER (WHERE reversed_at IS NOT NULL)                   AS reversed_txns,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE reversed_at IS NOT NULL) / NULLIF(COUNT(*), 0),
    3
  )                                                                 AS reversed_pct,
  ROUND(SUM(amount) FILTER (WHERE reversed_at IS NOT NULL)::numeric, 2) AS reversed_amount
FROM razorpay_pos_transactions
WHERE txn_id LIKE 'PL\_%'
  -- AND merchant_slug = 'samedaytours'
GROUP BY merchant_slug
ORDER BY reversed_amount DESC NULLS LAST;

-- ── 4. Tail exposure AFTER a candidate hold (the reserve-sizing number) ─────
-- Rupees that reverse LATER than the hold would catch → these can slip through
-- as a forwarded SUCCESS and must be covered by the rolling reserve.
-- Adjust the 180 (seconds) to whatever hold you choose in section 2.
WITH rev AS (
  SELECT
    amount,
    partner_wallet_credited,
    EXTRACT(EPOCH FROM (reversed_at - transaction_time)) AS lag_seconds
  FROM razorpay_pos_transactions
  WHERE txn_id LIKE 'PL\_%'
    AND reversed_at IS NOT NULL
    AND transaction_time IS NOT NULL
    -- AND merchant_slug = 'samedaytours'
    AND reversed_at >= transaction_time
)
SELECT
  180                                                            AS assumed_hold_seconds,
  COUNT(*) FILTER (WHERE lag_seconds > 180)                      AS slip_through_txns,
  ROUND(SUM(amount) FILTER (WHERE lag_seconds > 180)::numeric, 2) AS slip_through_amount,
  COUNT(*) FILTER (WHERE lag_seconds > 180 AND partner_wallet_credited) AS slip_after_settlement_txns,
  ROUND(
    SUM(amount) FILTER (WHERE lag_seconds > 180 AND partner_wallet_credited)::numeric,
    2
  )                                                              AS slip_after_settlement_amount
FROM rev;
