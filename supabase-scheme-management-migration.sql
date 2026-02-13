-- ============================================================================
-- COMPREHENSIVE SCHEME MANAGEMENT SYSTEM MIGRATION
-- ============================================================================
-- Covers: BBPS Commissions, Payout Charges, MDR Rates, Scheme Mappings
-- Hierarchy: Admin → Master Distributor → Distributor → Retailer
-- Every transaction is linked to a scheme_id
-- ============================================================================

-- ============================================================================
-- 1. MASTER SCHEMES TABLE
-- ============================================================================
-- Central scheme definitions (Global, Golden, Custom)
-- ============================================================================

CREATE TABLE IF NOT EXISTS schemes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  
  -- Scheme classification
  scheme_type TEXT NOT NULL CHECK (scheme_type IN ('global', 'golden', 'custom')),
  -- global = system-wide default, golden = premium preset, custom = user-created
  
  -- Which services this scheme covers
  service_scope TEXT NOT NULL DEFAULT 'all' CHECK (service_scope IN ('all', 'bbps', 'payout', 'mdr', 'settlement')),
  
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'draft')),
  
  -- Who created it
  created_by_id TEXT,
  created_by_role TEXT CHECK (created_by_role IN ('admin', 'master_distributor', 'distributor')),
  
  -- Validity period
  effective_from TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMP WITH TIME ZONE, -- NULL = no expiry
  
  -- Metadata
  priority INT NOT NULL DEFAULT 100, -- Lower = higher priority (global=1000, golden=500, custom=100)
  metadata JSONB,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schemes_type ON schemes(scheme_type);
CREATE INDEX IF NOT EXISTS idx_schemes_status ON schemes(status);
CREATE INDEX IF NOT EXISTS idx_schemes_service_scope ON schemes(service_scope);
CREATE INDEX IF NOT EXISTS idx_schemes_created_by ON schemes(created_by_id);
CREATE INDEX IF NOT EXISTS idx_schemes_priority ON schemes(priority);

-- ============================================================================
-- 2. BBPS COMMISSION CONFIGURATION
-- ============================================================================
-- Service-wise BBPS charges/commissions per scheme, with amount slabs
-- ============================================================================

CREATE TABLE IF NOT EXISTS scheme_bbps_commissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scheme_id UUID NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
  
  -- BBPS category (NULL = applies to all categories)
  category TEXT, -- 'Electricity', 'Gas', 'Credit Card', 'Water', 'Insurance', etc. NULL = all
  
  -- Amount slab
  min_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  max_amount DECIMAL(12, 2) NOT NULL DEFAULT 999999999,
  
  -- Charges to retailer (what retailer pays per transaction)
  retailer_charge DECIMAL(12, 2) NOT NULL DEFAULT 0,
  retailer_charge_type TEXT NOT NULL DEFAULT 'flat' CHECK (retailer_charge_type IN ('flat', 'percentage')),
  
  -- Commission splits (earned by each level)
  retailer_commission DECIMAL(12, 2) NOT NULL DEFAULT 0,
  retailer_commission_type TEXT NOT NULL DEFAULT 'flat' CHECK (retailer_commission_type IN ('flat', 'percentage')),
  
  distributor_commission DECIMAL(12, 2) NOT NULL DEFAULT 0,
  distributor_commission_type TEXT NOT NULL DEFAULT 'flat' CHECK (distributor_commission_type IN ('flat', 'percentage')),
  
  md_commission DECIMAL(12, 2) NOT NULL DEFAULT 0,
  md_commission_type TEXT NOT NULL DEFAULT 'flat' CHECK (md_commission_type IN ('flat', 'percentage')),
  
  -- Company earning from this slab
  company_charge DECIMAL(12, 2) NOT NULL DEFAULT 0,
  company_charge_type TEXT NOT NULL DEFAULT 'flat' CHECK (company_charge_type IN ('flat', 'percentage')),
  
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheme_bbps_scheme_id ON scheme_bbps_commissions(scheme_id);
CREATE INDEX IF NOT EXISTS idx_scheme_bbps_category ON scheme_bbps_commissions(category);
CREATE INDEX IF NOT EXISTS idx_scheme_bbps_status ON scheme_bbps_commissions(status);
CREATE INDEX IF NOT EXISTS idx_scheme_bbps_slab ON scheme_bbps_commissions(min_amount, max_amount);

-- ============================================================================
-- 3. PAYOUT CHARGES CONFIGURATION
-- ============================================================================
-- Service-wise payout charges per scheme, by transfer mode
-- ============================================================================

