-- ============================================================================
-- CA Billing: Card-brand MDR + monthly-reset invoice numbering
--
--   1. Add card_brand to ca_bank_mdr_config
--      Values: VISA | MASTER | AMEX | DINERS | RUPAY | *
--
--   2. Link reimbursement invoices → GST transaction invoice
--      (ca_reimbursement_invoices.transaction_invoice_id)
--
--   3. New invoice-number format (per brand, resets 1st of every month):
--        Reimbursement : AVI_OCT_0001, AVI_OCT_0002, ...
--        GST (TXNINV)  : AVI_OCT_01
--      First 3 alphanumeric chars of brand short/key + 3-letter month.
--
--   4. Rewrite all 3 reimbursement generators (pos_transactions trigger,
--      razorpay_pos_transactions trigger, backfill functions) to:
--        - match card_brand too (precedence: exact > '*')
--        - use the new monthly numbering helper
--
--   5. Add helper RPC ca_link_reimbursements_to_txninv() so the API can
--      stamp reimbursement rows when a GST invoice is (re)generated.
-- ============================================================================


-- ── 1. card_brand column + check constraint ─────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ca_bank_mdr_config' AND column_name = 'card_brand'
  ) THEN
    ALTER TABLE ca_bank_mdr_config
      ADD COLUMN card_brand TEXT NOT NULL DEFAULT '*';
  END IF;

  -- Drop any older constraint and (re)add with VISA/MASTER/AMEX/DINERS/RUPAY/*
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ca_bank_mdr_config_card_brand_check'
  ) THEN
    ALTER TABLE ca_bank_mdr_config DROP CONSTRAINT ca_bank_mdr_config_card_brand_check;
  END IF;

  ALTER TABLE ca_bank_mdr_config
    ADD CONSTRAINT ca_bank_mdr_config_card_brand_check
    CHECK (card_brand IN ('VISA', 'MASTER', 'AMEX', 'DINERS', 'RUPAY', '*'));
END $$;

CREATE INDEX IF NOT EXISTS idx_ca_bank_mdr_card_brand
  ON ca_bank_mdr_config (brand_id, card_brand) WHERE is_active;


-- ── 2. Reimbursement ↔ GST invoice link ─────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ca_reimbursement_invoices'
      AND column_name = 'transaction_invoice_id'
  ) THEN
    ALTER TABLE ca_reimbursement_invoices
      ADD COLUMN transaction_invoice_id UUID
        REFERENCES ca_transaction_invoices(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ca_reimb_txninv
  ON ca_reimbursement_invoices (transaction_invoice_id)
  WHERE transaction_invoice_id IS NOT NULL;


-- ── 3. Helper: 3-letter brand short, 3-letter month ─────────────────────────
CREATE OR REPLACE FUNCTION ca_brand_short3(p_brand_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE AS $$
  SELECT UPPER(
    REGEXP_REPLACE(
      COALESCE(short_name, key, 'XXX'),
      '[^A-Za-z0-9]', '', 'g'
    )
  )
  FROM brands WHERE id = p_brand_id
$$;

CREATE OR REPLACE FUNCTION ca_month_short(p_date DATE)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT UPPER(TO_CHAR(p_date, 'Mon'))
$$;

-- Normalize messy card_brand values from gateways to our enum
CREATE OR REPLACE FUNCTION ca_normalize_card_brand(p_raw TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_raw IS NULL OR TRIM(p_raw) = '' THEN '*'
    WHEN UPPER(TRIM(p_raw)) IN ('VISA')                                     THEN 'VISA'
    WHEN UPPER(TRIM(p_raw)) IN ('MASTER','MASTERCARD','MC','MASTER_CARD')    THEN 'MASTER'
    WHEN UPPER(TRIM(p_raw)) IN ('AMEX','AMERICAN_EXPRESS','AMERICANEXPRESS') THEN 'AMEX'
    WHEN UPPER(TRIM(p_raw)) IN ('DINERS','DINERS_CLUB','DINERSCLUB')         THEN 'DINERS'
    WHEN UPPER(TRIM(p_raw)) IN ('RUPAY','RUPEE')                             THEN 'RUPAY'
    ELSE '*'
  END
$$;


-- ── 4. Monthly reimbursement invoice-number generator ───────────────────────
--      Format: {BRANDSHORT3}_{MON}_{NNNN}  e.g. AVI_OCT_0001
--      Resets the 1st of each calendar month per brand.
CREATE OR REPLACE FUNCTION ca_next_reimb_number(p_brand_id UUID, p_date DATE)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_short3   TEXT;
  v_mon      TEXT;
  v_prefix   TEXT;
  v_month_s  DATE := DATE_TRUNC('month', p_date)::DATE;
  v_month_e  DATE := (DATE_TRUNC('month', p_date) + INTERVAL '1 month - 1 day')::DATE;
  v_seq      INTEGER;
BEGIN
  v_short3 := LEFT(ca_brand_short3(p_brand_id), 3);
  IF v_short3 IS NULL OR v_short3 = '' THEN v_short3 := 'XXX'; END IF;

  v_mon    := ca_month_short(p_date);
  v_prefix := v_short3 || '_' || v_mon || '_';

  -- Advisory lock keyed by brand+month to serialize number generation.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ca_reimb_num:' || p_brand_id::TEXT || ':' || TO_CHAR(p_date, 'YYYYMM'), 0)
  );

  SELECT COALESCE(MAX((regexp_match(invoice_number, '(\d+)$'))[1]::INTEGER), 0) + 1
  INTO v_seq
  FROM ca_reimbursement_invoices
  WHERE brand_id = p_brand_id
    AND transaction_date BETWEEN v_month_s AND v_month_e
    AND invoice_number LIKE v_prefix || '%';

  RETURN v_prefix || LPAD(v_seq::TEXT, 4, '0');
END;
$$;


-- Replace GST transaction invoice numbering with same monthly format
--   {BRANDSHORT3}_{MON}_{NN}   e.g. AVI_OCT_01
CREATE OR REPLACE FUNCTION ca_next_txninv_number(p_brand_id UUID, p_year INT, p_month INT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_short3   TEXT;
  v_mon      TEXT;
  v_prefix   TEXT;
  v_seq      INTEGER;
  v_date     DATE := MAKE_DATE(p_year, p_month, 1);
BEGIN
  v_short3 := LEFT(ca_brand_short3(p_brand_id), 3);
  IF v_short3 IS NULL OR v_short3 = '' THEN v_short3 := 'XXX'; END IF;

  v_mon    := ca_month_short(v_date);
  v_prefix := v_short3 || '_' || v_mon || '_';

  SELECT COALESCE(MAX((regexp_match(invoice_number, '(\d+)$'))[1]::INTEGER), 0) + 1
  INTO v_seq
  FROM ca_transaction_invoices
  WHERE brand_id = p_brand_id
    AND period_start = v_date
    AND invoice_number LIKE v_prefix || '%';

  RETURN v_prefix || LPAD(v_seq::TEXT, 2, '0');
END;
$$;


-- ── 5. Trigger: pos_transactions → reimbursement (adds card_brand match) ────
CREATE OR REPLACE FUNCTION ca_auto_reimbursement_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brand_id    UUID;
  v_partner_id  UUID;
  v_tid         TEXT;
  v_amount_inr  NUMERIC(15, 2);
  v_mode        TEXT;
  v_card_type   TEXT;
  v_card_brand  TEXT;
  v_config_id   UUID := NULL;
  v_mdr_pct     NUMERIC(8, 4) := 0;
  v_mdr_amt     NUMERIC(15, 2) := 0;
  v_inv_num     TEXT;
  v_today       DATE;
BEGIN
  IF NEW.status NOT IN ('CAPTURED', 'AUTHORIZED', 'captured', 'authorized') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM ca_reimbursement_invoices WHERE pos_transaction_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  v_tid        := NEW.tid;
  v_partner_id := NEW.partner_id;
  v_amount_inr := COALESCE(NEW.amount, 0);
  v_mode       := UPPER(COALESCE(NEW.payment_mode, '*'));
  v_card_type  := UPPER(COALESCE(NEW.card_type, '*'));
  v_card_brand := ca_normalize_card_brand(NEW.card_brand);
  v_today      := COALESCE((NEW.transaction_time)::DATE, CURRENT_DATE);

  SELECT pm.brand_id INTO v_brand_id
  FROM pos_machines pm WHERE pm.tid = v_tid AND pm.brand_id IS NOT NULL LIMIT 1;

  IF v_brand_id IS NULL THEN RETURN NEW; END IF;

  SELECT c.id, c.bank_mdr_percent
  INTO   v_config_id, v_mdr_pct
  FROM   ca_bank_mdr_config c
  WHERE  c.brand_id = v_brand_id
    AND  c.is_active = TRUE
    AND  c.effective_from <= v_today
    AND  (c.effective_to IS NULL OR c.effective_to >= v_today)
    AND  (c.tid = v_tid OR c.tid IS NULL)
    AND  (c.payment_mode = v_mode OR c.payment_mode = '*')
    AND  (c.card_type   = v_card_type  OR c.card_type   = '*')
    AND  (c.card_brand  = v_card_brand OR c.card_brand  = '*')
  ORDER BY
    CASE WHEN c.tid = v_tid THEN 0 ELSE 1 END,
    CASE WHEN c.payment_mode = v_mode THEN 0 WHEN c.payment_mode = '*' THEN 1 ELSE 2 END,
    CASE WHEN c.card_type   = v_card_type  THEN 0 WHEN c.card_type   = '*' THEN 1 ELSE 2 END,
    CASE WHEN c.card_brand  = v_card_brand THEN 0 WHEN c.card_brand  = '*' THEN 1 ELSE 2 END
  LIMIT 1;

  v_mdr_pct := COALESCE(v_mdr_pct, 0);
  v_mdr_amt := ROUND(v_amount_inr * v_mdr_pct / 100, 2);

  v_inv_num := ca_next_reimb_number(v_brand_id, v_today);

  INSERT INTO ca_reimbursement_invoices (
    invoice_number, pos_transaction_id,
    brand_id, partner_id, tid,
    transaction_amount, payment_mode, card_type, card_brand,
    bank_mdr_config_id, bank_mdr_percent, bank_mdr_amount,
    transaction_date, status
  ) VALUES (
    v_inv_num, NEW.id,
    v_brand_id, v_partner_id, v_tid,
    v_amount_inr, v_mode, v_card_type, v_card_brand,
    v_config_id, v_mdr_pct, v_mdr_amt,
    v_today, 'issued'
  );

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[ca_auto_reimbursement_invoice] tid=% txn=%: %', v_tid, NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;


-- ── 6. Trigger: razorpay_pos_transactions → reimbursement ───────────────────
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
  v_card_brand  TEXT;
  v_config_id   UUID := NULL;
  v_mdr_pct     NUMERIC(8, 4) := 0;
  v_mdr_amt     NUMERIC(15, 2) := 0;
  v_inv_num     TEXT;
  v_today       DATE;
BEGIN
  IF NEW.status NOT IN ('CAPTURED', 'AUTHORIZED', 'captured', 'authorized') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM ca_reimbursement_invoices WHERE razorpay_pos_transaction_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  v_tid        := NEW.tid;
  v_amount_inr := COALESCE(NEW.amount, 0);
  v_mode       := UPPER(COALESCE(NEW.payment_mode, '*'));
  v_card_type  := UPPER(COALESCE(NEW.card_type, '*'));
  v_card_brand := ca_normalize_card_brand(NEW.card_brand);
  v_today      := COALESCE((NEW.transaction_time)::DATE, CURRENT_DATE);

  IF NEW.merchant_slug IS NOT NULL AND NEW.merchant_slug <> '' THEN
    SELECT b.id INTO v_brand_id FROM brands b WHERE b.key = NEW.merchant_slug LIMIT 1;
  END IF;

  IF v_brand_id IS NULL AND v_tid IS NOT NULL THEN
    SELECT pm.brand_id INTO v_brand_id
    FROM pos_machines pm WHERE pm.tid = v_tid AND pm.brand_id IS NOT NULL LIMIT 1;
  END IF;

  IF v_brand_id IS NULL THEN RETURN NEW; END IF;

  SELECT c.id, c.bank_mdr_percent
  INTO   v_config_id, v_mdr_pct
  FROM   ca_bank_mdr_config c
  WHERE  c.brand_id = v_brand_id
    AND  c.is_active = TRUE
    AND  c.effective_from <= v_today
    AND  (c.effective_to IS NULL OR c.effective_to >= v_today)
    AND  (c.tid = v_tid OR c.tid IS NULL)
    AND  (c.payment_mode = v_mode OR c.payment_mode = '*')
    AND  (c.card_type   = v_card_type  OR c.card_type   = '*')
    AND  (c.card_brand  = v_card_brand OR c.card_brand  = '*')
  ORDER BY
    CASE WHEN c.tid = v_tid THEN 0 ELSE 1 END,
    CASE WHEN c.payment_mode = v_mode THEN 0 WHEN c.payment_mode = '*' THEN 1 ELSE 2 END,
    CASE WHEN c.card_type   = v_card_type  THEN 0 WHEN c.card_type   = '*' THEN 1 ELSE 2 END,
    CASE WHEN c.card_brand  = v_card_brand THEN 0 WHEN c.card_brand  = '*' THEN 1 ELSE 2 END
  LIMIT 1;

  v_mdr_pct := COALESCE(v_mdr_pct, 0);
  v_mdr_amt := ROUND(v_amount_inr * v_mdr_pct / 100, 2);

  v_inv_num := ca_next_reimb_number(v_brand_id, v_today);

  INSERT INTO ca_reimbursement_invoices (
    invoice_number, razorpay_pos_transaction_id, razorpay_txn_id,
    brand_id, partner_id, tid,
    transaction_amount, payment_mode, card_type, card_brand,
    bank_mdr_config_id, bank_mdr_percent, bank_mdr_amount,
    transaction_date, status
  ) VALUES (
    v_inv_num, NEW.id, NEW.txn_id,
    v_brand_id, NEW.partner_id, v_tid,
    v_amount_inr, v_mode, v_card_type, v_card_brand,
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


-- ── 7. Backfill: razorpay_pos_transactions ──────────────────────────────────
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
  v_card_brand  TEXT;
  v_config_id   UUID    := NULL;
  v_mdr_pct     NUMERIC(8, 4) := 0;
  v_mdr_amt     NUMERIC(15, 2) := 0;
  v_inv_num     TEXT;
  v_today       DATE;
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
    ORDER BY t.transaction_time
  LOOP
    BEGIN
      v_brand_id := NULL;
      v_config_id := NULL;
      v_mdr_pct := 0;

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

      IF p_brand_id IS NOT NULL AND v_brand_id <> p_brand_id THEN CONTINUE; END IF;

      v_amount_inr := COALESCE(r.amount, 0);
      v_mode       := UPPER(COALESCE(r.payment_mode, '*'));
      v_card_type  := UPPER(COALESCE(r.card_type, '*'));
      v_card_brand := ca_normalize_card_brand(r.card_brand);
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
        AND  (c.card_type   = v_card_type  OR c.card_type   = '*')
        AND  (c.card_brand  = v_card_brand OR c.card_brand  = '*')
      ORDER BY
        CASE WHEN c.tid = r.tid THEN 0 ELSE 1 END,
        CASE WHEN c.payment_mode = v_mode THEN 0 WHEN c.payment_mode = '*' THEN 1 ELSE 2 END,
        CASE WHEN c.card_type   = v_card_type  THEN 0 WHEN c.card_type   = '*' THEN 1 ELSE 2 END,
        CASE WHEN c.card_brand  = v_card_brand THEN 0 WHEN c.card_brand  = '*' THEN 1 ELSE 2 END
      LIMIT 1;

      v_mdr_pct := COALESCE(v_mdr_pct, 0);
      v_mdr_amt := ROUND(v_amount_inr * v_mdr_pct / 100, 2);

      v_inv_num := ca_next_reimb_number(v_brand_id, v_today);

      INSERT INTO ca_reimbursement_invoices (
        invoice_number, razorpay_pos_transaction_id, razorpay_txn_id,
        brand_id, partner_id, tid,
        transaction_amount, payment_mode, card_type, card_brand,
        bank_mdr_config_id, bank_mdr_percent, bank_mdr_amount,
        transaction_date, status
      ) VALUES (
        v_inv_num, r.id, r.txn_id,
        v_brand_id, r.partner_id, r.tid,
        v_amount_inr, v_mode, v_card_type, v_card_brand,
        v_config_id, v_mdr_pct, v_mdr_amt,
        v_today, 'issued'
      );

      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_skipped;
END;
$$;


-- ── 8. Link reimbursement rows → GST transaction invoice ────────────────────
--  Called by the API after it (re)generates a monthly GST invoice.
--  Returns the number of reimbursement rows linked.
CREATE OR REPLACE FUNCTION ca_link_reimbursements_to_txninv(
  p_txninv_id    UUID,
  p_brand_id     UUID,
  p_period_start DATE,
  p_period_end   DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  -- Clear any previous linkage that no longer belongs to this period
  UPDATE ca_reimbursement_invoices
     SET transaction_invoice_id = NULL
   WHERE transaction_invoice_id = p_txninv_id
     AND (brand_id <> p_brand_id
          OR transaction_date < p_period_start
          OR transaction_date > p_period_end);

  UPDATE ca_reimbursement_invoices
     SET transaction_invoice_id = p_txninv_id
   WHERE brand_id = p_brand_id
     AND transaction_date BETWEEN p_period_start AND p_period_end
     AND status = 'issued'
     AND (transaction_invoice_id IS NULL OR transaction_invoice_id = p_txninv_id);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
