-- ============================================================================
-- AEPS Partner / Master-Partner Roles Migration
-- ============================================================================
-- Enables `partner` (and `master_partner`) to register an AEPS merchant,
-- perform AEPS transactions, and earn scheme-based commission — mirroring the
-- existing retailer flow.
--
-- Master partners reuse the entire partner stack, so the API normalizes
-- `master_partner` -> `partner` before any DB write (see lib/partner-access.ts).
-- In practice the stored role is `partner`, but we allow `master_partner` and
-- `sub_partner` here too for robustness / direct writes.
--
-- Idempotent + safe to re-run.
-- ============================================================================

-- Reusable role set: every business role that can own a wallet / transact.
-- retailer | distributor | master_distributor | partner | master_partner | sub_partner

-- 1. wallets.user_role -------------------------------------------------------
ALTER TABLE wallets
  DROP CONSTRAINT IF EXISTS wallets_user_role_check;
ALTER TABLE wallets
  ADD CONSTRAINT wallets_user_role_check
  CHECK (user_role IN (
    'retailer', 'distributor', 'master_distributor',
    'partner', 'master_partner', 'sub_partner'
  ));

-- 2. wallet_ledger.user_role -------------------------------------------------
ALTER TABLE wallet_ledger
  DROP CONSTRAINT IF EXISTS wallet_ledger_user_role_check;
ALTER TABLE wallet_ledger
  ADD CONSTRAINT wallet_ledger_user_role_check
  CHECK (user_role IN (
    'retailer', 'distributor', 'master_distributor',
    'partner', 'master_partner', 'sub_partner'
  ));

-- 3. aeps_transactions.user_role ---------------------------------------------
ALTER TABLE aeps_transactions
  DROP CONSTRAINT IF EXISTS aeps_transactions_user_role_check;
ALTER TABLE aeps_transactions
  ADD CONSTRAINT aeps_transactions_user_role_check
  CHECK (user_role IN (
    'retailer', 'distributor', 'master_distributor',
    'partner', 'master_partner', 'sub_partner'
  ));

-- 4. aeps_settlement_accounts.user_role --------------------------------------
ALTER TABLE aeps_settlement_accounts
  DROP CONSTRAINT IF EXISTS aeps_settlement_accounts_user_role_check;
ALTER TABLE aeps_settlement_accounts
  ADD CONSTRAINT aeps_settlement_accounts_user_role_check
  CHECK (user_role IN (
    'retailer', 'distributor', 'master_distributor',
    'partner', 'master_partner', 'sub_partner'
  ));

-- Note: aeps_settlements.user_role has no CHECK constraint (plain TEXT) so it
-- already accepts partner/master_partner — no change required there.
