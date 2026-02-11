-- ============================================================================
-- MDR SCHEME ENGINE MIGRATION
-- ============================================================================
-- This migration creates tables for the Distributor → Retailer MDR Scheme Engine
-- with Razorpay settlement and Supabase database.
-- ============================================================================

-- ============================================================================
-- 1. GLOBAL SCHEMES TABLE
-- ============================================================================
-- Stores global MDR schemes that apply to all retailers by default
-- T+0 MDR = T+1 MDR + 1% (enforced at application level)
-- ============================================================================

CREATE TABLE IF NOT EXISTS global_schemes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mode TEXT NOT NULL CHECK (mode IN ('CARD', 'UPI')),
  card_type TEXT CHECK (card_type IN ('CREDIT', 'DEBIT', 'PREPAID')),
  brand_type TEXT, -- VISA, MasterCard, etc. NULL for UPI or when not applicable
  
  -- Retailer MDR rates
  rt_mdr_t1 NUMERIC(5, 4) NOT NULL CHECK (rt_mdr_t1 >= 0 AND rt_mdr_t1 <= 100),
  rt_mdr_t0 NUMERIC(5, 4) NOT NULL CHECK (rt_mdr_t0 >= 0 AND rt_mdr_t0 <= 100),
  
  -- Distributor MDR rates
  dt_mdr_t1 NUMERIC(5, 4) NOT NULL CHECK (dt_mdr_t1 >= 0 AND dt_mdr_t1 <= 100),
  dt_mdr_t0 NUMERIC(5, 4) NOT NULL CHECK (dt_mdr_t0 >= 0 AND dt_mdr_t0 <= 100),
  
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  effective_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_global_schemes_mode ON global_schemes(mode);
CREATE INDEX IF NOT EXISTS idx_global_schemes_card_type ON global_schemes(card_type);
CREATE INDEX IF NOT EXISTS idx_global_schemes_brand_type ON global_schemes(brand_type);
CREATE INDEX IF NOT EXISTS idx_global_schemes_status ON global_schemes(status);
CREATE INDEX IF NOT EXISTS idx_global_schemes_effective_date ON global_schemes(effective_date);

-- Ensure only one active scheme per mode/card_type/brand_type combination
-- Using partial unique index (only applies to active records)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_global_scheme 
ON global_schemes(mode, card_type, brand_type) 
WHERE status = 'active';

-- ============================================================================
-- 2. RETAILER SCHEMES TABLE (Custom Schemes)
-- ============================================================================
-- Distributor-defined custom MDR schemes for specific retailers
-- Retailer MDR must be >= Distributor MDR (enforced at application level)
-- ============================================================================

CREATE TABLE IF NOT EXISTS retailer_schemes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  distributor_id TEXT NOT NULL,
  retailer_id TEXT NOT NULL,
  
  mode TEXT NOT NULL CHECK (mode IN ('CARD', 'UPI')),
  card_type TEXT CHECK (card_type IN ('CREDIT', 'DEBIT', 'PREPAID')),
  brand_type TEXT, -- VISA, MasterCard, etc. NULL for UPI or when not applicable
  
  -- Retailer MDR rates (can be any value, but must be >= distributor MDR)
  retailer_mdr_t1 NUMERIC(5, 4) NOT NULL CHECK (retailer_mdr_t1 >= 0 AND retailer_mdr_t1 <= 100),
  retailer_mdr_t0 NUMERIC(5, 4) NOT NULL CHECK (retailer_mdr_t0 >= 0 AND retailer_mdr_t0 <= 100),
  
  -- Distributor MDR rates
  distributor_mdr_t1 NUMERIC(5, 4) NOT NULL CHECK (distributor_mdr_t1 >= 0 AND distributor_mdr_t1 <= 100),
  distributor_mdr_t0 NUMERIC(5, 4) NOT NULL CHECK (distributor_mdr_t0 >= 0 AND distributor_mdr_t0 <= 100),
  
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  effective_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_retailer_schemes_distributor_id ON retailer_schemes(distributor_id);
CREATE INDEX IF NOT EXISTS idx_retailer_schemes_retailer_id ON retailer_schemes(retailer_id);
CREATE INDEX IF NOT EXISTS idx_retailer_schemes_mode ON retailer_schemes(mode);
CREATE INDEX IF NOT EXISTS idx_retailer_schemes_card_type ON retailer_schemes(card_type);
CREATE INDEX IF NOT EXISTS idx_retailer_schemes_brand_type ON retailer_schemes(brand_type);
CREATE INDEX IF NOT EXISTS idx_retailer_schemes_status ON retailer_schemes(status);
CREATE INDEX IF NOT EXISTS idx_retailer_schemes_effective_date ON retailer_schemes(effective_date);

-- Ensure only one active scheme per retailer per mode/card_type/brand_type
-- Using partial unique index (only applies to active records)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_retailer_scheme 
ON retailer_schemes(retailer_id, mode, card_type, brand_type) 
WHERE status = 'active';

