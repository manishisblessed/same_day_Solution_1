-- ============================================================================
-- CA Billing: reprice existing reimbursements when MDR rates change
--
-- Reimbursement rows freeze bank_mdr_percent / bank_mdr_amount at capture time.
-- When a Bank MDR rate is added/edited/removed AFTER transactions were already
-- captured (the normal case — rates are configured once, mid-month), the
-- already-stored reimbursements must be re-priced so the dashboard, GST
-- transaction invoices and reimbursement exports reflect the configured rates.
--
-- ca_recompute_reimbursement_mdr(brand, from, to) re-resolves the best-match
-- active MDR config (same precedence as the live trigger: TID > mode > card_type
-- > card_brand, each exact-before-wildcard) for every issued reimbursement in
-- the window and updates the frozen values in place. Returns the row count that
-- actually changed.
--
-- Idempotent + safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION ca_recompute_reimbursement_mdr(
  p_brand_id  UUID,
  p_date_from DATE DEFAULT NULL,
  p_date_to   DATE DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r           RECORD;
  v_config_id UUID;
  v_mdr_pct   NUMERIC(8, 4);
  v_mdr_amt   NUMERIC(15, 2);
  v_tid       TEXT;
  v_mode      TEXT;
  v_ctype     TEXT;
  v_cbrand    TEXT;
  v_count     INTEGER := 0;
BEGIN
  IF p_brand_id IS NULL THEN RETURN 0; END IF;

  FOR r IN
    SELECT id, tid, transaction_amount, payment_mode, card_type, card_brand, transaction_date
    FROM ca_reimbursement_invoices
    WHERE brand_id = p_brand_id
      AND status = 'issued'
      AND (p_date_from IS NULL OR transaction_date >= p_date_from)
      AND (p_date_to   IS NULL OR transaction_date <= p_date_to)
  LOOP
    v_config_id := NULL;
    v_mdr_pct   := 0;
    v_tid       := r.tid;
    v_mode      := UPPER(COALESCE(r.payment_mode, '*'));
    v_ctype     := UPPER(COALESCE(r.card_type, '*'));
    v_cbrand    := ca_normalize_card_brand(r.card_brand);

    SELECT c.id, c.bank_mdr_percent
    INTO   v_config_id, v_mdr_pct
    FROM   ca_bank_mdr_config c
    WHERE  c.brand_id = p_brand_id
      AND  c.is_active = TRUE
      AND  c.effective_from <= r.transaction_date
      AND  (c.effective_to IS NULL OR c.effective_to >= r.transaction_date)
      AND  (c.tid = v_tid OR c.tid IS NULL)
      AND  (c.payment_mode = v_mode   OR c.payment_mode = '*')
      AND  (c.card_type    = v_ctype  OR c.card_type    = '*')
      AND  (c.card_brand   = v_cbrand OR c.card_brand   = '*')
    ORDER BY
      CASE WHEN c.tid = v_tid THEN 0 ELSE 1 END,
      CASE WHEN c.payment_mode = v_mode   THEN 0 WHEN c.payment_mode = '*' THEN 1 ELSE 2 END,
      CASE WHEN c.card_type    = v_ctype  THEN 0 WHEN c.card_type    = '*' THEN 1 ELSE 2 END,
      CASE WHEN c.card_brand   = v_cbrand THEN 0 WHEN c.card_brand   = '*' THEN 1 ELSE 2 END
    LIMIT 1;

    v_mdr_pct := COALESCE(v_mdr_pct, 0);
    v_mdr_amt := ROUND(COALESCE(r.transaction_amount, 0) * v_mdr_pct / 100, 2);

    UPDATE ca_reimbursement_invoices
    SET bank_mdr_config_id = v_config_id,
        bank_mdr_percent   = v_mdr_pct,
        bank_mdr_amount    = v_mdr_amt
    WHERE id = r.id
      AND (bank_mdr_percent   IS DISTINCT FROM v_mdr_pct
        OR bank_mdr_amount    IS DISTINCT FROM v_mdr_amt
        OR bank_mdr_config_id IS DISTINCT FROM v_config_id);

    IF FOUND THEN v_count := v_count + 1; END IF;
  END LOOP;

  RETURN v_count;
END;
$$;