CREATE TABLE IF NOT EXISTS scheme_payout_charges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scheme_id UUID NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
  
  -- Transfer mode
  transfer_mode TEXT NOT NULL CHECK (transfer_mode IN ('IMPS', 'NEFT', 'RTGS')),
  
  -- Amount slab
  min_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  max_amount DECIMAL(12, 2) NOT NULL DEFAULT 999999999,
  
  -- Charge to retailer (what retailer pays per transfer)
  retailer_charge DECIMAL(12, 2) NOT NULL DEFAULT 0,
  retailer_charge_type TEXT NOT NULL DEFAULT 'flat' CHECK (retailer_charge_type IN ('flat', 'percentage')),
  
  -- Commission splits
  retailer_commission DECIMAL(12, 2) NOT NULL DEFAULT 0,
  retailer_commission_type TEXT NOT NULL DEFAULT 'flat' CHECK (retailer_commission_type IN ('flat', 'percentage')),
  
  distributor_commission DECIMAL(12, 2) NOT NULL DEFAULT 0,
  distributor_commission_type TEXT NOT NULL DEFAULT 'flat' CHECK (distributor_commission_type IN ('flat', 'percentage')),
  
  md_commission DECIMAL(12, 2) NOT NULL DEFAULT 0,
  md_commission_type TEXT NOT NULL DEFAULT 'flat' CHECK (md_commission_type IN ('flat', 'percentage')),
  
  company_charge DECIMAL(12, 2) NOT NULL DEFAULT 0,
  company_charge_type TEXT NOT NULL DEFAULT 'flat' CHECK (company_charge_type IN ('flat', 'percentage')),
  
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheme_payout_scheme_id ON scheme_payout_charges(scheme_id);
CREATE INDEX IF NOT EXISTS idx_scheme_payout_mode ON scheme_payout_charges(transfer_mode);
CREATE INDEX IF NOT EXISTS idx_scheme_payout_status ON scheme_payout_charges(status);

-- ============================================================================
-- 4. MDR RATES CONFIGURATION
-- ============================================================================
-- Per-scheme MDR rates for Razorpay/POS settlement
-- ============================================================================

CREATE TABLE IF NOT EXISTS scheme_mdr_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scheme_id UUID NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
  
  -- Payment mode
  mode TEXT NOT NULL CHECK (mode IN ('CARD', 'UPI')),
  card_type TEXT CHECK (card_type IN ('CREDIT', 'DEBIT', 'PREPAID')),
  brand_type TEXT, -- VISA, MasterCard, RuPay, etc.
  
  -- Retailer MDR rates (T+1 and T+0)
  retailer_mdr_t1 NUMERIC(6, 4) NOT NULL DEFAULT 0 CHECK (retailer_mdr_t1 >= 0 AND retailer_mdr_t1 <= 100),
  retailer_mdr_t0 NUMERIC(6, 4) NOT NULL DEFAULT 0 CHECK (retailer_mdr_t0 >= 0 AND retailer_mdr_t0 <= 100),
  
  -- Distributor MDR rates
  distributor_mdr_t1 NUMERIC(6, 4) NOT NULL DEFAULT 0 CHECK (distributor_mdr_t1 >= 0 AND distributor_mdr_t1 <= 100),
  distributor_mdr_t0 NUMERIC(6, 4) NOT NULL DEFAULT 0 CHECK (distributor_mdr_t0 >= 0 AND distributor_mdr_t0 <= 100),
  
  -- Master Distributor MDR rates
  md_mdr_t1 NUMERIC(6, 4) NOT NULL DEFAULT 0 CHECK (md_mdr_t1 >= 0 AND md_mdr_t1 <= 100),
  md_mdr_t0 NUMERIC(6, 4) NOT NULL DEFAULT 0 CHECK (md_mdr_t0 >= 0 AND md_mdr_t0 <= 100),
  
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheme_mdr_scheme_id ON scheme_mdr_rates(scheme_id);
CREATE INDEX IF NOT EXISTS idx_scheme_mdr_mode ON scheme_mdr_rates(mode);
CREATE INDEX IF NOT EXISTS idx_scheme_mdr_status ON scheme_mdr_rates(status);

-- ============================================================================
-- 5. SCHEME MAPPINGS (Scheme ↔ User Hierarchy)
-- ============================================================================
-- Maps schemes to retailers/distributors/master_distributors
-- Resolution order: retailer mapping → distributor mapping → MD mapping → global
-- ============================================================================

