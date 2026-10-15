-- ============================================================================
-- CA Billing System — Production fixes for 20261014_0001
-- ============================================================================
-- Critical corrections discovered in production review:
--
--  1. pos_machines has NO `terminal_id` column — the TID column is `tid`.
--     The original trigger joined on pm.terminal_id (non-existent) so it ALWAYS
--     raised, was swallowed by the EXCEPTION handler, and created ZERO invoices.
--
--  2. pos_transactions.id is BIGINT (BIGSERIAL), not UUID. The
--     ca_reimbursement_invoices.pos_transaction_id column was UUID, so even
--     after fixing (1) the INSERT would fail the type cast.
--
--  3. pos_transactions has no guaranteed `posting_date`; `txn_time` (NOT NULL)
--     is the canonical timestamp.
--
--  4. Invoice-number generation was race-prone under concurrent inserts
--     (two txns, same brand+day → same seq → unique violation → silent skip
--     via ON CONFLICT). Now serialized with a per-brand/day advisory xact lock.
--
--  5. Adds a set-based backfill function (ca_backfill_reimbursements) so the
--     API can reliably generate invoices for historical transactions.
-- ============================================================================

-- ── 1. Fix pos_transaction_id type (table is empty — safe to recreate col) ───
DROP INDEX IF EXISTS idx_ca_reimb_pos_txn;
ALTER TABLE ca_reimbursement_invoices DROP COLUMN IF EXISTS pos_transaction_id;
ALTER TABLE ca_reimbursement_invoices ADD COLUMN pos_transaction_id BIGINT;
CREATE INDEX idx_ca_reimb_pos_txn
  ON ca_reimbursement_invoices (pos_transaction_id)
  WHERE pos_transaction_id IS NOT NULL;

-- Idempotency: one reimbursement invoice per source transaction.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ca_reimb_pos_txn
  ON ca_reimbursement_invoices (pos_transaction_id)
  WHERE pos_transaction_id IS NOT NULL;

-- ── 2. Replace the auto-reimbursement trigger function (corrected) ───────────
CREATE OR REPLACE FUNCTION ca_auto_reimbursement_invoice()
RETURNS TRIGGER AS $$
DECLARE
  v_brand_id    UUID;
  v_tid         TEXT;
  v_amount_inr  NUMERIC(15, 2);
  v_mode        TEXT;
  v_card_type   TEXT;
  v_config      RECORD;
  v_mdr_pct     NUMERIC(8, 4);
  v_mdr_amt     NUMERIC(15, 2);
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
  v_amount_inr := ROUND(NEW.amount / 100.0, 2);          -- paise → rupees
  v_mode       := COALESCE(NEW.payment_mode, '*');
  v_card_type  := COALESCE(NEW.card_type, '*');
  v_today      := COALESCE(NEW.txn_time::DATE, CURRENT_DATE);

  -- Resolve brand from the POS machine registry (pos_machines.tid)
  SELECT pm.brand_id INTO v_brand_id
  FROM pos_machines pm
  WHERE pm.tid = v_tid
    AND pm.brand_id IS NOT NULL
  LIMIT 1;

  -- No brand linked → nothing to bill against; skip
  IF v_brand_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Best-match bank MDR config (TID-specific > brand-wide; exact > wildcard)
  SELECT * INTO v_config
  FROM ca_bank_mdr_config
  WHERE brand_id = v_brand_id
    AND is_active = TRUE
    AND effective_from <= v_today
    AND (effective_to IS NULL OR effective_to >= v_today)
    AND (tid = v_tid OR tid IS NULL)
    AND (payment_mode = v_mode OR payment_mode = '*')
    AND (card_type = v_card_type OR card_type = '*')
  ORDER BY
    CASE WHEN tid = v_tid THEN 0 ELSE 1 END,
    CASE WHEN payment_mode = v_mode THEN 0 WHEN payment_mode = '*' THEN 1 ELSE 2 END,
    CASE WHEN card_type = v_card_type THEN 0 WHEN card_type = '*' THEN 1 ELSE 2 END
  LIMIT 1;

  v_mdr_pct := COALESCE(v_config.bank_mdr_percent, 0);
  v_mdr_amt := ROUND(v_amount_inr * v_mdr_pct / 100, 2);

  SELECT COALESCE(short_name, UPPER(key), 'XX') INTO v_brand_short
  FROM brands WHERE id = v_brand_id;

  -- Serialize invoice-number assignment per brand+day to prevent races
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
    v_config.id, v_mdr_pct, v_mdr_amt,
    v_today, 'issued'
  )
  ON CONFLICT (pos_transaction_id) WHERE pos_transaction_id IS NOT NULL DO NOTHING;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[ca_auto_reimbursement_invoice] tid=% txn=%: %', v_tid, NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger already exists from the prior migration; CREATE OR REPLACE above is enough.

