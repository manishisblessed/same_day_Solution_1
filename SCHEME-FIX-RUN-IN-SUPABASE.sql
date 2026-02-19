-- ============================================================================
-- SCHEME CHARGE FIX - Run in Supabase SQL Editor
-- ============================================================================
-- PROBLEM: BBPS charges and Payout charges from assigned schemes are NOT being
-- applied during payments. The charges fall back to legacy/default values.
--
-- ROOT CAUSE: The RPC functions (resolve_scheme_for_user, calculate_bbps_charge_from_scheme,
-- calculate_payout_charge_from_scheme) may be running as SECURITY INVOKER, which
-- means they're blocked by RLS when called without the service_role key.
--
-- FIX: 
--   1. Recreate all 3 functions as SECURITY DEFINER (bypasses RLS)
--   2. Improved category matching for BBPS (handles 'All Categories', 'all', NULL, empty)
--   3. Grant execute to all roles (anon, authenticated, service_role)
-- ============================================================================
-- RUN THIS IN: Supabase Dashboard → SQL Editor → New Query → Paste → Run
-- ============================================================================

-- ============================================================================
-- STEP 1: Drop existing functions to avoid signature conflicts
-- ============================================================================

DROP FUNCTION IF EXISTS resolve_scheme_for_user(TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS calculate_bbps_charge_from_scheme(UUID, DECIMAL, TEXT);
DROP FUNCTION IF EXISTS calculate_payout_charge_from_scheme(UUID, DECIMAL, TEXT);

-- ============================================================================
-- FUNCTION 1: resolve_scheme_for_user
-- SECURITY DEFINER - runs as postgres, bypasses all RLS
-- ============================================================================

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
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Step 1: Check direct retailer/user mapping
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
  
  -- Step 2: Check distributor-level mapping
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
  
  -- Step 3: Check master distributor-level mapping
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
  
  -- Step 4: Fallback to global scheme
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
$$;


-- ============================================================================
-- FUNCTION 2: calculate_bbps_charge_from_scheme
-- SECURITY DEFINER - runs as postgres, bypasses all RLS
-- IMPROVED: Category matching handles 'All Categories', 'all', NULL, empty string
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
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
BEGIN
  -- Find matching BBPS commission slab
  -- Category matching: NULL, empty string, 'All', 'All Categories' = applies to all categories
  SELECT * INTO v_rec
  FROM scheme_bbps_commissions sbc
  WHERE sbc.scheme_id = p_scheme_id
    AND sbc.status = 'active'
    AND sbc.min_amount <= p_amount
    AND sbc.max_amount >= p_amount
    AND (
      -- Wildcard category (applies to all)
      sbc.category IS NULL 
      OR sbc.category = '' 
      OR LOWER(TRIM(sbc.category)) = 'all'
      OR LOWER(TRIM(sbc.category)) = 'all categories'
      -- Exact match
      OR sbc.category = p_category
      -- No category filter provided = match any slab
      OR p_category IS NULL
    )
  ORDER BY 
    -- Prefer exact category match over wildcard
    CASE 
      WHEN sbc.category IS NOT NULL 
        AND sbc.category != '' 
        AND LOWER(TRIM(sbc.category)) != 'all' 
        AND LOWER(TRIM(sbc.category)) != 'all categories'
        AND sbc.category = p_category
      THEN 0  -- Exact match first
      ELSE 1  -- Wildcard/fallback second
    END,
    sbc.min_amount DESC
  LIMIT 1;
  
  IF NOT FOUND THEN
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
$$;


-- ============================================================================
-- FUNCTION 3: calculate_payout_charge_from_scheme
-- SECURITY DEFINER - runs as postgres, bypasses all RLS
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
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
BEGIN
  SELECT * INTO v_rec
  FROM scheme_payout_charges spc
  WHERE spc.scheme_id = p_scheme_id
    AND spc.status = 'active'
    AND UPPER(spc.transfer_mode) = UPPER(p_transfer_mode)
    AND spc.min_amount <= p_amount
    AND spc.max_amount >= p_amount
  ORDER BY spc.min_amount DESC
  LIMIT 1;
  
  IF NOT FOUND THEN
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
$$;


-- ============================================================================
-- STEP 2: Grant execute permissions to all roles
-- ============================================================================

GRANT EXECUTE ON FUNCTION resolve_scheme_for_user(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION calculate_bbps_charge_from_scheme(UUID, DECIMAL, TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION calculate_payout_charge_from_scheme(UUID, DECIMAL, TEXT) TO anon, authenticated, service_role;


-- ============================================================================
-- STEP 3: Verify functions are SECURITY DEFINER
-- ============================================================================

SELECT routine_name, routine_type, security_type
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_name IN (
  'resolve_scheme_for_user',
  'calculate_bbps_charge_from_scheme',
  'calculate_payout_charge_from_scheme'
);
-- Expected: 3 rows, ALL with security_type = 'DEFINER'


-- ============================================================================
-- STEP 4: Quick test for retailer RET64519407
-- ============================================================================

-- 4a. Test scheme resolution
SELECT * FROM resolve_scheme_for_user('RET64519407', 'retailer', 'bbps', NULL, NULL);
SELECT * FROM resolve_scheme_for_user('RET64519407', 'retailer', 'payout', NULL, NULL);

-- 4b. Check BBPS slabs (using scheme_id from above)
-- SELECT * FROM calculate_bbps_charge_from_scheme('<SCHEME_ID>', 16000, NULL);
-- SELECT * FROM calculate_payout_charge_from_scheme('<SCHEME_ID>', 1000, 'IMPS');

-- 4c. Direct slab check
SELECT sm.entity_id, s.name as scheme_name, sbc.*
FROM scheme_mappings sm
JOIN schemes s ON s.id = sm.scheme_id
JOIN scheme_bbps_commissions sbc ON sbc.scheme_id = s.id
WHERE sm.entity_id = 'RET64519407' 
  AND sm.status = 'active' 
  AND sbc.status = 'active'
ORDER BY sbc.min_amount;

SELECT sm.entity_id, s.name as scheme_name, spc.*
FROM scheme_mappings sm
JOIN schemes s ON s.id = sm.scheme_id
JOIN scheme_payout_charges spc ON spc.scheme_id = s.id
WHERE sm.entity_id = 'RET64519407' 
  AND sm.status = 'active' 
  AND spc.status = 'active'
ORDER BY spc.transfer_mode, spc.min_amount;

