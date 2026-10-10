-- ============================================================================
-- Pay2New same-card cooldown — RACE-SAFE atomic claim.
--
-- WHY: the old 45s cooldown was a plain SELECT on pay2new_transactions followed
-- (much later, after the wallet debit) by the INSERT of the 'pending' row. Two
-- near-simultaneous taps both passed the SELECT before either row existed, so a
-- customer's card could be charged twice. Bumping the window to 60s does not fix
-- a check-then-act race.
--
-- WHAT: this function performs the window check AND the claim (the 'pending' row
-- insert) inside ONE transaction, serialized by a transaction-scoped advisory
-- lock keyed on (user, product, mobile, card). A second concurrent request for
-- the same card blocks on the lock, then sees the first request's 'pending' row
-- and is rejected. The advisory lock auto-releases at transaction end.
--
-- A recent attempt in status 'pending' or 'success' blocks. 'failed'/'refunded'
-- do NOT block — a genuinely-failed payment can be retried. (This is only safe
-- because the application no longer marks an AMBIGUOUS/timed-out payment as
-- 'failed': such a payment stays 'pending' — i.e. it DOES block a retry — until
-- the provider confirms it, which is exactly what prevents a double charge.)
--
-- Idempotent. Safe to re-run. Run in Supabase SQL Editor.
-- ============================================================================

CREATE OR REPLACE FUNCTION pay2new_cooldown_claim(
  p_user_id               TEXT,
  p_user_role             TEXT,
  p_product_code          TEXT,
  p_customer_number       TEXT,
  p_card_number           TEXT,
  p_request_id            TEXT,
  p_amount                NUMERIC,
  p_charge                NUMERIC DEFAULT 0,
  p_total_debit           NUMERIC DEFAULT 0,
  p_window_seconds        INT     DEFAULT 60,
  p_bill_fetch_ref        TEXT    DEFAULT NULL,
  p_product_name          TEXT    DEFAULT NULL,
  p_customer_name         TEXT    DEFAULT NULL,
  p_card_last4            TEXT    DEFAULT NULL,
  p_pan_number            TEXT    DEFAULT NULL,
  p_distributor_id        TEXT    DEFAULT NULL,
  p_master_distributor_id TEXT    DEFAULT NULL,
  p_scheme_id             UUID    DEFAULT NULL,
  p_scheme_name           TEXT    DEFAULT NULL,
  p_biller_id             TEXT    DEFAULT NULL
)
RETURNS TABLE(blocked BOOLEAN, seconds_remaining INT) AS $$
DECLARE
  v_recent TIMESTAMPTZ;
BEGIN
  -- Serialize all claims for this (user, product, mobile, card) tuple.
  PERFORM pg_advisory_xact_lock(
    hashtext(coalesce(p_user_id,'') || '|' || coalesce(p_product_code,'') || '|' ||
             coalesce(p_customer_number,'') || '|' || coalesce(p_card_number,''))
  );

  -- Is there a still-live attempt (pending or already successful) in the window?
  SELECT created_at INTO v_recent
  FROM pay2new_transactions
  WHERE user_id = p_user_id
    AND product_code = p_product_code
    AND customer_number IS NOT DISTINCT FROM p_customer_number
    AND card_number IS NOT DISTINCT FROM p_card_number
    AND status IN ('pending', 'success')
    AND created_at > now() - make_interval(secs => p_window_seconds)
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_recent IS NOT NULL THEN
    blocked := true;
    seconds_remaining := GREATEST(
      1,
      p_window_seconds - FLOOR(EXTRACT(EPOCH FROM (now() - v_recent)))::INT
    );
    RETURN NEXT;
    RETURN;
  END IF;

  -- Claim the slot: insert the authoritative 'pending' row. This row is what the
  -- next concurrent/rapid request will see and be blocked by.
  INSERT INTO pay2new_transactions (
    user_id, user_role, distributor_id, master_distributor_id,
    request_id, bill_fetch_ref, product_code, product_name, biller_id,
    card_number, card_last4, customer_number, customer_name, pan_number,
    amount, charge, total_debit, scheme_id, scheme_name, status
  ) VALUES (
    p_user_id, p_user_role, p_distributor_id, p_master_distributor_id,
    p_request_id, p_bill_fetch_ref, p_product_code, p_product_name, p_biller_id,
    p_card_number, p_card_last4, p_customer_number, p_customer_name, p_pan_number,
    p_amount, COALESCE(p_charge, 0), COALESCE(p_total_debit, 0), p_scheme_id, p_scheme_name, 'pending'
  );

  blocked := false;
  seconds_remaining := 0;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION pay2new_cooldown_claim(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, INT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT
) TO service_role;
