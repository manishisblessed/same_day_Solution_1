-- Drop the Pine Labs "force SUCCESS" guard trigger + backfill true statuses.
--
-- ROOT CAUSE of the "failed but shows captured" bug:
-- trigger trg_reject_pinelab_non_success (function reject_pinelab_non_success)
-- ran BEFORE INSERT OR UPDATE and did `RETURN NULL` (silently skipping the row)
-- for any txn_id LIKE 'PL_%' whose display_status <> 'SUCCESS'. Effect:
--   - failed Pine Labs transactions were NEVER stored, and
--   - reversals/voids could never flip an existing row off SUCCESS,
-- producing an impossible 100% success rate and hiding every real failure.
--
-- The reconciliation job + settlement guards now handle non-SUCCESS Pine Labs
-- rows correctly, so this guard must go.

DROP TRIGGER IF EXISTS trg_reject_pinelab_non_success ON razorpay_pos_transactions;
DROP FUNCTION IF EXISTS reject_pinelab_non_success();

-- Backfill display_status for rows already reconciled as failed/reversed
-- (reversed_at was stamped while the guard still pinned display_status=SUCCESS).
UPDATE razorpay_pos_transactions
SET display_status = CASE
    WHEN reversal_reason ILIKE '%REFUND%' THEN 'REFUNDED'
    WHEN reversal_reason ILIKE '%VOID%' OR reversal_reason ILIKE '%REVERS%' THEN 'VOIDED'
    ELSE 'FAILED'
  END
WHERE txn_id LIKE 'PL_%'
  AND reversed_at IS NOT NULL
  AND display_status = 'SUCCESS';
