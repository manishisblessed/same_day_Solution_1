-- ============================================================================
-- Fix: ca_auto_reimbursement_invoice fails silently when no MDR config exists.
--
-- Root cause: SELECT * INTO v_config (RECORD) finds no row → record stays
-- uninitialized → accessing v_config.bank_mdr_percent raises an error →
-- caught by EXCEPTION WHEN OTHERS → no invoice created, no visible error.
--
-- Fix: After SELECT INTO, check FOUND. If no MDR config, default to 0% and
-- still create the reimbursement invoice. This ensures every transaction is
-- captured for the CA even before bank MDR rates are configured.
--
-- Also rewrites ca_company_live_summary to query pos_transactions directly
-- (LEFT JOIN reimbursement) so the live view works even before invoices exist.
-- ============================================================================

CREATE OR REPLACE FUNCTION ca_auto_reimbursement_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand_id    UUID;
  v_tid         TEXT;
  v_amount_inr  NUMERIC(15, 2);
  v_mode        TEXT;
  v_card_type   TEXT;
  v_config_id   UUID    := NULL;
  v_mdr_pct     NUMERIC(8, 4) := 0;
  v_mdr_amt     NUMERIC(15, 2) := 0;
  v_inv_num     TEXT;
  v_today       DATE;
  v_seq         INTEGER;
  v_brand_short TEXT;
BEGIN
  -- Only successful transactions
  IF NEW.status NOT IN ('CAPTURED', 'AUTHORIZED') THEN
    RETURN NEW;
  END IF;

  -- Idempotency: skip if this transaction already has an invoice
  IF EXISTS (SELECT 1 FROM ca_reimbursement_invoices WHERE pos_transaction_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  v_tid        := NEW.terminal_id;
  v_amount_inr := ROUND(NEW.amount / 100.0, 2);
  v_mode       := COALESCE(NEW.payment_mode, '*');
  v_card_type  := COALESCE(NEW.card_type, '*');
  v_today      := COALESCE(NEW.txn_time::DATE, CURRENT_DATE);

  -- Resolve brand from the POS machine registry
  SELECT pm.brand_id INTO v_brand_id
  FROM pos_machines pm
  WHERE pm.tid = v_tid
    AND pm.brand_id IS NOT NULL
  LIMIT 1;

  IF v_brand_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Best-match bank MDR config. Use scalar SELECTs so an empty result
  -- simply leaves the defaults (NULL / 0) instead of raising an error.
  SELECT c.id, c.bank_mdr_percent
  INTO   v_config_id, v_mdr_pct
  FROM   ca_bank_mdr_config c
  WHERE  c.brand_id = v_brand_id
    AND  c.is_active = TRUE
    AND  c.effective_from <= v_today
    AND  (c.effective_to IS NULL OR c.effective_to >= v_today)
    AND  (c.tid = v_tid OR c.tid IS NULL)
    AND  (c.payment_mode = v_mode OR c.payment_mode = '*')
    AND  (c.card_type = v_card_type OR c.card_type = '*')
  ORDER BY
    CASE WHEN c.tid = v_tid THEN 0 ELSE 1 END,
    CASE WHEN c.payment_mode = v_mode THEN 0 WHEN c.payment_mode = '*' THEN 1 ELSE 2 END,
    CASE WHEN c.card_type = v_card_type THEN 0 WHEN c.card_type = '*' THEN 1 ELSE 2 END
  LIMIT 1;

  -- If no config found, defaults remain: v_config_id=NULL, v_mdr_pct=0
  v_mdr_pct := COALESCE(v_mdr_pct, 0);
  v_mdr_amt := ROUND(v_amount_inr * v_mdr_pct / 100, 2);

  SELECT COALESCE(short_name, UPPER(key), 'XX') INTO v_brand_short
  FROM brands WHERE id = v_brand_id;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('ca_reimb:' || v_brand_short || ':' || TO_CHAR(v_today, 'YYYYMMDD'), 0)
  );

  SELECT COALESCE(MAX((regexp_match(invoice_number, '(\d+)$'))[1]::INTEGER), 0) + 1
  INTO v_seq
  FROM ca_reimbursement_invoices
  WHERE invoice_number LIKE 'REIMB-' || v_brand_short || '-' || TO_CHAR(v_today, 'YYYYMMDD') || '-%';

  v_inv_num := 'REIMB-' || v_brand_short || '-' || TO_CHAR(v_today, 'YYYYMMDD') || '-' || LPAD(v_seq::TEXT, 5, '0');

  INSERT INTO ca_reimbursement_invoices (
    invoice_number, pos_transaction_id, razorpay_txn_id,
    brand_id, partner_id, tid,
    transaction_amount, payment_mode, card_type, card_brand,
    bank_mdr_config_id, bank_mdr_percent, bank_mdr_amount,
    transaction_date, status
  ) VALUES (
    v_inv_num, NEW.id, NEW.razorpay_txn_id,
    v_brand_id, NEW.partner_id, v_tid,
    v_amount_inr, v_mode, v_card_type, NEW.card_brand,
    v_config_id, v_mdr_pct, v_mdr_amt,
    v_today, 'issued'
  )
  ON CONFLICT (pos_transaction_id) WHERE pos_transaction_id IS NOT NULL DO NOTHING;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[ca_auto_reimbursement_invoice] tid=% txn=%: %', v_tid, NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;