CREATE TABLE IF NOT EXISTS scheme_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scheme_id UUID NOT NULL REFERENCES schemes(id) ON DELETE CASCADE,
  
  -- Who this scheme is assigned to
  entity_id TEXT NOT NULL, -- partner_id of retailer/distributor/MD
  entity_role TEXT NOT NULL CHECK (entity_role IN ('retailer', 'distributor', 'master_distributor')),
  
  -- Who assigned it
  assigned_by_id TEXT,
  assigned_by_role TEXT CHECK (assigned_by_role IN ('admin', 'master_distributor', 'distributor')),
  
  -- Service scope override (NULL = inherit from scheme)
  service_type TEXT CHECK (service_type IN ('all', 'bbps', 'payout', 'mdr', 'settlement')),
  
  -- Priority for conflict resolution (lower = higher priority)
  priority INT NOT NULL DEFAULT 100,
  
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  effective_from TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  effective_to TIMESTAMP WITH TIME ZONE, -- NULL = no expiry
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheme_mappings_scheme_id ON scheme_mappings(scheme_id);
CREATE INDEX IF NOT EXISTS idx_scheme_mappings_entity ON scheme_mappings(entity_id, entity_role);
CREATE INDEX IF NOT EXISTS idx_scheme_mappings_status ON scheme_mappings(status);
CREATE INDEX IF NOT EXISTS idx_scheme_mappings_priority ON scheme_mappings(priority);

-- Ensure one active mapping per entity per service type
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_scheme_mapping
ON scheme_mappings(entity_id, entity_role, COALESCE(service_type, 'all'))
WHERE status = 'active';

-- ============================================================================
-- 6. ALTER EXISTING TABLES - Add scheme_id
-- ============================================================================

-- Add scheme_id to bbps_transactions (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bbps_transactions' AND column_name = 'scheme_id'
  ) THEN
    ALTER TABLE bbps_transactions ADD COLUMN scheme_id UUID;
    ALTER TABLE bbps_transactions ADD COLUMN scheme_name TEXT;
    CREATE INDEX IF NOT EXISTS idx_bbps_tx_scheme_id ON bbps_transactions(scheme_id);
  END IF;
END $$;

-- Add scheme_id to payout_transactions (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payout_transactions' AND column_name = 'scheme_id'
  ) THEN
    ALTER TABLE payout_transactions ADD COLUMN scheme_id UUID;
    ALTER TABLE payout_transactions ADD COLUMN scheme_name TEXT;
    CREATE INDEX IF NOT EXISTS idx_payout_tx_scheme_id ON payout_transactions(scheme_id);
  END IF;
END $$;

-- Add scheme_id to razorpay_transactions (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'razorpay_transactions' AND column_name = 'scheme_id'
  ) THEN
    ALTER TABLE razorpay_transactions ADD COLUMN scheme_id UUID;
    ALTER TABLE razorpay_transactions ADD COLUMN scheme_name TEXT;
    CREATE INDEX IF NOT EXISTS idx_rp_tx_scheme_id ON razorpay_transactions(scheme_id);
  END IF;
END $$;

-- Add commission breakdown fields to bbps_transactions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bbps_transactions' AND column_name = 'retailer_charge'
  ) THEN
    ALTER TABLE bbps_transactions ADD COLUMN retailer_charge DECIMAL(12, 2) DEFAULT 0;
    ALTER TABLE bbps_transactions ADD COLUMN retailer_commission_earned DECIMAL(12, 2) DEFAULT 0;
    ALTER TABLE bbps_transactions ADD COLUMN distributor_commission_earned DECIMAL(12, 2) DEFAULT 0;
    ALTER TABLE bbps_transactions ADD COLUMN md_commission_earned DECIMAL(12, 2) DEFAULT 0;
    ALTER TABLE bbps_transactions ADD COLUMN company_earning DECIMAL(12, 2) DEFAULT 0;
  END IF;
END $$;

-- Add commission breakdown fields to payout_transactions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'payout_transactions' AND column_name = 'retailer_charge'
  ) THEN
    ALTER TABLE payout_transactions ADD COLUMN retailer_charge DECIMAL(12, 2) DEFAULT 0;
    ALTER TABLE payout_transactions ADD COLUMN retailer_commission_earned DECIMAL(12, 2) DEFAULT 0;
    ALTER TABLE payout_transactions ADD COLUMN distributor_commission_earned DECIMAL(12, 2) DEFAULT 0;
    ALTER TABLE payout_transactions ADD COLUMN md_commission_earned DECIMAL(12, 2) DEFAULT 0;
    ALTER TABLE payout_transactions ADD COLUMN company_earning DECIMAL(12, 2) DEFAULT 0;
  END IF;
END $$;

-- ============================================================================
-- 7. TRIGGERS for updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_schemes_updated_at ON schemes;
CREATE TRIGGER update_schemes_updated_at
  BEFORE UPDATE ON schemes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_scheme_bbps_commissions_updated_at ON scheme_bbps_commissions;
CREATE TRIGGER update_scheme_bbps_commissions_updated_at
  BEFORE UPDATE ON scheme_bbps_commissions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_scheme_payout_charges_updated_at ON scheme_payout_charges;
CREATE TRIGGER update_scheme_payout_charges_updated_at
  BEFORE UPDATE ON scheme_payout_charges FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_scheme_mdr_rates_updated_at ON scheme_mdr_rates;
