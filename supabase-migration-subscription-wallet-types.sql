-- ============================================================================
-- Allow subscription-related transaction types in wallet_ledger.
-- Run if add_ledger_entry fails with transaction_type check violation for
-- SUBSCRIPTION_DEBIT, POS_RENTAL_COMMISSION, or SUBSCRIPTION_REVENUE.
-- ============================================================================

ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_transaction_type_check;

ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_transaction_type_check
  CHECK (transaction_type IN (
    'POS_CREDIT',
    'PAYOUT',
    'REFUND',
    'ADJUSTMENT',
    'COMMISSION',
    'BBPS_DEBIT',
    'BBPS_REFUND',
    'AEPS_CREDIT',
    'AEPS_DEBIT',
    'FUND_TRANSFER',
    'SETTLEMENT',
    'ADMIN_CREDIT',
    'ADMIN_DEBIT',
    'CREDIT',
    'DEBIT',
    'DEPOSIT',
    'WITHDRAWAL',
    'TRANSFER',
    'FEE',
    'CHARGE',
    'REVERSAL',
    'SUBSCRIPTION_DEBIT',
    'POS_RENTAL_COMMISSION',
    'SUBSCRIPTION_REVENUE'
  ));
