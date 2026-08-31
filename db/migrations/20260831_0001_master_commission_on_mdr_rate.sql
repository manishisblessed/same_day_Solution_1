-- ============================================================================
-- MASTER PARTNER COMMISSION MOVES ONTO THE PARTNER PLAN MDR RATE
-- ============================================================================
-- The Master Channel Partner POS override is no longer a separate scheme. It is
-- now configured directly on the child partner's Partner Plan MDR rate
-- (scheme_mdr_rates), so admins manage it in Scheme Management alongside the
-- partner's MDR. Two new fields per MDR rate:
--   * master_commission_percent      -> % of each POS txn credited to the master
--   * master_commission_tds_percent  -> TDS withheld from that commission (def 2%)
--
-- The commission is still POS-only, still capped at the company's MDR margin on
-- the transaction, and credited net-of-TDS into the master partner wallet.
-- ============================================================================

-- 1. Master commission fields on the Partner Plan MDR rate -------------------
ALTER TABLE scheme_mdr_rates
  ADD COLUMN IF NOT EXISTS master_commission_percent NUMERIC(6, 4);

ALTER TABLE scheme_mdr_rates
  ADD COLUMN IF NOT EXISTS master_commission_tds_percent NUMERIC(6, 4) DEFAULT 2;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_smr_master_comm_range') THEN
    ALTER TABLE scheme_mdr_rates
      ADD CONSTRAINT chk_smr_master_comm_range
      CHECK (master_commission_percent IS NULL OR (master_commission_percent >= 0 AND master_commission_percent <= 100));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_smr_master_tds_range') THEN
    ALTER TABLE scheme_mdr_rates
      ADD CONSTRAINT chk_smr_master_tds_range
      CHECK (master_commission_tds_percent IS NULL OR (master_commission_tds_percent >= 0 AND master_commission_tds_percent <= 100));
  END IF;
END $$;

COMMENT ON COLUMN scheme_mdr_rates.master_commission_percent IS
  'Master Channel Partner POS override: %% of the txn amount credited to the child partner''s master. NULL = no master override. Partner Plan only.';
COMMENT ON COLUMN scheme_mdr_rates.master_commission_tds_percent IS
  'TDS %% withheld from the master partner commission before crediting (0-100). Default 2%%.';

-- 2. Per-transaction TDS tracking on POS transactions -----------------------
-- master_partner_commission_amount stores the NET amount credited (after TDS);
-- master_partner_commission_tds stores the TDS withheld.
ALTER TABLE razorpay_pos_transactions
  ADD COLUMN IF NOT EXISTS master_partner_commission_tds NUMERIC(12, 2);

COMMENT ON COLUMN razorpay_pos_transactions.master_partner_commission_tds IS
  'TDS withheld from the master partner override for this transaction. master_partner_commission_amount stores the NET credited (after TDS).';

-- 3. Assignment no longer requires a scheme ---------------------------------
-- Child partners are linked to a master via master_partner_id + this assignment;
-- the commission now comes from the MDR rate, so scheme_id becomes optional.
ALTER TABLE master_partner_partner_assignments
  ALTER COLUMN scheme_id DROP NOT NULL;
