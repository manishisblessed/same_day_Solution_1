-- ============================================================================
-- Complete CA data pipeline fix:
--
--   1. Add razorpay_pos_transaction_id column to ca_reimbursement_invoices
--   2. Create trigger on razorpay_pos_transactions (the primary POS table)
--      — resolves brand via merchant_slug → brands.key (not pos_machines)
--   3. Create void trigger on razorpay_pos_transactions
--   4. Set brand_id on AXIS pos_machines → TEACHWAY-AXIS brand
--   5. Create backfill function for razorpay_pos_transactions
--   6. Rewrite ca_company_live_summary to query reimbursement invoices
--
-- After this migration, run:
--   SELECT * FROM ca_backfill_reimbursements('2026-01-01', CURRENT_DATE);
--   SELECT * FROM ca_backfill_reimbursements_razorpay('2026-01-01', CURRENT_DATE);
-- ============================================================================


-- ── 1. Add razorpay_pos_transaction_id to reimbursement invoices ─────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ca_reimbursement_invoices' AND column_name = 'razorpay_pos_transaction_id'
  ) THEN
    ALTER TABLE ca_reimbursement_invoices
      ADD COLUMN razorpay_pos_transaction_id UUID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ca_reimb_razorpay_pos_txn
  ON ca_reimbursement_invoices (razorpay_pos_transaction_id)
  WHERE razorpay_pos_transaction_id IS NOT NULL;


-- ── 2. Trigger on razorpay_pos_transactions ──────────────────────────────────

CREATE OR REPLACE FUNCTION ca_auto_reimbursement_from_razorpay()
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
  IF NEW.status NOT IN ('CAPTURED', 'AUTHORIZED', 'captured', 'authorized') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM ca_reimbursement_invoices WHERE razorpay_pos_transaction_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  v_tid        := NEW.tid;
  v_amount_inr := COALESCE(NEW.amount, 0);  -- already in rupees
  v_mode       := COALESCE(NEW.payment_mode, '*');
  v_card_type  := COALESCE(NEW.card_type, '*');
  v_today      := COALESCE((NEW.transaction_time)::DATE, CURRENT_DATE);

  -- Resolve brand: prefer merchant_slug → brands.key, fallback to pos_machines
  IF NEW.merchant_slug IS NOT NULL AND NEW.merchant_slug <> '' THEN
    SELECT b.id INTO v_brand_id
    FROM brands b WHERE b.key = NEW.merchant_slug LIMIT 1;
  END IF;

  IF v_brand_id IS NULL AND v_tid IS NOT NULL THEN
    SELECT pm.brand_id INTO v_brand_id
    FROM pos_machines pm
    WHERE pm.tid = v_tid AND pm.brand_id IS NOT NULL
    LIMIT 1;
  END IF;

  IF v_brand_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Best-match MDR config
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
    invoice_number, razorpay_pos_transaction_id, razorpay_txn_id,
    brand_id, partner_id, tid,
    transaction_amount, payment_mode, card_type, card_brand,
    bank_mdr_config_id, bank_mdr_percent, bank_mdr_amount,
    transaction_date, status
  ) VALUES (
    v_inv_num, NEW.id, NEW.txn_id,
    v_brand_id, NEW.partner_id, v_tid,
    v_amount_inr, v_mode, v_card_type, NEW.card_brand,
    v_config_id, v_mdr_pct, v_mdr_amt,
    v_today, 'issued'
  )
  ON CONFLICT (razorpay_pos_transaction_id) WHERE razorpay_pos_transaction_id IS NOT NULL DO NOTHING;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[ca_auto_reimbursement_from_razorpay] tid=% txn=%: %', v_tid, NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ca_auto_reimb_razorpay ON razorpay_pos_transactions;
CREATE TRIGGER trg_ca_auto_reimb_razorpay
  AFTER INSERT ON razorpay_pos_transactions
  FOR EACH ROW
  EXECUTE FUNCTION ca_auto_reimbursement_from_razorpay();


