-- ============================================================================
-- Expand wallet_ledger.transaction_type CHECK constraint
-- ============================================================================
-- The application writes several transaction_type values via add_ledger_entry
-- that were missing from wallet_ledger_transaction_type_check, causing the
-- INSERT inside the function to throw and surface as "Failed to debit wallet"
-- (HTTP 500) on the affected services:
--   - PAY2NEW_DEBIT / PAY2NEW_REFUND        (Credit Card / recharge via Pay2New)
--   - SETTLEMENT2_REFUND                    (Settlement-2 refund path)
--   - COMPANY_REVENUE_REVERSAL              (Settlement-2 reversal)
--   - COMMISSION_REVERSAL                   (Settlement-2 reversal)
--   - AEPS_SETTLE_MARGIN                    (AEPS settlement margin)
--   - TRANSFER_REVERSAL                     (Wallet transfer reversal)
--   - SETTLEMENT_CREDIT                     (MDR scheme settlement)
--
-- This migration is additive: it only widens the allowed set, so all existing
-- rows continue to satisfy the constraint.
-- ============================================================================

ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_transaction_type_check;

ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_transaction_type_check
  CHECK (transaction_type IN (
    -- pre-existing allowed values
    'POS_CREDIT', 'PAYOUT', 'REFUND', 'ADJUSTMENT', 'COMMISSION', 'COMMISSION_CREDIT',
    'BBPS_DEBIT', 'BBPS_REFUND', 'AEPS_CREDIT', 'AEPS_DEBIT', 'AEPS_SETTLEMENT',
    'FUND_TRANSFER', 'SETTLEMENT', 'ADMIN_CREDIT', 'ADMIN_DEBIT', 'CREDIT', 'DEBIT',
    'DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'TRANSFER_IN', 'TRANSFER_OUT', 'FEE', 'CHARGE',
    'REVERSAL', 'SUBSCRIPTION_DEBIT', 'POS_RENTAL_COMMISSION', 'SUBSCRIPTION_REVENUE',
    'TDS_DEDUCTION', 'ACCOUNT_VERIFICATION_CHARGE', 'ACCOUNT_VERIFICATION_REFUND',
    'COMPANY_REVENUE', 'REVENUE_REVERSAL', 'SETTLEMENT2_TRANSFER', 'SETTLEMENT2_CHARGE',
    -- newly added (used by app code but previously rejected by the constraint)
    'PAY2NEW_DEBIT', 'PAY2NEW_REFUND', 'SETTLEMENT2_REFUND', 'COMPANY_REVENUE_REVERSAL',
    'COMMISSION_REVERSAL', 'AEPS_SETTLE_MARGIN', 'TRANSFER_REVERSAL', 'SETTLEMENT_CREDIT'
  ));