-- ── 3. Set-based backfill for historical transactions ───────────────────────
-- Generates reimbursement invoices for CAPTURED/AUTHORIZED transactions in a
-- date range that don't yet have one and whose TID resolves to a brand.
CREATE OR REPLACE FUNCTION ca_backfill_reimbursements(
  p_date_from DATE,
  p_date_to   DATE,
  p_brand_id  UUID DEFAULT NULL
)
RETURNS TABLE (processed INTEGER, skipped INTEGER) AS $$
DECLARE
  r             RECORD;
  v_brand_id    UUID;
  v_amount_inr  NUMERIC(15, 2);
  v_mode        TEXT;
  v_card_type   TEXT;
  v_config      RECORD;
  v_mdr_pct     NUMERIC(8, 4);
  v_mdr_amt     NUMERIC(15, 2);
  v_inv_num     TEXT;
  v_today       DATE;
  v_seq         INTEGER;
  v_brand_short TEXT;
  v_processed   INTEGER := 0;
  v_skipped     INTEGER := 0;
BEGIN
  FOR r IN
    SELECT t.id, t.terminal_id, t.amount, t.payment_mode, t.card_type,
           t.card_brand, t.razorpay_txn_id, t.partner_id, t.txn_time,
           pm.brand_id AS brand_id
    FROM pos_transactions t
    JOIN pos_machines pm ON pm.tid = t.terminal_id AND pm.brand_id IS NOT NULL
    WHERE t.status IN ('CAPTURED', 'AUTHORIZED')
      AND t.txn_time >= p_date_from::timestamptz
      AND t.txn_time < (p_date_to::timestamptz + interval '1 day')
      AND (p_brand_id IS NULL OR pm.brand_id = p_brand_id)
      AND NOT EXISTS (
        SELECT 1 FROM ca_reimbursement_invoices ri WHERE ri.pos_transaction_id = t.id
      )
  LOOP
    BEGIN
      v_brand_id   := r.brand_id;
      v_amount_inr := ROUND(r.amount / 100.0, 2);
      v_mode       := COALESCE(r.payment_mode, '*');
      v_card_type  := COALESCE(r.card_type, '*');
      v_today      := COALESCE(r.txn_time::DATE, CURRENT_DATE);

      SELECT * INTO v_config
      FROM ca_bank_mdr_config
      WHERE brand_id = v_brand_id
        AND is_active = TRUE
        AND effective_from <= v_today
        AND (effective_to IS NULL OR effective_to >= v_today)
        AND (tid = r.terminal_id OR tid IS NULL)
        AND (payment_mode = v_mode OR payment_mode = '*')
        AND (card_type = v_card_type OR card_type = '*')
      ORDER BY
        CASE WHEN tid = r.terminal_id THEN 0 ELSE 1 END,
        CASE WHEN payment_mode = v_mode THEN 0 WHEN payment_mode = '*' THEN 1 ELSE 2 END,
        CASE WHEN card_type = v_card_type THEN 0 WHEN card_type = '*' THEN 1 ELSE 2 END
      LIMIT 1;

      v_mdr_pct := COALESCE(v_config.bank_mdr_percent, 0);
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
        v_inv_num, r.id, r.razorpay_txn_id,
        v_brand_id, r.partner_id, r.terminal_id,
        v_amount_inr, v_mode, v_card_type, r.card_brand,
        v_config.id, v_mdr_pct, v_mdr_amt,
        v_today, 'issued'
      )
      ON CONFLICT (pos_transaction_id) WHERE pos_transaction_id IS NOT NULL DO NOTHING;

      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      RAISE WARNING '[ca_backfill] txn=% skipped: %', r.id, SQLERRM;
    END;
  END LOOP;

  processed := v_processed;
  skipped   := v_skipped;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
