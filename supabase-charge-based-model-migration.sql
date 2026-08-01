-- ============================================================================
-- CHARGE-BASED MODEL MIGRATION
-- ============================================================================
-- Converts the commission-split model to a hierarchical charge model:
--   Admin → MD (md_purchase_charge)
--   MD → DT (dt_purchase_charge)
--   DT → RT (rt_purchase_charge = retailer_charge)
--
-- Margin at each level = selling_charge - purchase_charge
-- Applies to ALL charge-based services: BBPS, Payout, AEPS Settlement,
-- Shadval Settlement, MDR (already % based).
--
-- Safe to re-run (idempotent via IF NOT EXISTS / DO blocks).
-- ============================================================================

-- ============================================================================
-- 1. ADD CHARGE-BASED COLUMNS TO scheme_bbps_commissions
-- ============================================================================
DO $$
BEGIN
  -- md_purchase_charge: what admin charges the MD
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scheme_bbps_commissions' AND column_name = 'md_purchase_charge'
  ) THEN
    ALTER TABLE scheme_bbps_commissions
      ADD COLUMN md_purchase_charge DECIMAL(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN md_purchase_charge_type TEXT NOT NULL DEFAULT 'flat' CHECK (md_purchase_charge_type IN ('flat', 'percentage')),
      ADD COLUMN dt_purchase_charge DECIMAL(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN dt_purchase_charge_type TEXT NOT NULL DEFAULT 'flat' CHECK (dt_purchase_charge_type IN ('flat', 'percentage')),
      ADD COLUMN rt_purchase_charge DECIMAL(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN rt_purchase_charge_type TEXT NOT NULL DEFAULT 'flat' CHECK (rt_purchase_charge_type IN ('flat', 'percentage'));
  END IF;
END $$;

-- ============================================================================
-- 2. ADD CHARGE-BASED COLUMNS TO scheme_payout_charges
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scheme_payout_charges' AND column_name = 'md_purchase_charge'
  ) THEN
    ALTER TABLE scheme_payout_charges
      ADD COLUMN md_purchase_charge DECIMAL(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN md_purchase_charge_type TEXT NOT NULL DEFAULT 'flat' CHECK (md_purchase_charge_type IN ('flat', 'percentage')),
      ADD COLUMN dt_purchase_charge DECIMAL(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN dt_purchase_charge_type TEXT NOT NULL DEFAULT 'flat' CHECK (dt_purchase_charge_type IN ('flat', 'percentage')),
      ADD COLUMN rt_purchase_charge DECIMAL(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN rt_purchase_charge_type TEXT NOT NULL DEFAULT 'flat' CHECK (rt_purchase_charge_type IN ('flat', 'percentage'));
  END IF;
END $$;

-- ============================================================================
-- 3. ADD CHARGE-BASED COLUMNS TO scheme_aeps_settlement_charges
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scheme_aeps_settlement_charges' AND column_name = 'md_purchase_charge'
  ) THEN
    ALTER TABLE scheme_aeps_settlement_charges
      ADD COLUMN md_purchase_charge DECIMAL(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN md_purchase_charge_type TEXT NOT NULL DEFAULT 'flat' CHECK (md_purchase_charge_type IN ('flat', 'percentage')),
      ADD COLUMN dt_purchase_charge DECIMAL(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN dt_purchase_charge_type TEXT NOT NULL DEFAULT 'flat' CHECK (dt_purchase_charge_type IN ('flat', 'percentage')),
      ADD COLUMN rt_purchase_charge DECIMAL(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN rt_purchase_charge_type TEXT NOT NULL DEFAULT 'flat' CHECK (rt_purchase_charge_type IN ('flat', 'percentage'));
  END IF;
END $$;

-- ============================================================================
-- 4. ADD CHARGE-BASED COLUMNS TO scheme_shadval_settlement_charges
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scheme_shadval_settlement_charges' AND column_name = 'md_purchase_charge'
  ) THEN
    ALTER TABLE scheme_shadval_settlement_charges
      ADD COLUMN md_purchase_charge DECIMAL(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN md_purchase_charge_type TEXT NOT NULL DEFAULT 'flat' CHECK (md_purchase_charge_type IN ('flat', 'percentage')),
      ADD COLUMN dt_purchase_charge DECIMAL(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN dt_purchase_charge_type TEXT NOT NULL DEFAULT 'flat' CHECK (dt_purchase_charge_type IN ('flat', 'percentage')),
      ADD COLUMN rt_purchase_charge DECIMAL(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN rt_purchase_charge_type TEXT NOT NULL DEFAULT 'flat' CHECK (rt_purchase_charge_type IN ('flat', 'percentage'));
  END IF;
END $$;

-- ============================================================================
-- 5. ADD CHARGE-BASED COLUMNS TO scheme_aeps_commissions (cascade model)
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scheme_aeps_commissions' AND column_name = 'md_purchase_charge'
  ) THEN
    ALTER TABLE scheme_aeps_commissions
      ADD COLUMN md_purchase_charge DECIMAL(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN md_purchase_charge_type TEXT NOT NULL DEFAULT 'flat' CHECK (md_purchase_charge_type IN ('flat', 'percentage')),
      ADD COLUMN dt_purchase_charge DECIMAL(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN dt_purchase_charge_type TEXT NOT NULL DEFAULT 'flat' CHECK (dt_purchase_charge_type IN ('flat', 'percentage')),
      ADD COLUMN rt_purchase_charge DECIMAL(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN rt_purchase_charge_type TEXT NOT NULL DEFAULT 'flat' CHECK (rt_purchase_charge_type IN ('flat', 'percentage'));
  END IF;
END $$;

-- ============================================================================
-- 6. ADD MD MDR PURCHASE RATES TO scheme_mdr_rates
-- ============================================================================
-- MDR already uses per-role % rates. Add md_purchase_mdr for the chain model.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scheme_mdr_rates' AND column_name = 'company_mdr_t1'
  ) THEN
    ALTER TABLE scheme_mdr_rates
      ADD COLUMN company_mdr_t1 NUMERIC(6, 4) NOT NULL DEFAULT 0 CHECK (company_mdr_t1 >= 0 AND company_mdr_t1 <= 100),
      ADD COLUMN company_mdr_t0 NUMERIC(6, 4) NOT NULL DEFAULT 0 CHECK (company_mdr_t0 >= 0 AND company_mdr_t0 <= 100);
  END IF;
END $$;

-- ============================================================================
-- 7. ADD MARGIN TRACKING TO TRANSACTION TABLES
-- ============================================================================

-- bbps_transactions: add margin columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bbps_transactions' AND column_name = 'md_margin_earned'
  ) THEN
    ALTER TABLE bbps_transactions
      ADD COLUMN md_margin_earned DECIMAL(12, 2) DEFAULT 0,
      ADD COLUMN dt_margin_earned DECIMAL(12, 2) DEFAULT 0,
      ADD COLUMN company_margin_earned DECIMAL(12, 2) DEFAULT 0;
  END IF;
END $$;

-- payout_transactions: add margin columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payout_transactions' AND column_name = 'md_margin_earned'
  ) THEN
    ALTER TABLE payout_transactions
      ADD COLUMN md_margin_earned DECIMAL(12, 2) DEFAULT 0,
      ADD COLUMN dt_margin_earned DECIMAL(12, 2) DEFAULT 0,
      ADD COLUMN company_margin_earned DECIMAL(12, 2) DEFAULT 0;
  END IF;
END $$;

-- shadval_settlement: add margin columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shadval_settlement' AND column_name = 'md_margin_earned'
  ) THEN
    ALTER TABLE shadval_settlement
      ADD COLUMN md_margin_earned DECIMAL(12, 2) DEFAULT 0,
      ADD COLUMN dt_margin_earned DECIMAL(12, 2) DEFAULT 0,
      ADD COLUMN company_margin_earned DECIMAL(12, 2) DEFAULT 0;
  END IF;
END $$;

-- ============================================================================
-- 8. UPDATED RPC: calculate_bbps_charge_from_scheme (charge-based model)
-- ============================================================================
-- Now returns per-level charges + computed margins

CREATE OR REPLACE FUNCTION calculate_bbps_charge_from_scheme(
  p_scheme_id UUID,
  p_amount DECIMAL(12, 2),
  p_category TEXT DEFAULT NULL
)
RETURNS TABLE (
  retailer_charge DECIMAL(12, 2),
  retailer_commission DECIMAL(12, 2),
  distributor_commission DECIMAL(12, 2),
  md_commission DECIMAL(12, 2),
  company_earning DECIMAL(12, 2),
  -- New charge-based fields
  md_purchase_charge_val DECIMAL(12, 2),
  dt_purchase_charge_val DECIMAL(12, 2),
  rt_purchase_charge_val DECIMAL(12, 2),
  md_margin DECIMAL(12, 2),
  dt_margin DECIMAL(12, 2),
  company_margin DECIMAL(12, 2)
) AS $$
DECLARE
  v_rec RECORD;
  v_md_charge DECIMAL(12, 2);
  v_dt_charge DECIMAL(12, 2);
  v_rt_charge DECIMAL(12, 2);
  v_company_cost DECIMAL(12, 2);
BEGIN
  SELECT * INTO v_rec
  FROM scheme_bbps_commissions sbc
  WHERE sbc.scheme_id = p_scheme_id
    AND sbc.status = 'active'
    AND sbc.min_amount <= p_amount
    AND sbc.max_amount >= p_amount
    AND (sbc.category IS NULL OR sbc.category = p_category)
  ORDER BY
    CASE WHEN sbc.category IS NOT NULL THEN 0 ELSE 1 END,
    sbc.min_amount DESC
  LIMIT 1;

  IF v_rec IS NULL THEN
    RETURN QUERY SELECT
      0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2),
      0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2),
      0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2),
      0::DECIMAL(12,2), 0::DECIMAL(12,2);
    RETURN;
  END IF;

  -- Calculate per-level purchase charges
  v_md_charge := CASE WHEN v_rec.md_purchase_charge_type = 'percentage'
    THEN ROUND(p_amount * v_rec.md_purchase_charge / 100, 2)
    ELSE v_rec.md_purchase_charge END;

  v_dt_charge := CASE WHEN v_rec.dt_purchase_charge_type = 'percentage'
    THEN ROUND(p_amount * v_rec.dt_purchase_charge / 100, 2)
    ELSE v_rec.dt_purchase_charge END;

  v_rt_charge := CASE WHEN v_rec.rt_purchase_charge_type = 'percentage'
    THEN ROUND(p_amount * v_rec.rt_purchase_charge / 100, 2)
    ELSE v_rec.rt_purchase_charge END;

  -- If new charge fields are populated (> 0), use charge-based model
  -- Otherwise fall back to legacy commission model for backward compatibility
  IF v_md_charge > 0 OR v_dt_charge > 0 OR v_rt_charge > 0 THEN
    -- Charge-based model: margin = selling_price - purchase_price
    v_company_cost := CASE WHEN v_rec.company_charge_type = 'percentage'
      THEN ROUND(p_amount * v_rec.company_charge / 100, 2)
      ELSE v_rec.company_charge END;

    RETURN QUERY SELECT
      v_rt_charge,                              -- retailer_charge (what RT pays)
      0::DECIMAL(12,2),                         -- retailer_commission (N/A in charge model)
      ROUND(v_rt_charge - v_dt_charge, 2),      -- distributor_commission = DT margin
      ROUND(v_dt_charge - v_md_charge, 2),      -- md_commission = MD margin
      ROUND(v_md_charge - v_company_cost, 2),   -- company_earning = company margin
      v_md_charge,
      v_dt_charge,
      v_rt_charge,
      ROUND(v_dt_charge - v_md_charge, 2),      -- md_margin
      ROUND(v_rt_charge - v_dt_charge, 2),      -- dt_margin
      ROUND(v_md_charge - v_company_cost, 2);   -- company_margin
  ELSE
    -- Legacy commission model (backward compatibility)
    RETURN QUERY SELECT
      CASE WHEN v_rec.retailer_charge_type = 'percentage'
        THEN ROUND(p_amount * v_rec.retailer_charge / 100, 2)
        ELSE v_rec.retailer_charge END,
      CASE WHEN v_rec.retailer_commission_type = 'percentage'
        THEN ROUND(p_amount * v_rec.retailer_commission / 100, 2)
        ELSE v_rec.retailer_commission END,
      CASE WHEN v_rec.distributor_commission_type = 'percentage'
        THEN ROUND(p_amount * v_rec.distributor_commission / 100, 2)
        ELSE v_rec.distributor_commission END,
      CASE WHEN v_rec.md_commission_type = 'percentage'
        THEN ROUND(p_amount * v_rec.md_commission / 100, 2)
        ELSE v_rec.md_commission END,
      CASE WHEN v_rec.company_charge_type = 'percentage'
        THEN ROUND(p_amount * v_rec.company_charge / 100, 2)
        ELSE v_rec.company_charge END,
      0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2),
      0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 9. UPDATED RPC: calculate_payout_charge_from_scheme (charge-based model)
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_payout_charge_from_scheme(
  p_scheme_id UUID,
  p_amount DECIMAL(12, 2),
  p_transfer_mode TEXT
)
RETURNS TABLE (
  retailer_charge DECIMAL(12, 2),
  retailer_commission DECIMAL(12, 2),
  distributor_commission DECIMAL(12, 2),
  md_commission DECIMAL(12, 2),
  company_earning DECIMAL(12, 2),
  md_purchase_charge_val DECIMAL(12, 2),
  dt_purchase_charge_val DECIMAL(12, 2),
  rt_purchase_charge_val DECIMAL(12, 2),
  md_margin DECIMAL(12, 2),
  dt_margin DECIMAL(12, 2),
  company_margin DECIMAL(12, 2)
) AS $$
DECLARE
  v_rec RECORD;
  v_md_charge DECIMAL(12, 2);
  v_dt_charge DECIMAL(12, 2);
  v_rt_charge DECIMAL(12, 2);
  v_company_cost DECIMAL(12, 2);
BEGIN
  SELECT * INTO v_rec
  FROM scheme_payout_charges spc
  WHERE spc.scheme_id = p_scheme_id
    AND spc.status = 'active'
    AND spc.transfer_mode = p_transfer_mode
    AND spc.min_amount <= p_amount
    AND spc.max_amount >= p_amount
  ORDER BY spc.min_amount DESC
  LIMIT 1;

  IF v_rec IS NULL THEN
    RETURN QUERY SELECT
      0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2),
      0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2),
      0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2),
      0::DECIMAL(12,2), 0::DECIMAL(12,2);
    RETURN;
  END IF;

  v_md_charge := CASE WHEN v_rec.md_purchase_charge_type = 'percentage'
    THEN ROUND(p_amount * v_rec.md_purchase_charge / 100, 2)
    ELSE v_rec.md_purchase_charge END;

  v_dt_charge := CASE WHEN v_rec.dt_purchase_charge_type = 'percentage'
    THEN ROUND(p_amount * v_rec.dt_purchase_charge / 100, 2)
    ELSE v_rec.dt_purchase_charge END;

  v_rt_charge := CASE WHEN v_rec.rt_purchase_charge_type = 'percentage'
    THEN ROUND(p_amount * v_rec.rt_purchase_charge / 100, 2)
    ELSE v_rec.rt_purchase_charge END;

  IF v_md_charge > 0 OR v_dt_charge > 0 OR v_rt_charge > 0 THEN
    v_company_cost := CASE WHEN v_rec.company_charge_type = 'percentage'
      THEN ROUND(p_amount * v_rec.company_charge / 100, 2)
      ELSE v_rec.company_charge END;

    RETURN QUERY SELECT
      v_rt_charge,
      0::DECIMAL(12,2),
      ROUND(v_rt_charge - v_dt_charge, 2),
      ROUND(v_dt_charge - v_md_charge, 2),
      ROUND(v_md_charge - v_company_cost, 2),
      v_md_charge, v_dt_charge, v_rt_charge,
      ROUND(v_dt_charge - v_md_charge, 2),
      ROUND(v_rt_charge - v_dt_charge, 2),
      ROUND(v_md_charge - v_company_cost, 2);
  ELSE
    RETURN QUERY SELECT
      CASE WHEN v_rec.retailer_charge_type = 'percentage'
        THEN ROUND(p_amount * v_rec.retailer_charge / 100, 2)
        ELSE v_rec.retailer_charge END,
      CASE WHEN v_rec.retailer_commission_type = 'percentage'
        THEN ROUND(p_amount * v_rec.retailer_commission / 100, 2)
        ELSE v_rec.retailer_commission END,
      CASE WHEN v_rec.distributor_commission_type = 'percentage'
        THEN ROUND(p_amount * v_rec.distributor_commission / 100, 2)
        ELSE v_rec.distributor_commission END,
      CASE WHEN v_rec.md_commission_type = 'percentage'
        THEN ROUND(p_amount * v_rec.md_commission / 100, 2)
        ELSE v_rec.md_commission END,
      CASE WHEN v_rec.company_charge_type = 'percentage'
        THEN ROUND(p_amount * v_rec.company_charge / 100, 2)
        ELSE v_rec.company_charge END,
      0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2),
      0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 10. NEW RPC: calculate_shadval_charge_from_scheme (charge-based model)
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_shadval_charge_from_scheme(
  p_scheme_id UUID,
  p_amount DECIMAL(12, 2),
  p_transfer_mode TEXT
)
RETURNS TABLE (
  retailer_charge DECIMAL(12, 2),
  distributor_commission DECIMAL(12, 2),
  md_commission DECIMAL(12, 2),
  company_earning DECIMAL(12, 2),
  md_purchase_charge_val DECIMAL(12, 2),
  dt_purchase_charge_val DECIMAL(12, 2),
  rt_purchase_charge_val DECIMAL(12, 2),
  md_margin DECIMAL(12, 2),
  dt_margin DECIMAL(12, 2),
  company_margin DECIMAL(12, 2)
) AS $$
DECLARE
  v_rec RECORD;
  v_md_charge DECIMAL(12, 2);
  v_dt_charge DECIMAL(12, 2);
  v_rt_charge DECIMAL(12, 2);
  v_company_cost DECIMAL(12, 2);
