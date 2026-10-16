-- ============================================================================
-- CA Billing: allow reimbursements for TID-less transactions (Paytm soundbox/QR)
--
-- Paytm soundbox / dynamic-QR captures have no physical terminal, so tid is
-- NULL. The reimbursement table enforced tid NOT NULL, so those rows failed to
-- insert (silently skipped by the backfill/trigger EXCEPTION handlers) — e.g.
-- 25 LAGOON transactions this month.
--
-- Fix: make tid nullable. MDR resolution already falls back to brand-level
-- configs (c.tid IS NULL) when the transaction TID is NULL, so pricing is
-- unaffected. Monthly invoice numbering is keyed by brand+month (not TID), so
-- it is unaffected too.
--
-- Idempotent + safe to re-run.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ca_reimbursement_invoices'
      AND column_name = 'tid'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE ca_reimbursement_invoices ALTER COLUMN tid DROP NOT NULL;
  END IF;
END $$;