CREATE TRIGGER update_scheme_mdr_rates_updated_at
  BEFORE UPDATE ON scheme_mdr_rates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_scheme_mappings_updated_at ON scheme_mappings;
CREATE TRIGGER update_scheme_mappings_updated_at
  BEFORE UPDATE ON scheme_mappings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 8. FUNCTION: Resolve scheme for a user + service
-- ============================================================================
-- Looks up: retailer mapping → distributor mapping → MD mapping → global scheme

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
  resolved_via TEXT -- 'retailer_mapping', 'distributor_mapping', 'md_mapping', 'global'
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
-- 9. FUNCTION: Calculate BBPS charge from scheme
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
    CASE WHEN sbc.category IS NOT NULL THEN 0 ELSE 1 END, -- Specific category first
    sbc.min_amount DESC
  LIMIT 1;
  
  IF v_rec IS NULL THEN
    -- No scheme config found, return zeros
    RETURN QUERY SELECT 0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2), 0::DECIMAL(12,2);
    RETURN;
  END IF;
  
  -- Calculate amounts based on type (flat or percentage)
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
-- 10. FUNCTION: Calculate Payout charge from scheme
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
-- 11. SEED: Default Global Scheme
-- ============================================================================

INSERT INTO schemes (name, description, scheme_type, service_scope, status, priority, created_by_role)
VALUES (
  'Default Global Scheme',
  'System-wide default scheme for all services. Applied when no custom scheme is mapped.',
  'global', 'all', 'active', 1000, 'admin'
)
ON CONFLICT DO NOTHING;

-- Insert default BBPS commissions for the global scheme
DO $$
DECLARE
  v_scheme_id UUID;
BEGIN
  SELECT id INTO v_scheme_id FROM schemes WHERE name = 'Default Global Scheme' AND scheme_type = 'global' LIMIT 1;
  
  IF v_scheme_id IS NOT NULL THEN
    -- Default BBPS slabs (matches existing calculate_transaction_charge)
    INSERT INTO scheme_bbps_commissions (scheme_id, category, min_amount, max_amount, retailer_charge, retailer_charge_type, company_charge, company_charge_type)
    VALUES
      (v_scheme_id, NULL, 0, 1000, 10, 'flat', 10, 'flat'),
      (v_scheme_id, NULL, 1000.01, 5000, 15, 'flat', 15, 'flat'),
      (v_scheme_id, NULL, 5000.01, 10000, 20, 'flat', 20, 'flat'),
      (v_scheme_id, NULL, 10000.01, 999999999, 25, 'flat', 25, 'flat')
    ON CONFLICT DO NOTHING;
    
    -- Default Payout charges
    INSERT INTO scheme_payout_charges (scheme_id, transfer_mode, min_amount, max_amount, retailer_charge, retailer_charge_type, company_charge, company_charge_type)
    VALUES
      (v_scheme_id, 'IMPS', 0, 999999999, 5, 'flat', 5, 'flat'),
      (v_scheme_id, 'NEFT', 0, 999999999, 3, 'flat', 3, 'flat')
    ON CONFLICT DO NOTHING;
    
    -- Default MDR rates
    INSERT INTO scheme_mdr_rates (scheme_id, mode, card_type, retailer_mdr_t1, retailer_mdr_t0, distributor_mdr_t1, distributor_mdr_t0)
    VALUES
      (v_scheme_id, 'UPI', NULL, 0, 1.0, 0, 1.0),
      (v_scheme_id, 'CARD', 'CREDIT', 1.5, 2.5, 1.1, 2.1),
      (v_scheme_id, 'CARD', 'DEBIT', 0.9, 1.9, 0.5, 1.5),
      (v_scheme_id, 'CARD', 'PREPAID', 1.2, 2.2, 0.8, 1.8)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ============================================================================
-- 12. COMMENTS
-- ============================================================================

COMMENT ON TABLE schemes IS 'Master scheme definitions - Global, Golden, or Custom schemes covering BBPS, Payout, MDR services';
COMMENT ON TABLE scheme_bbps_commissions IS 'BBPS charge/commission configuration per scheme, with amount slabs and category-level granularity';
COMMENT ON TABLE scheme_payout_charges IS 'Payout charge/commission configuration per scheme, by transfer mode (IMPS/NEFT)';
COMMENT ON TABLE scheme_mdr_rates IS 'MDR rate configuration per scheme for Razorpay/POS settlement (T+0/T+1)';
COMMENT ON TABLE scheme_mappings IS 'Maps schemes to users (retailer/distributor/MD). Resolution: retailer → distributor → MD → global';
COMMENT ON FUNCTION resolve_scheme_for_user IS 'Resolves the applicable scheme for a user by checking hierarchy: retailer → distributor → MD → global';

