-- ============================================================================
-- Allow AEPS commission and TDS transaction types in wallet_ledger.
-- Required for COMMISSION_CREDIT and TDS_DEDUCTION entries created by
-- services/aeps/settle-commission.ts and services/aeps/commission.ts.
--
-- Without this migration, add_ledger_entry fails silently with:
--   ERROR 23514: wallet_ledger_transaction_type_check constraint violated
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
    'AEPS_SETTLEMENT',
    'AEPS_SETTLE_MARGIN',
    'AEPS_SETTLE_CHARGE',
    'AEPS_TO_PRIMARY',
    'FUND_TRANSFER',
    'SETTLEMENT',
    'SETTLEMENT_CREDIT',
    'ADMIN_CREDIT',
    'ADMIN_DEBIT',
    'CREDIT',
    'DEBIT',
    'DEPOSIT',
    'WITHDRAWAL',
    'TRANSFER',
    'TRANSFER_IN',
    'TRANSFER_OUT',
    'FEE',
    'CHARGE',
    'REVERSAL',
    'MDR_SETTLEMENT',
    'WALLET_PUSH',
    'WALLET_PULL',
    'SUBSCRIPTION_DEBIT',
    'SUBSCRIPTION_REFUND',
    'SUBSCRIPTION_REVENUE',
    'POS_RENTAL_COMMISSION',
    'COMMISSION_CREDIT',
    'TDS_DEDUCTION',
    'COMPANY_REVENUE',
    'TRANSFER_REVERSAL'
  ));