-- ============================================================================
-- Rewrite ca_company_live_summary to query pos_transactions directly so the
-- live view works immediately, regardless of whether reimbursement invoices
-- have been backfilled. LEFT JOINs ca_reimbursement_invoices for MDR data
-- when available, otherwise shows 0.
-- ============================================================================

CREATE OR REPLACE FUNCTION ca_company_live_summary()
RETURNS TABLE (
  brand_id       UUID,
  brand_name     TEXT,
  brand_short    TEXT,
  today_count    BIGINT,
  today_txn_value NUMERIC,
  today_bank_mdr NUMERIC,
  month_count    BIGINT,
  month_txn_value NUMERIC,
  month_bank_mdr NUMERIC,
  margin_percent NUMERIC,
  gst_percent    NUMERIC,
  month_service_charge NUMERIC,
  month_gst      NUMERIC
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH
    ist AS (
      SELECT
        (now() AT TIME ZONE 'Asia/Kolkata')::date AS today,
        date_trunc('month', (now() AT TIME ZONE 'Asia/Kolkata'))::date AS month_start
    ),
    txn AS (
      SELECT
        pm.brand_id,
        ROUND(pt.amount / 100.0, 2) AS amt_inr,
        COALESCE(ri.bank_mdr_amount, 0) AS mdr_amt,
        (pt.txn_time AT TIME ZONE 'Asia/Kolkata')::date AS txn_day
      FROM pos_transactions pt
      JOIN pos_machines pm ON pm.tid = pt.terminal_id AND pm.brand_id IS NOT NULL
      LEFT JOIN ca_reimbursement_invoices ri ON ri.pos_transaction_id = pt.id AND ri.status = 'issued'
      CROSS JOIN ist
      WHERE pt.status IN ('CAPTURED', 'AUTHORIZED')
        AND (pt.txn_time AT TIME ZONE 'Asia/Kolkata')::date >= ist.month_start
    ),
    agg AS (
      SELECT
        t.brand_id,
        COUNT(*) FILTER (WHERE t.txn_day = ist.today)                   AS today_count,
        COALESCE(SUM(t.amt_inr) FILTER (WHERE t.txn_day = ist.today), 0)  AS today_txn_value,
        COALESCE(SUM(t.mdr_amt) FILTER (WHERE t.txn_day = ist.today), 0)  AS today_bank_mdr,
        COUNT(*)                                                         AS month_count,
        COALESCE(SUM(t.amt_inr), 0)                                      AS month_txn_value,
        COALESCE(SUM(t.mdr_amt), 0)                                      AS month_bank_mdr
      FROM txn t
      CROSS JOIN ist
      GROUP BY t.brand_id
    )
  SELECT
    a.brand_id,
    COALESCE(b.name, b.short_name, b.key)                              AS brand_name,
    COALESCE(b.short_name, UPPER(b.key))                               AS brand_short,
    a.today_count,
    a.today_txn_value,
    a.today_bank_mdr,
    a.month_count,
    a.month_txn_value,
    a.month_bank_mdr,
    COALESCE(cc.margin_percent, 20)                                    AS margin_percent,
    COALESCE(cc.gst_percent, 18)                                       AS gst_percent,
    ROUND(a.month_bank_mdr * (1 + COALESCE(cc.margin_percent, 20)/100), 2) AS month_service_charge,
    ROUND(a.month_bank_mdr * (1 + COALESCE(cc.margin_percent, 20)/100)
          * COALESCE(cc.gst_percent, 18)/100, 2)                       AS month_gst
  FROM agg a
  JOIN brands b ON b.id = a.brand_id
  LEFT JOIN ca_company_config cc ON cc.brand_id = a.brand_id
  ORDER BY a.month_txn_value DESC;
$$;
