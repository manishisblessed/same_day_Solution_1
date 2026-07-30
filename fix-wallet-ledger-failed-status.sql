-- Migration: Mark wallet_ledger DEBIT entries as 'failed' for transactions that were refunded.
-- This fixes the 296 existing entries where the debit status remained 'completed' 
-- even though a corresponding REFUND entry exists.

-- Rechargekit Credit Card refunds
UPDATE wallet_ledger 
SET status = 'failed', updated_at = NOW()
WHERE transaction_type = 'RECHARGEKIT_CC_DEBIT'
  AND status = 'completed'
  AND reference_id IN (
    SELECT REPLACE(reference_id, 'REFUND_', '')
    FROM wallet_ledger 
    WHERE transaction_type = 'RECHARGEKIT_CC_REFUND'
  );

-- Pay2New refunds (if any)
UPDATE wallet_ledger 
SET status = 'failed', updated_at = NOW()
WHERE transaction_type = 'PAY2NEW_DEBIT'
  AND status = 'completed'
  AND reference_id IN (
    SELECT REPLACE(reference_id, 'REFUND_', '')
    FROM wallet_ledger 
    WHERE transaction_type = 'PAY2NEW_REFUND'
  );
