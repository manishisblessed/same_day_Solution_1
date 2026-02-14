-- ============================================================================
-- PRODUCTION FIX: Create Database Functions for Scheme Resolution
-- ============================================================================
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- These functions are required for scheme-based charge calculation.
-- Without them, the system falls back to legacy/default charges.
-- ============================================================================

-- ============================================================================
-- 1. FUNCTION: Resolve scheme for a user + service
-- ============================================================================
-- Hierarchy: retailer mapping → distributor mapping → MD mapping → global scheme

CREATE OR REPLACE FUNCTION resolve_scheme_for_user(
  p_user_id TEXT,
  p_user_role TEXT,
  p_service_type TEXT DEFAULT 'all',
  p_distributor_id TEXT DEFAULT NULL,
  p_md_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  scheme_id UUID,
  scheme_name TEXT,
  scheme_type TEXT,
  resolved_via TEXT
) AS $$
BEGIN
  -- 1. Check direct retailer mapping
  RETURN QUERY
  SELECT sm.scheme_id, s.name, s.scheme_type, 'retailer_mapping'::TEXT
  FROM scheme_mappings sm
  JOIN schemes s ON s.id = sm.scheme_id
  WHERE sm.entity_id = p_user_id
    AND sm.entity_role = p_user_role
    AND sm.status = 'active'
    AND s.status = 'active'
    AND (sm.service_type IS NULL OR sm.service_type = p_service_type OR sm.service_type = 'all')
    AND sm.effective_from <= NOW()
    AND (sm.effective_to IS NULL OR sm.effective_to > NOW())
    AND s.effective_from <= NOW()
    AND (s.effective_to IS NULL OR s.effective_to > NOW())
  ORDER BY sm.priority ASC, sm.created_at DESC
  LIMIT 1;
  
  IF FOUND THEN RETURN; END IF;
  
  -- 2. Check distributor mapping (if distributor_id provided)
  IF p_distributor_id IS NOT NULL THEN
    RETURN QUERY
    SELECT sm.scheme_id, s.name, s.scheme_type, 'distributor_mapping'::TEXT
    FROM scheme_mappings sm
    JOIN schemes s ON s.id = sm.scheme_id
    WHERE sm.entity_id = p_distributor_id
      AND sm.entity_role = 'distributor'
      AND sm.status = 'active'
      AND s.status = 'active'
      AND (sm.service_type IS NULL OR sm.service_type = p_service_type OR sm.service_type = 'all')
      AND sm.effective_from <= NOW()
      AND (sm.effective_to IS NULL OR sm.effective_to > NOW())
    ORDER BY sm.priority ASC, sm.created_at DESC
    LIMIT 1;
    
    IF FOUND THEN RETURN; END IF;
  END IF;
  
  -- 3. Check master distributor mapping (if md_id provided)
  IF p_md_id IS NOT NULL THEN
    RETURN QUERY
    SELECT sm.scheme_id, s.name, s.scheme_type, 'md_mapping'::TEXT
    FROM scheme_mappings sm
    JOIN schemes s ON s.id = sm.scheme_id
    WHERE sm.entity_id = p_md_id
      AND sm.entity_role = 'master_distributor'
      AND sm.status = 'active'
      AND s.status = 'active'
      AND (sm.service_type IS NULL OR sm.service_type = p_service_type OR sm.service_type = 'all')
      AND sm.effective_from <= NOW()
      AND (sm.effective_to IS NULL OR sm.effective_to > NOW())
    ORDER BY sm.priority ASC, sm.created_at DESC
    LIMIT 1;
    
    IF FOUND THEN RETURN; END IF;
  END IF;
  
  -- 4. Fallback to global scheme
  RETURN QUERY
  SELECT s.id, s.name, s.scheme_type, 'global'::TEXT
  FROM schemes s
  WHERE s.scheme_type = 'global'
    AND s.status = 'active'
    AND (s.service_scope = p_service_type OR s.service_scope = 'all')
    AND s.effective_from <= NOW()
    AND (s.effective_to IS NULL OR s.effective_to > NOW())
  ORDER BY s.priority ASC, s.created_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 2. FUNCTION: Calculate BBPS charge from scheme
-- ============================================================================

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
  company_earning DECIMAL(12, 2)
) AS $$
DECLARE
  v_rec RECORD;
BEGIN
  -- Find matching slab
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
    RETURN QUERY SELECT 0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2);
    RETURN;
  END IF;
  
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
      ELSE v_rec.company_charge END;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 3. FUNCTION: Calculate Payout charge from scheme
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
  company_earning DECIMAL(12, 2)
) AS $$
DECLARE
  v_rec RECORD;
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
    RETURN QUERY SELECT 0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2);
    RETURN;
  END IF;
  
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
      ELSE v_rec.company_charge END;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 4. VERIFICATION: Check functions were created successfully
-- ============================================================================

-- This should return 3 rows (one for each function)
SELECT routine_name, routine_type
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_name IN (
  'resolve_scheme_for_user',
  'calculate_bbps_charge_from_scheme',
  'calculate_payout_charge_from_scheme'
);

-- ============================================================================
-- 5. QUICK TEST: Resolve scheme for the retailer
-- ============================================================================
-- Replace 'RET64519407' with an actual retailer partner_id
-- Replace distributor/MD IDs as needed

-- SELECT * FROM resolve_scheme_for_user('RET64519407', 'retailer', 'all', 'DIS64443281', NULL);