-- ── 3. Void trigger on razorpay_pos_transactions ────────────────────────────

CREATE OR REPLACE FUNCTION ca_void_reimbursement_on_razorpay_reversal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('REFUNDED', 'VOIDED', 'FAILED', 'refunded', 'voided', 'failed')
     AND OLD.status NOT IN ('REFUNDED', 'VOIDED', 'FAILED', 'refunded', 'voided', 'failed') THEN
    UPDATE ca_reimbursement_invoices
    SET status = 'void',
        void_reason = 'Transaction ' || NEW.status,
        updated_at = now()
    WHERE razorpay_pos_transaction_id = NEW.id
      AND status = 'issued';
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ca_void_reimb_razorpay ON razorpay_pos_transactions;
CREATE TRIGGER trg_ca_void_reimb_razorpay
  AFTER UPDATE OF status ON razorpay_pos_transactions
  FOR EACH ROW
  EXECUTE FUNCTION ca_void_reimbursement_on_razorpay_reversal();


-- ── 4. Fix pos_machines brand_id for AXIS → TEACHWAY ────────────────────────

UPDATE pos_machines
SET brand_id = '7d1610f8-74c9-44a3-b0cf-eaa4fae4aa23'  -- TEACHWAY - AXIS
WHERE brand = 'AXIS'
  AND brand_id IS NULL;


-- ── 5. Backfill function for razorpay_pos_transactions ──────────────────────

CREATE OR REPLACE FUNCTION ca_backfill_reimbursements_razorpay(
  p_date_from DATE,
  p_date_to   DATE,
  p_brand_id  UUID DEFAULT NULL
)
RETURNS TABLE (processed INTEGER, skipped INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r             RECORD;
  v_brand_id    UUID;
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
  v_processed   INTEGER := 0;
  v_skipped     INTEGER := 0;
BEGIN
  FOR r IN
    SELECT t.id, t.tid, t.amount, t.payment_mode, t.card_type,
           t.card_brand, t.txn_id, t.partner_id, t.transaction_time,
           t.merchant_slug
    FROM razorpay_pos_transactions t
    WHERE t.status IN ('CAPTURED', 'AUTHORIZED', 'captured', 'authorized')
      AND t.created_at >= p_date_from::timestamptz
      AND t.created_at < (p_date_to::timestamptz + interval '1 day')
      AND NOT EXISTS (
        SELECT 1 FROM ca_reimbursement_invoices ri WHERE ri.razorpay_pos_transaction_id = t.id
      )
  LOOP
    BEGIN
      v_brand_id := NULL;
      v_config_id := NULL;
      v_mdr_pct := 0;

      -- Resolve brand via merchant_slug
      IF r.merchant_slug IS NOT NULL AND r.merchant_slug <> '' THEN
        SELECT b.id INTO v_brand_id FROM brands b WHERE b.key = r.merchant_slug LIMIT 1;
      END IF;
      IF v_brand_id IS NULL AND r.tid IS NOT NULL THEN
        SELECT pm.brand_id INTO v_brand_id
        FROM pos_machines pm WHERE pm.tid = r.tid AND pm.brand_id IS NOT NULL LIMIT 1;
      END IF;

      IF v_brand_id IS NULL THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      IF p_brand_id IS NOT NULL AND v_brand_id <> p_brand_id THEN
        CONTINUE;
      END IF;

      v_amount_inr := COALESCE(r.amount, 0);
      v_mode       := COALESCE(r.payment_mode, '*');
      v_card_type  := COALESCE(r.card_type, '*');
      v_today      := COALESCE((r.transaction_time)::DATE, CURRENT_DATE);

      SELECT c.id, c.bank_mdr_percent
      INTO   v_config_id, v_mdr_pct
      FROM   ca_bank_mdr_config c
      WHERE  c.brand_id = v_brand_id
        AND  c.is_active = TRUE
        AND  c.effective_from <= v_today
        AND  (c.effective_to IS NULL OR c.effective_to >= v_today)
        AND  (c.tid = r.tid OR c.tid IS NULL)
        AND  (c.payment_mode = v_mode OR c.payment_mode = '*')
        AND  (c.card_type = v_card_type OR c.card_type = '*')
      ORDER BY
        CASE WHEN c.tid = r.tid THEN 0 ELSE 1 END,
        CASE WHEN c.payment_mode = v_mode THEN 0 WHEN c.payment_mode = '*' THEN 1 ELSE 2 END,
        CASE WHEN c.card_type = v_card_type THEN 0 WHEN c.card_type = '*' THEN 1 ELSE 2 END
      LIMIT 1;

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
        invoice_number, razorpay_pos_transaction_id, razorpay_txn_id,
        brand_id, partner_id, tid,
        transaction_amount, payment_mode, card_type, card_brand,
        bank_mdr_config_id, bank_mdr_percent, bank_mdr_amount,
        transaction_date, status
      ) VALUES (
        v_inv_num, r.id, r.txn_id,
        v_brand_id, r.partner_id, r.tid,
        v_amount_inr, v_mode, v_card_type, r.card_brand,
        v_config_id, v_mdr_pct, v_mdr_amt,
        v_today, 'issued'
      )
      ON CONFLICT (razorpay_pos_transaction_id) WHERE razorpay_pos_transaction_id IS NOT NULL DO NOTHING;

      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      RAISE WARNING '[ca_backfill_razorpay] txn=% skipped: %', r.id, SQLERRM;
    END;
  END LOOP;

  processed := v_processed;
  skipped   := v_skipped;
  RETURN NEXT;
