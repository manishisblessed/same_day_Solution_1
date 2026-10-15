-- ============================================================================
-- CA Billing — auto-void reimbursement invoices on transaction reversal
-- ============================================================================
-- When a POS transaction is later REFUNDED, VOIDED, or FAILED, its reimbursement
-- invoice must stop counting toward GST. We flip the invoice to status='void'
-- (monthly Transaction Invoice generation already aggregates only status='issued'
-- reimbursements, so voided ones drop out automatically).
--
-- Already-generated monthly invoices are frozen snapshots; re-generate a DRAFT
-- period to pick up newly-voided reimbursements. FILED periods should be
-- corrected via a credit note in a later return, per standard GST practice.
-- ============================================================================

CREATE OR REPLACE FUNCTION ca_void_reimbursement_on_reversal()
RETURNS TRIGGER AS $$
BEGIN
  -- Only act when status transitions INTO a reversal state
  IF NEW.status IN ('REFUNDED', 'VOIDED', 'FAILED')
     AND COALESCE(OLD.status, '') IS DISTINCT FROM NEW.status THEN
    UPDATE ca_reimbursement_invoices
    SET status = 'void',
        void_reason = 'Transaction ' || NEW.status
    WHERE pos_transaction_id = NEW.id
      AND status = 'issued';
  END IF;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[ca_void_reimbursement_on_reversal] txn=%: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_ca_void_reimbursement ON pos_transactions;
CREATE TRIGGER trg_ca_void_reimbursement
  AFTER UPDATE OF status ON pos_transactions
  FOR EACH ROW
  EXECUTE FUNCTION ca_void_reimbursement_on_reversal();
