-- ============================================================================
-- CA Billing: single source of truth + success-only reimbursements
--
-- PROBLEM (dashboard count > admin success count):
--   1. DOUBLE COUNTING — the legacy trigger trg_ca_auto_reimbursement on
--      pos_transactions created a SECOND reimbursement for transactions that
--      already flow through razorpay_pos_transactions (the unified POS table the
--      admin POS view uses). Confirmed: every pos_transactions reimbursement had
--      an exact razorpay duplicate (same brand+tid+amount+date), still carrying
--      the old REIMB-… numbering.
--   2. REVERSED rows — admin counts only display_status='SUCCESS' AND
--      reversed_at IS NULL. The CA gate didn't exclude reversed transactions.
--
-- FIX:
--   A. Drop the pos_transactions reimbursement trigger (razorpay is the single
--      source of truth) and no-op its backfill so the API call stays valid.
--   B. Delete existing duplicate pos_transactions reimbursements (only those
--      that have a matching razorpay reimbursement — safe, confirmed dupes).
--   C. Tighten the razorpay insert gate + backfill to require reversed_at IS NULL
--      (success-only, matching the admin definition).
--   D. Void trigger also fires when reversed_at is set.
--
-- Depends on 0004/0005/0006 (ca_resolve_brand_razorpay, ca_normalize_card_brand,
-- ca_next_reimb_number, nullable tid).
-- Idempotent + safe to re-run.
-- ============================================================================


-- ── A. Disable the legacy pos_transactions trigger ──────────────────────────
DROP TRIGGER IF EXISTS trg_ca_auto_reimbursement ON pos_transactions;

-- No-op the pos backfill so /api/ca/reimbursement/backfill keeps working but
-- never re-creates pos_transactions duplicates.
CREATE OR REPLACE FUNCTION ca_backfill_reimbursements(
  p_date_from DATE,
  p_date_to   DATE,
  p_brand_id  UUID DEFAULT NULL
)
RETURNS TABLE (processed INTEGER, skipped INTEGER)
LANGUAGE plpgsql
AS $$
BEGIN
  -- Deprecated: razorpay_pos_transactions is the single source of truth.
  RETURN QUERY SELECT 0, 0;
END;
$$;


-- ── B. Remove confirmed duplicate pos_transactions reimbursements ───────────
DELETE FROM ca_reimbursement_invoices ri
WHERE ri.pos_transaction_id IS NOT NULL
  AND ri.razorpay_pos_transaction_id IS NULL
  AND EXISTS (
    SELECT 1 FROM ca_reimbursement_invoices r2
    WHERE r2.razorpay_pos_transaction_id IS NOT NULL
      AND r2.brand_id          IS NOT DISTINCT FROM ri.brand_id
      AND r2.tid               IS NOT DISTINCT FROM ri.tid
      AND r2.transaction_amount = ri.transaction_amount
      AND r2.transaction_date   = ri.transaction_date
  );


-- ── C+D. Razorpay insert trigger: success-only (exclude reversed) ───────────
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
  v_is_success  BOOLEAN;
BEGIN
  -- Success-only: cross-provider SUCCESS flag AND not reversed (matches admin).
  v_is_success := (UPPER(COALESCE(NEW.display_status, '')) = 'SUCCESS'
                   OR NEW.status IN ('CAPTURED', 'AUTHORIZED', 'captured', 'authorized'))
                  AND NEW.reversed_at IS NULL;
  IF NOT v_is_success THEN
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

  v_brand_id := ca_resolve_brand_razorpay(NEW.merchant_slug, v_tid);
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
  RAISE WARNING '[ca_auto_reimbursement_from_razorpay] tid=% txn=%: %', NEW.tid, NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ca_auto_reimb_razorpay ON razorpay_pos_transactions;
CREATE TRIGGER trg_ca_auto_reimb_razorpay
  AFTER INSERT OR UPDATE OF status, display_status, reversed_at ON razorpay_pos_transactions
  FOR EACH ROW
  EXECUTE FUNCTION ca_auto_reimbursement_from_razorpay();


-- Void trigger: void when reversed (reversed_at set) or status flips to a
-- refunded/voided/failed state.
CREATE OR REPLACE FUNCTION ca_void_reimbursement_on_razorpay_reversal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now_reversed BOOLEAN;
  v_was_reversed BOOLEAN;
BEGIN
  v_now_reversed := NEW.reversed_at IS NOT NULL
                    OR UPPER(COALESCE(NEW.display_status, '')) IN ('REFUNDED', 'VOIDED', 'FAILED')
                    OR NEW.status IN ('REFUNDED', 'VOIDED', 'FAILED', 'refunded', 'voided', 'failed');
  v_was_reversed := OLD.reversed_at IS NOT NULL
                    OR UPPER(COALESCE(OLD.display_status, '')) IN ('REFUNDED', 'VOIDED', 'FAILED')
                    OR OLD.status IN ('REFUNDED', 'VOIDED', 'FAILED', 'refunded', 'voided', 'failed');

  IF v_now_reversed AND NOT v_was_reversed THEN
    UPDATE ca_reimbursement_invoices
    SET status = 'void',
        void_reason = 'Transaction ' || COALESCE(NULLIF(NEW.display_status, ''), NEW.status),
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
  AFTER UPDATE OF status, display_status, reversed_at ON razorpay_pos_transactions
  FOR EACH ROW
  EXECUTE FUNCTION ca_void_reimbursement_on_razorpay_reversal();


-- Backfill: success-only (exclude reversed) + fleet-aware resolver.
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
    WHERE (UPPER(COALESCE(t.display_status, '')) = 'SUCCESS'
           OR t.status IN ('CAPTURED', 'AUTHORIZED', 'captured', 'authorized'))
      AND t.reversed_at IS NULL
      AND t.created_at >= p_date_from::timestamptz
      AND t.created_at < (p_date_to::timestamptz + interval '1 day')
      AND NOT EXISTS (
        SELECT 1 FROM ca_reimbursement_invoices ri WHERE ri.razorpay_pos_transaction_id = t.id
      )
    ORDER BY t.transaction_time
  LOOP
    BEGIN
      v_brand_id := ca_resolve_brand_razorpay(r.merchant_slug, r.tid);
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
      )
      ON CONFLICT (razorpay_pos_transaction_id) WHERE razorpay_pos_transaction_id IS NOT NULL DO NOTHING;

      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_skipped;
END;
$$;
