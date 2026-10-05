-- Per-transaction company revenue reporting.
--
-- Company revenue for every charge-model service (BBPS, pay2new, settlement-2/
-- shadval, payout, rechargekit…) is booked to the platform revenue wallet as a
-- wallet_ledger row with fund_category='revenue':
--   credit, transaction_type='COMPANY_REVENUE'  → revenue earned on a txn
--   debit  (reversal transaction_types)         → revenue clawed back
--
-- net revenue = Σ COMPANY_REVENUE credit − Σ revenue-category debit (reversals).
--
-- This function returns the per-service aggregate for a date range so the admin
-- report can show totals without paging every row through the API. The detail
-- rows are fetched separately by the API via a normal paginated query.

CREATE OR REPLACE FUNCTION get_company_revenue_summary(
  p_user_id text,
  p_from timestamptz,
  p_to timestamptz,
  p_services text[] DEFAULT NULL
)
RETURNS TABLE(
  service_type text,
  txns bigint,
  gross numeric,
  reversed numeric,
  net numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    wl.service_type,
    count(*) FILTER (WHERE wl.transaction_type = 'COMPANY_REVENUE')                         AS txns,
    COALESCE(sum(wl.credit) FILTER (WHERE wl.transaction_type = 'COMPANY_REVENUE'), 0)       AS gross,
    COALESCE(sum(wl.debit), 0)                                                               AS reversed,
    COALESCE(sum(wl.credit) FILTER (WHERE wl.transaction_type = 'COMPANY_REVENUE'), 0)
      - COALESCE(sum(wl.debit), 0)                                                           AS net
  FROM wallet_ledger wl
  WHERE wl.retailer_id = p_user_id
    AND wl.fund_category = 'revenue'
    AND wl.created_at >= p_from
    AND wl.created_at <= p_to
    AND (p_services IS NULL OR wl.service_type = ANY(p_services))
  GROUP BY wl.service_type
  ORDER BY net DESC;
$$;

-- Helps the date-range + revenue-wallet scans used by the report.
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_revenue_report
  ON wallet_ledger (retailer_id, fund_category, created_at)
  WHERE fund_category = 'revenue';
