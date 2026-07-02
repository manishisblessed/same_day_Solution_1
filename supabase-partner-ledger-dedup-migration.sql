-- ============================================================================
-- PARTNER WALLET LEDGER: DUPLICATE CREDIT PREVENTION
-- ============================================================================
-- Same protection as idx_wallet_ledger_reference_id_user_unique on
-- wallet_ledger: a unique partial index so no code path can ever insert two
-- partner ledger entries with the same reference_id for the same partner.
-- The credit_partner_wallet RPC already rejects duplicates (check-then-act),
-- but only this index makes it race-proof under concurrent processes.
--
-- Run ONCE against Supabase/Postgres.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_wallet_ledger_reference_partner_unique
  ON partner_wallet_ledger (reference_id, partner_id)
  WHERE reference_id IS NOT NULL;