BEGIN
  SELECT * INTO v_rec
  FROM scheme_shadval_settlement_charges ssc
  WHERE ssc.scheme_id = p_scheme_id
    AND ssc.status = 'active'
    AND ssc.transfer_mode = p_transfer_mode
    AND ssc.min_amount <= p_amount
    AND ssc.max_amount >= p_amount
  ORDER BY ssc.min_amount DESC
  LIMIT 1;

  IF v_rec IS NULL THEN
    RETURN QUERY SELECT
      0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2),
      0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2),
      0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2),
      0::DECIMAL(12,2);
    RETURN;
  END IF;

  v_md_charge := CASE WHEN v_rec.md_purchase_charge_type = 'percentage'
    THEN ROUND(p_amount * v_rec.md_purchase_charge / 100, 2)
    ELSE v_rec.md_purchase_charge END;

  v_dt_charge := CASE WHEN v_rec.dt_purchase_charge_type = 'percentage'
    THEN ROUND(p_amount * v_rec.dt_purchase_charge / 100, 2)
    ELSE v_rec.dt_purchase_charge END;

  v_rt_charge := CASE WHEN v_rec.rt_purchase_charge_type = 'percentage'
    THEN ROUND(p_amount * v_rec.rt_purchase_charge / 100, 2)
    ELSE v_rec.rt_purchase_charge END;

  IF v_md_charge > 0 OR v_dt_charge > 0 OR v_rt_charge > 0 THEN
    v_company_cost := CASE WHEN v_rec.company_charge_type = 'percentage'
      THEN ROUND(p_amount * v_rec.company_charge / 100, 2)
      ELSE v_rec.company_charge END;

    RETURN QUERY SELECT
      v_rt_charge,
      ROUND(v_rt_charge - v_dt_charge, 2),
      ROUND(v_dt_charge - v_md_charge, 2),
      ROUND(v_md_charge - v_company_cost, 2),
      v_md_charge, v_dt_charge, v_rt_charge,
      ROUND(v_dt_charge - v_md_charge, 2),
      ROUND(v_rt_charge - v_dt_charge, 2),
      ROUND(v_md_charge - v_company_cost, 2);
  ELSE
    RETURN QUERY SELECT
      CASE WHEN v_rec.retailer_charge_type = 'percentage'
        THEN ROUND(p_amount * v_rec.retailer_charge / 100, 2)
        ELSE v_rec.retailer_charge END,
      CASE WHEN v_rec.distributor_commission_type = 'percentage'
        THEN ROUND(p_amount * v_rec.distributor_commission / 100, 2)
        ELSE v_rec.distributor_commission END,
      CASE WHEN v_rec.md_commission_type = 'percentage'
        THEN ROUND(p_amount * v_rec.md_commission / 100, 2)
        ELSE v_rec.md_commission END,
      CASE WHEN v_rec.company_charge_type = 'percentage'
        THEN ROUND(p_amount * v_rec.company_charge / 100, 2)
        ELSE v_rec.company_charge END,
      0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2),
      0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 11. NEW RPC: calculate_aeps_settlement_charge_from_scheme (charge-based)
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_aeps_settlement_charge_from_scheme(
  p_scheme_id UUID,
  p_amount DECIMAL(12, 2)
)
RETURNS TABLE (
  retailer_charge DECIMAL(12, 2),
  distributor_commission DECIMAL(12, 2),
  md_commission DECIMAL(12, 2),
  company_earning DECIMAL(12, 2),
  md_purchase_charge_val DECIMAL(12, 2),
  dt_purchase_charge_val DECIMAL(12, 2),
  rt_purchase_charge_val DECIMAL(12, 2),
  md_margin DECIMAL(12, 2),
  dt_margin DECIMAL(12, 2),
  company_margin DECIMAL(12, 2)
) AS $$
DECLARE
  v_rec RECORD;
  v_md_charge DECIMAL(12, 2);
  v_dt_charge DECIMAL(12, 2);
  v_rt_charge DECIMAL(12, 2);
  v_company_cost DECIMAL(12, 2);