-- ============================================================================
-- 3. TRANSACTIONS TABLE (MDR Scheme Engine)
-- ============================================================================
-- Stores transaction records with MDR calculations and settlement details
-- ============================================================================

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  razorpay_payment_id TEXT UNIQUE NOT NULL,
  
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  settlement_type TEXT NOT NULL CHECK (settlement_type IN ('T0', 'T1')),
  
  mode TEXT NOT NULL CHECK (mode IN ('CARD', 'UPI')),
  card_type TEXT CHECK (card_type IN ('CREDIT', 'DEBIT', 'PREPAID')),
  brand_type TEXT, -- VISA, MasterCard, etc.
  
  retailer_id TEXT NOT NULL,
  distributor_id TEXT,
  
  -- MDR rates used for this transaction
  retailer_mdr_used NUMERIC(5, 4) NOT NULL,
  distributor_mdr_used NUMERIC(5, 4) NOT NULL,
  
  -- Fee calculations
  retailer_fee DECIMAL(12, 2) NOT NULL CHECK (retailer_fee >= 0),
  distributor_fee DECIMAL(12, 2) NOT NULL CHECK (distributor_fee >= 0),
  distributor_margin DECIMAL(12, 2) NOT NULL CHECK (distributor_margin >= 0),
  company_earning DECIMAL(12, 2) NOT NULL CHECK (company_earning >= 0),
  
  -- Settlement details
  settlement_status TEXT NOT NULL DEFAULT 'pending' CHECK (settlement_status IN ('pending', 'completed', 'failed')),
  retailer_settlement_amount DECIMAL(12, 2) NOT NULL CHECK (retailer_settlement_amount >= 0),
  
  -- Wallet credit tracking
  retailer_wallet_credited BOOLEAN DEFAULT FALSE,
  retailer_wallet_credit_id UUID,
  distributor_wallet_credited BOOLEAN DEFAULT FALSE,
  distributor_wallet_credit_id UUID,
  admin_wallet_credited BOOLEAN DEFAULT FALSE,
  admin_wallet_credit_id UUID,
  
  -- Scheme reference
  scheme_type TEXT CHECK (scheme_type IN ('global', 'custom')),
  scheme_id UUID, -- References global_schemes.id or retailer_schemes.id
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Metadata for additional information
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_transactions_razorpay_payment_id ON transactions(razorpay_payment_id);
CREATE INDEX IF NOT EXISTS idx_transactions_retailer_id ON transactions(retailer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_distributor_id ON transactions(distributor_id);
CREATE INDEX IF NOT EXISTS idx_transactions_settlement_type ON transactions(settlement_type);
CREATE INDEX IF NOT EXISTS idx_transactions_settlement_status ON transactions(settlement_status);
CREATE INDEX IF NOT EXISTS idx_transactions_mode ON transactions(mode);
CREATE INDEX IF NOT EXISTS idx_transactions_card_type ON transactions(card_type);
CREATE INDEX IF NOT EXISTS idx_transactions_brand_type ON transactions(brand_type);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_t1_pending ON transactions(settlement_type, settlement_status, created_at) 
  WHERE settlement_type = 'T1' AND settlement_status = 'pending';

-- ============================================================================
-- 4. FUNCTION: Auto-update updated_at timestamp
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_global_schemes_updated_at
  BEFORE UPDATE ON global_schemes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_retailer_schemes_updated_at
  BEFORE UPDATE ON retailer_schemes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 5. RLS POLICIES (if RLS is enabled)
-- ============================================================================
-- Note: Adjust these policies based on your RLS requirements

-- Enable RLS on tables (optional, uncomment if needed)
-- ALTER TABLE global_schemes ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE retailer_schemes ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Example policies (adjust as needed):
-- Admin can view all
-- Distributor can view their own retailer schemes and transactions
-- Retailer can view their own schemes and transactions

-- ============================================================================
-- 6. COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE global_schemes IS 'Global MDR schemes that apply to all retailers by default. T+0 MDR = T+1 MDR + 1%';
COMMENT ON TABLE retailer_schemes IS 'Custom MDR schemes defined by distributors for specific retailers. Retailer MDR must be >= Distributor MDR';
COMMENT ON TABLE transactions IS 'Transaction records with MDR calculations and settlement details for the MDR scheme engine';

COMMENT ON COLUMN global_schemes.rt_mdr_t1 IS 'Retailer MDR rate for T+1 settlement (percentage)';
COMMENT ON COLUMN global_schemes.rt_mdr_t0 IS 'Retailer MDR rate for T+0 settlement (percentage). Should be T+1 + 1%';
COMMENT ON COLUMN global_schemes.dt_mdr_t1 IS 'Distributor MDR rate for T+1 settlement (percentage)';
COMMENT ON COLUMN global_schemes.dt_mdr_t0 IS 'Distributor MDR rate for T+0 settlement (percentage). Should be T+1 + 1%';

COMMENT ON COLUMN retailer_schemes.retailer_mdr_t1 IS 'Retailer MDR rate for T+1 settlement (percentage). Must be >= distributor_mdr_t1';
COMMENT ON COLUMN retailer_schemes.retailer_mdr_t0 IS 'Retailer MDR rate for T+0 settlement (percentage). Must be >= distributor_mdr_t0';
COMMENT ON COLUMN retailer_schemes.distributor_mdr_t1 IS 'Distributor MDR rate for T+1 settlement (percentage)';
COMMENT ON COLUMN retailer_schemes.distributor_mdr_t0 IS 'Distributor MDR rate for T+0 settlement (percentage)';

COMMENT ON COLUMN transactions.retailer_settlement_amount IS 'Amount to be credited to retailer wallet (amount - retailer_fee)';
COMMENT ON COLUMN transactions.distributor_margin IS 'Distributor margin = retailer_fee - distributor_fee';
COMMENT ON COLUMN transactions.company_earning IS 'Company earning = distributor_fee';

