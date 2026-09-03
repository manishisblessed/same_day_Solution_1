-- ============================================================================
-- BACKFILL contact_email ON SHADVAL SETTLEMENT ACCOUNTS
-- ============================================================================
-- The downstream payout provider (Shadval Pay) rejects transfers whose
-- contact_details.email is blank. Historically contact_email was optional at
-- account registration, so older shadval_settlement_accounts rows can have a
-- NULL/blank email and fail on transfer.
--
-- The transfer endpoint now falls back to the partner's registered email at
-- runtime, and registration now enforces a valid contact_email. This migration
-- cleans up the existing rows so stored data is consistent: any account with a
-- missing email inherits the owning partner's email.
--
-- Safe/idempotent: only touches rows where contact_email is NULL or blank, and
-- only when the partner actually has a non-blank email on file.
-- ============================================================================

UPDATE shadval_settlement_accounts AS a
SET contact_email = p.email
FROM partners AS p
WHERE p.id::text = a.retailer_id
  AND (a.contact_email IS NULL OR btrim(a.contact_email) = '')
  AND p.email IS NOT NULL
  AND btrim(p.email) <> '';
