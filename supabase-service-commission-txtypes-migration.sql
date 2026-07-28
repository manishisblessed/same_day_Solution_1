-- ============================================================================
-- Service commission transaction types
-- ============================================================================
-- The live wallet_ledger_transaction_type_check was missing COMMISSION and
-- COMMISSION_REVERSAL. As a result:
--   * Settlement-2 (shadval) DT/MD commission inserts (tx_type 'COMMISSION')
--     were silently failing (wrapped in try/catch) -> DT commission = 0 in prod.
--   * Every reversal path (reverseBBPSCommissions / reversePayoutCommissions /
--     reverseShadvalCommissions, and the new shared reverseServiceCommission)
--     uses 'COMMISSION_REVERSAL' -> silently failing.
--
-- This migration re-adds both to the constraint (keeping every value already
-- present, including DISTRIBUTOR_COMMISSION from the POS T+1 migration).
--
-- Run in Supabase SQL Editor.
-- ============================================================================

ALTER TABLE wallet_ledger DROP CONSTRAINT IF EXISTS wallet_ledger_transaction_type_check;
ALTER TABLE wallet_ledger ADD CONSTRAINT wallet_ledger_transaction_type_check
  CHECK (transaction_type IN (
    'ACCOUNT_VERIFICATION_CHARGE','ACCOUNT_VERIFICATION_REFUND','ADJUSTMENT','ADMIN_CREDIT',
    'AEPS_CREDIT','AEPS_DEBIT','AEPS_SETTLEMENT','BBPS_DEBIT','BBPS_REFUND','COMMISSION_CREDIT',
    'COMPANY_REVENUE','COMPANY_REVENUE_REVERSAL','CREDIT','DEBIT','PAY2NEW_DEBIT','PAY2NEW_REFUND',
    'PAYOUT','POS_CREDIT','POS_RENTAL_COMMISSION','REFUND','REVENUE_REVERSAL','SETTLEMENT2_REFUND',
    'SETTLEMENT2_TRANSFER','SUBSCRIPTION_DEBIT','SUBSCRIPTION_REVENUE','TDS_DEDUCTION','TRANSFER_OUT',
    'RECHARGEKIT_CC_DEBIT','RECHARGEKIT_CC_REFUND','REVENUE_CREDIT','DISTRIBUTOR_COMMISSION',
    -- re-added: service commission + reversal transaction types
    'COMMISSION','COMMISSION_REVERSAL'
  ));