END;
$$;


-- ── 6. Rewrite live summary to query reimbursement invoices (single source) ─

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
    agg AS (
      SELECT
        ri.brand_id,
        COUNT(*) FILTER (WHERE ri.transaction_date = ist.today)                     AS today_count,
        COALESCE(SUM(ri.transaction_amount) FILTER (WHERE ri.transaction_date = ist.today), 0) AS today_txn_value,
        COALESCE(SUM(ri.bank_mdr_amount) FILTER (WHERE ri.transaction_date = ist.today), 0)    AS today_bank_mdr,
        COUNT(*)                                                                     AS month_count,
        COALESCE(SUM(ri.transaction_amount), 0)                                      AS month_txn_value,
        COALESCE(SUM(ri.bank_mdr_amount), 0)                                         AS month_bank_mdr
      FROM ca_reimbursement_invoices ri
      CROSS JOIN ist
      WHERE ri.status = 'issued'
        AND ri.transaction_date >= ist.month_start
      GROUP BY ri.brand_id
    )
  SELECT
    a.brand_id,
    COALESCE(b.name, b.short_name, b.key)                                AS brand_name,
    COALESCE(b.short_name, UPPER(b.key))                                 AS brand_short,
    a.today_count,
    a.today_txn_value,
    a.today_bank_mdr,
    a.month_count,
    a.month_txn_value,
    a.month_bank_mdr,
    COALESCE(cc.margin_percent, 20)                                      AS margin_percent,
    COALESCE(cc.gst_percent, 18)                                         AS gst_percent,
    ROUND(a.month_bank_mdr * (1 + COALESCE(cc.margin_percent, 20)/100), 2) AS month_service_charge,
    ROUND(a.month_bank_mdr * (1 + COALESCE(cc.margin_percent, 20)/100)
          * COALESCE(cc.gst_percent, 18)/100, 2)                         AS month_gst
  FROM agg a
  JOIN brands b ON b.id = a.brand_id
  LEFT JOIN ca_company_config cc ON cc.brand_id = a.brand_id
  ORDER BY a.month_txn_value DESC;
$$;
