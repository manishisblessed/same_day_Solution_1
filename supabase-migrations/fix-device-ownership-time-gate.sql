-- ============================================================================
-- PERMANENT FIX 1: Attribute POS transactions by device-ownership-AT-TXN-TIME
-- ============================================================================
-- Root cause of the "new retailer settled for someone else's / pre-ownership
-- transactions" bug (TID 43159306 -> Nishant): backfill_pos_retailer_ids()
-- stamped retailer_id purely on the CURRENT tid/serial match, with no check on
-- WHEN the transaction happened vs WHEN the current holder took the device.
-- Reassigning a machine therefore swept the previous merchant's entire
-- uncredited history onto the new retailer, who then auto-settled it.
--
-- Fix: only stamp retailer_id on transactions that occurred ON/AFTER the device
-- was last assigned to its current holder (pos_machines.last_assigned_at). When
-- last_assigned_at is unknown (legacy machines), fall back to the old behaviour
-- so we never regress legitimate stamping.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.backfill_pos_retailer_ids()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_count INTEGER;
BEGIN
  WITH upd AS (
    UPDATE razorpay_pos_transactions t
    SET retailer_id           = m.retailer_id,
        distributor_id        = COALESCE(t.distributor_id, m.distributor_id),
        master_distributor_id = COALESCE(t.master_distributor_id, m.master_distributor_id),
        gross_amount          = COALESCE(t.gross_amount, t.amount)
    FROM pos_machines m
    WHERE t.retailer_id IS NULL
      AND t.wallet_credited = false
      AND t.settlement_mode IS NULL
      AND m.retailer_id IS NOT NULL
      AND (
            (t.tid IS NOT NULL AND t.tid = m.tid)
         OR (t.device_serial IS NOT NULL AND t.device_serial = m.serial_number)
          )
      -- Ownership-time gate: never attribute a transaction that happened BEFORE
      -- the current holder was assigned this device. NULL last_assigned_at =
      -- unknown assignment time => keep legacy behaviour (do not block).
      AND (
            m.last_assigned_at IS NULL
         OR COALESCE(t.transaction_time, t.created_at) >= m.last_assigned_at
          )
    RETURNING t.id
  )
  SELECT COUNT(*) INTO v_count FROM upd;
  RETURN v_count;
END;
$function$;
