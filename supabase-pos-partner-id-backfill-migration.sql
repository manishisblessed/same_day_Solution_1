-- ============================================================================
-- Partner T+1: partner_id self-healing (mirror of backfill_pos_retailer_ids)
-- ============================================================================
-- Some ingestion paths insert POS transactions with partner_id = NULL (the
-- webhook only resolves the partner asynchronously and can miss it). The
-- partner T+1 cron fetches strictly by `partner_id = <partner>`, so any such
-- row is invisible to auto-settlement forever.
--
-- This function stamps partner_id on captured POS transactions whose owning
-- device is registered to a PARTNER in pos_machines (by tid or serial_number)
-- but where partner_id was never written. The partner T+1 cron calls this
-- first, so those transactions become visible and settle on the next run.
--
-- Guards:
--  * Only partner-DIRECT devices (m.retailer_id IS NULL) — retailer-owned
--    devices are self-healed by backfill_pos_retailer_ids() instead, so the two
--    can never both claim the same row.
--  * Ownership-time gate: never stamp the current partner onto a transaction
--    that occurred BEFORE the device was assigned to them (a reassigned machine
--    must not attribute the previous holder's history to the new partner).
--  * Never touches already-settled rows (wallet_credited / partner_wallet_credited
--    / settlement_mode), so it can never re-open or double-pay a settled txn.
--
-- Idempotent — safe to run repeatedly (only NULL partner_id rows are affected).
-- Run in Supabase SQL Editor or via scripts/run-migration.mjs.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.backfill_pos_partner_ids()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_count INTEGER;
BEGIN
  WITH upd AS (
    UPDATE razorpay_pos_transactions t
    SET partner_id   = m.partner_id,
        gross_amount = COALESCE(t.gross_amount, t.amount)
    FROM pos_machines m
    WHERE t.partner_id IS NULL
      AND t.wallet_credited = false
      AND t.partner_wallet_credited = false
      AND t.settlement_mode IS NULL
      AND m.partner_id IS NOT NULL
      AND m.retailer_id IS NULL           -- partner-direct devices only
      AND (
            (t.tid IS NOT NULL AND t.tid = m.tid)
         OR (t.device_serial IS NOT NULL AND t.device_serial = m.serial_number)
          )
      -- Ownership-time gate (defense against reassigned devices).
      AND (m.last_assigned_at IS NULL OR t.transaction_time >= m.last_assigned_at)
    RETURNING t.id
  )
  SELECT COUNT(*) INTO v_count FROM upd;
  RETURN v_count;
END;
$function$;

COMMENT ON FUNCTION public.backfill_pos_partner_ids() IS
  'Self-heals partner_id on POS transactions from pos_machines (partner-direct devices), so the partner T+1 cron can settle rows the webhook left unattached. Ownership-time gated; never touches settled rows.';
