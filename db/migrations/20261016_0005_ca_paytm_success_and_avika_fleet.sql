-- ============================================================================
-- CA Billing pipeline fix: Paytm success detection + Avika fleet split
--
-- Two production bugs caused "transactions not showing" / count mismatch on the
-- CA dashboard and Reimbursement list:
--
--   BUG 1 — LAGOON (and any Paytm company) produced ZERO reimbursements.
--     Paytm captures are stored with status = raw 'TXN_SUCCESS' (not 'CAPTURED'),
--     so the trigger's `status IN ('CAPTURED','AUTHORIZED')` gate skipped them.
--     The reliable cross-provider success flag is display_status = 'SUCCESS'
--     (Pinelab / Razorpay / Paytm all set it). We now gate on that.
--
--   BUG 2 — AVIKA - AXIS produced ZERO reimbursements (folded into AVIKA - HDFC).
--     Every Avika row carries merchant_slug='avika'; the HDFC/Axis fleet split is
--     derived from whether the TID is an Axis machine (pos_machines.brand ILIKE
--     '%AVIKA%AXIS%'). The old trigger resolved merchant_slug -> brands.key first,
--     so the whole fleet collapsed into the 'avika' (AVIKA - HDFC) brand.
--
-- Fixes:
--   1. ca_resolve_brand_razorpay() — fleet-aware brand resolver (shared).
--   2. Rewrite insert trigger -> gate on display_status='SUCCESS' (OR legacy
--      status), resolve brand via the helper, and fire on INSERT **and** UPDATE
--      (covers PENDING -> SUCCESS progressions that arrive as updates).
--   3. Rewrite void trigger -> gate on display_status reversal states.
--   4. Rewrite razorpay backfill -> same success gate + fleet-aware resolver.
--   5. One-time re-tag of existing AVIKA-AXIS reimbursements that were wrongly
--      stored under the AVIKA-HDFC brand.
--
-- Depends on 20261016_0004 (card_brand, ca_next_reimb_number, ca_normalize_card_brand).
-- Idempotent + safe to re-run.
--
-- After applying, backfill the current month to materialize LAGOON + any missed
-- rows (the UI "Backfill" button does the same):
--   SELECT * FROM ca_backfill_reimbursements_razorpay(date_trunc('month', now())::date, CURRENT_DATE);
-- ============================================================================


-- ── 1. Shared fleet-aware brand resolver ────────────────────────────────────
CREATE OR REPLACE FUNCTION ca_resolve_brand_razorpay(p_merchant_slug TEXT, p_tid TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_brand_id UUID;
  v_slug     TEXT;
BEGIN
  v_slug := LOWER(TRIM(COALESCE(p_merchant_slug, '')));

  -- Avika is one merchant_slug split into two brands by acquiring fleet.
  IF v_slug = 'avika' THEN
    IF p_tid IS NOT NULL AND EXISTS (
      SELECT 1 FROM pos_machines pm
      WHERE pm.tid = p_tid AND pm.brand ILIKE '%AVIKA%AXIS%'
    ) THEN
      SELECT id INTO v_brand_id FROM brands WHERE key = 'avika-axis' LIMIT 1;
    ELSE
      SELECT id INTO v_brand_id FROM brands WHERE key = 'avika' LIMIT 1;
    END IF;
    RETURN v_brand_id;
  END IF;

  -- Everyone else: direct merchant_slug -> brands.key.
  IF v_slug <> '' THEN
    SELECT id INTO v_brand_id FROM brands WHERE key = v_slug LIMIT 1;
  END IF;

  -- Fallback: resolve by the machine's own brand_id.
  IF v_brand_id IS NULL AND p_tid IS NOT NULL THEN
    SELECT pm.brand_id INTO v_brand_id
    FROM pos_machines pm
    WHERE pm.tid = p_tid AND pm.brand_id IS NOT NULL
    LIMIT 1;
  END IF;

  RETURN v_brand_id;
END;
$$;


-- ── 2. Insert/Update trigger: create reimbursement on SUCCESS ───────────────
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
  -- Cross-provider success gate. display_status='SUCCESS' is set by Pinelab,
  -- Razorpay and Paytm alike; legacy rows may only have status set.
  v_is_success := UPPER(COALESCE(NEW.display_status, '')) = 'SUCCESS'
                  OR NEW.status IN ('CAPTURED', 'AUTHORIZED', 'captured', 'authorized');
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

-- Fire on INSERT and on the UPDATE that flips a row to SUCCESS.
DROP TRIGGER IF EXISTS trg_ca_auto_reimb_razorpay ON razorpay_pos_transactions;
CREATE TRIGGER trg_ca_auto_reimb_razorpay
  AFTER INSERT OR UPDATE OF status, display_status ON razorpay_pos_transactions
  FOR EACH ROW
  EXECUTE FUNCTION ca_auto_reimbursement_from_razorpay();


-- ── 3. Void trigger: key off display_status reversal states ─────────────────
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
  v_now_reversed := UPPER(COALESCE(NEW.display_status, '')) IN ('REFUNDED', 'VOIDED', 'FAILED')
                    OR NEW.status IN ('REFUNDED', 'VOIDED', 'FAILED', 'refunded', 'voided', 'failed');
  v_was_reversed := UPPER(COALESCE(OLD.display_status, '')) IN ('REFUNDED', 'VOIDED', 'FAILED')
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
  AFTER UPDATE OF status, display_status ON razorpay_pos_transactions
  FOR EACH ROW
  EXECUTE FUNCTION ca_void_reimbursement_on_razorpay_reversal();


-- ── 4. Backfill: same success gate + fleet-aware resolver ───────────────────
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


-- ── 5. One-time re-tag: move existing AVIKA-AXIS reimbursements off AVIKA-HDFC
--  Rows generated before this fix were stored under the 'avika' (AVIKA - HDFC)
--  brand even when the TID belongs to the Axis fleet. Re-point them so both the
--  dashboard summary and the Reimbursement brand filter are correct.
DO $$
DECLARE
  v_avika_hdfc UUID;
  v_avika_axis UUID;
BEGIN
  SELECT id INTO v_avika_hdfc FROM brands WHERE key = 'avika'      LIMIT 1;
  SELECT id INTO v_avika_axis FROM brands WHERE key = 'avika-axis' LIMIT 1;

  IF v_avika_hdfc IS NOT NULL AND v_avika_axis IS NOT NULL THEN
    UPDATE ca_reimbursement_invoices ri
    SET brand_id = v_avika_axis
    WHERE ri.brand_id = v_avika_hdfc
      AND ri.tid IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM pos_machines pm
        WHERE pm.tid = ri.tid AND pm.brand ILIKE '%AVIKA%AXIS%'
      );
  END IF;
END $$;
