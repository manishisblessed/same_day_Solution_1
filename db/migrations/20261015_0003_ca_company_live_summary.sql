-- ============================================================================
-- CA Billing — per-company (brand) live summary for the dashboard
-- ============================================================================
-- Returns one row per brand that has activity in the CURRENT MONTH (IST),
-- with today's and month-to-date aggregates plus projected service charge + GST
-- (using each brand's company config margin/GST, defaulting to 20% / 18%).
--
-- All day/month boundaries are computed in Asia/Kolkata so "today" matches the
-- operator's local day. Only status='issued' reimbursements are counted
-- (voided/reversed transactions are excluded automatically).
-- ============================================================================

CREATE OR REPLACE FUNCTION ca_company_live_summary()
RETURNS TABLE (
  brand_id             UUID,
  brand_name           TEXT,
  brand_short          TEXT,
  today_count          BIGINT,
  today_txn_value      NUMERIC,
  today_bank_mdr       NUMERIC,
  month_count          BIGINT,
  month_txn_value      NUMERIC,
  month_bank_mdr       NUMERIC,
  margin_percent       NUMERIC,
  gst_percent          NUMERIC,
  month_service_charge NUMERIC,
  month_gst            NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH ist AS (
    SELECT
      (now() AT TIME ZONE 'Asia/Kolkata')::date AS today,
      date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date AS month_start
  ),
  agg AS (
    SELECT
      ri.brand_id,
      COUNT(*) FILTER (WHERE ri.transaction_date = ist.today)                              AS today_count,
      COALESCE(SUM(ri.transaction_amount) FILTER (WHERE ri.transaction_date = ist.today),0) AS today_txn_value,
      COALESCE(SUM(ri.bank_mdr_amount)    FILTER (WHERE ri.transaction_date = ist.today),0) AS today_bank_mdr,
      COUNT(*)                                                                             AS month_count,
      COALESCE(SUM(ri.transaction_amount),0)                                              AS month_txn_value,
      COALESCE(SUM(ri.bank_mdr_amount),0)                                                 AS month_bank_mdr
    FROM ca_reimbursement_invoices ri
    CROSS JOIN ist
    WHERE ri.status = 'issued'
      AND ri.transaction_date >= ist.month_start
      AND ri.brand_id IS NOT NULL
    GROUP BY ri.brand_id
  )
  SELECT
    a.brand_id,
    b.name,
    COALESCE(b.short_name, b.key, 'Unknown'),
    a.today_count,
    a.today_txn_value,
    a.today_bank_mdr,
    a.month_count,
    a.month_txn_value,
    a.month_bank_mdr,
    COALESCE(cc.margin_percent, 20),
    COALESCE(cc.gst_percent, 18),
    ROUND(a.month_bank_mdr * (1 + COALESCE(cc.margin_percent, 20) / 100.0), 2),
    ROUND(a.month_bank_mdr * (1 + COALESCE(cc.margin_percent, 20) / 100.0)
          * COALESCE(cc.gst_percent, 18) / 100.0, 2)
  FROM agg a
  LEFT JOIN brands b             ON b.id = a.brand_id
  LEFT JOIN ca_company_config cc ON cc.brand_id = a.brand_id
  ORDER BY a.month_bank_mdr DESC;
$$;
