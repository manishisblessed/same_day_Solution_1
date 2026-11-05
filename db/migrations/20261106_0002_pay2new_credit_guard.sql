-- ============================================================
-- Pay2New (BBPS-2) — out-of-band credit guard
-- ============================================================
--
-- WHY: The 5-Nov-2026 stranding happened because money can be returned to a
-- partner wallet through a path that does NOT write a recognized refund key, so
-- the payment's status silently stays PENDING while the money is gone. The
-- authoritative-state projection (20261106_0001) heals convention-based refunds,
-- but a credit written with an ARBITRARY reference_id leaves no marker to project
-- from. This guard closes that last hole at the database level: a Pay2New wallet
-- credit MUST use a recognized refund/reconciliation key, so status can never
-- again diverge from money.
--
-- SAFETY (verified against production before shipping):
--   * Scoped strictly to service_type='pay2new' AND credit>0. Every other service
--     (payout, aeps, settlement, wallet top-ups) and every DEBIT is untouched.
--   * 100% of historical Pay2New credits (10,258 rows since 2026-06-30) use
--     reference_id LIKE 'REFUND\_%' (refund_partner_wallet) or 'RECON\_%' (scheme
--     reconciliation). The allowlist below blocks nothing that has ever legitimately
--     occurred -- it only blocks NEW, unlabeled / arbitrary credits.
--   * partner_wallet_ledger had NO pre-existing triggers, so nothing conflicts.
--
-- ESCAPE HATCH: there is intentionally none other than "use the correct key". A
-- genuine Pay2New refund MUST go through refund_partner_wallet with
-- reference_id = 'REFUND_<request_id>' -- which is exactly what makes bill/status
-- reflect it automatically. Partner float TOP-UPS are not service_type='pay2new'
-- and are therefore unaffected.

CREATE OR REPLACE FUNCTION p2n_guard_out_of_band_credit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(NEW.service_type, '') = 'pay2new' AND COALESCE(NEW.credit, 0) > 0 THEN
    IF NEW.reference_id IS NULL
       OR NOT (
            NEW.reference_id LIKE 'REFUND\_%' ESCAPE '\'
            OR NEW.reference_id LIKE 'RECON\_%' ESCAPE '\'
          )
    THEN
      RAISE EXCEPTION
        'Pay2New credit blocked: reference_id "%" is not a recognized refund key. A Pay2New wallet refund MUST use refund_partner_wallet with reference_id = ''REFUND_<request_id>'' so bill/status reflects it (out-of-band credit guard).', COALESCE(NEW.reference_id, '<null>')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- BEFORE INSERT so a disallowed credit is rejected before any money moves. The
-- WHEN clause keeps the function off the hot path for every non-Pay2New write.
DROP TRIGGER IF EXISTS p2n_guard_out_of_band_credit_trg ON partner_wallet_ledger;
CREATE TRIGGER p2n_guard_out_of_band_credit_trg
  BEFORE INSERT ON partner_wallet_ledger
  FOR EACH ROW
  WHEN (NEW.service_type = 'pay2new' AND NEW.credit > 0)
  EXECUTE FUNCTION p2n_guard_out_of_band_credit();