BEGIN
  SELECT * INTO v_rec
  FROM scheme_aeps_settlement_charges sac
  WHERE sac.scheme_id = p_scheme_id
    AND sac.status = 'active'
    AND sac.min_amount <= p_amount
    AND sac.max_amount >= p_amount
  ORDER BY sac.min_amount DESC
  LIMIT 1;

  IF v_rec IS NULL THEN
    RETURN QUERY SELECT
      0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2),
      0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2),
      0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2),
      0::DECIMAL(12,2);
    RETURN;
  END IF;

  v_md_charge := CASE WHEN v_rec.md_purchase_charge_type = 'percentage'
    THEN ROUND(p_amount * v_rec.md_purchase_charge / 100, 2)
    ELSE v_rec.md_purchase_charge END;

  v_dt_charge := CASE WHEN v_rec.dt_purchase_charge_type = 'percentage'
    THEN ROUND(p_amount * v_rec.dt_purchase_charge / 100, 2)
    ELSE v_rec.dt_purchase_charge END;

  v_rt_charge := CASE WHEN v_rec.rt_purchase_charge_type = 'percentage'
    THEN ROUND(p_amount * v_rec.rt_purchase_charge / 100, 2)
    ELSE v_rec.rt_purchase_charge END;

  IF v_md_charge > 0 OR v_dt_charge > 0 OR v_rt_charge > 0 THEN
    v_company_cost := CASE WHEN v_rec.company_charge_type = 'percentage'
      THEN ROUND(p_amount * v_rec.company_charge / 100, 2)
      ELSE v_rec.company_charge END;

    RETURN QUERY SELECT
      v_rt_charge,
      ROUND(v_rt_charge - v_dt_charge, 2),
      ROUND(v_dt_charge - v_md_charge, 2),
      ROUND(v_md_charge - v_company_cost, 2),
      v_md_charge, v_dt_charge, v_rt_charge,
      ROUND(v_dt_charge - v_md_charge, 2),
      ROUND(v_rt_charge - v_dt_charge, 2),
      ROUND(v_md_charge - v_company_cost, 2);
  ELSE
    RETURN QUERY SELECT
      CASE WHEN v_rec.retailer_charge_type = 'percentage'
        THEN ROUND(p_amount * v_rec.retailer_charge / 100, 2)
        ELSE v_rec.retailer_charge END,
      CASE WHEN v_rec.distributor_commission_type = 'percentage'
        THEN ROUND(p_amount * v_rec.distributor_commission / 100, 2)
        ELSE v_rec.distributor_commission END,
      CASE WHEN v_rec.md_commission_type = 'percentage'
        THEN ROUND(p_amount * v_rec.md_commission / 100, 2)
        ELSE v_rec.md_commission END,
      CASE WHEN v_rec.company_charge_type = 'percentage'
        THEN ROUND(p_amount * v_rec.company_charge / 100, 2)
        ELSE v_rec.company_charge END,
      0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2),
      0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 12. COMMENTS
-- ============================================================================

COMMENT ON COLUMN scheme_bbps_commissions.md_purchase_charge IS 'What admin charges the MD per transaction (charge-based model)';
COMMENT ON COLUMN scheme_bbps_commissions.dt_purchase_charge IS 'What MD charges the DT per transaction (charge-based model)';
COMMENT ON COLUMN scheme_bbps_commissions.rt_purchase_charge IS 'What DT charges the RT per transaction (charge-based model)';

COMMENT ON COLUMN scheme_payout_charges.md_purchase_charge IS 'What admin charges the MD per transfer (charge-based model)';
COMMENT ON COLUMN scheme_payout_charges.dt_purchase_charge IS 'What MD charges the DT per transfer (charge-based model)';
COMMENT ON COLUMN scheme_payout_charges.rt_purchase_charge IS 'What DT charges the RT per transfer (charge-based model)';
