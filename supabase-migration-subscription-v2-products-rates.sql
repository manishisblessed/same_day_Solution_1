-- ============================================================================
-- SUBSCRIPTION V2: Products, Hierarchical Rates, Items, Commissions
-- Run AFTER supabase-migration-pos-brand-and-subscriptions.sql
-- ============================================================================

-- 1. SUBSCRIPTION PRODUCTS (POS Machine, QR Barcode, etc.)
CREATE TABLE IF NOT EXISTS subscription_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  default_gst_percent DECIMAL(5, 2) NOT NULL DEFAULT 18.00,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default product
INSERT INTO subscription_products (name, description, default_gst_percent) VALUES
  ('POS Machine', 'POS terminal rental', 18.00),
  ('QR Barcode', 'QR code payment device', 18.00)
ON CONFLICT (name) DO NOTHING;

-- 2. SUBSCRIPTION PRODUCT RATES
-- Stores the monthly rate assigned to each entity in the hierarchy.
-- Admin sets MD rate, MD/admin sets distributor rate, distributor/admin sets retailer rate.
CREATE TABLE IF NOT EXISTS subscription_product_rates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES subscription_products(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL CHECK (user_role IN ('retailer', 'distributor', 'master_distributor')),
  rate_per_unit DECIMAL(12, 2) NOT NULL CHECK (rate_per_unit >= 0),
  gst_percent DECIMAL(5, 2) NOT NULL DEFAULT 18.00,
  assigned_by TEXT,
  assigned_by_role TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_sub_product_rates_user ON subscription_product_rates(user_id);
CREATE INDEX IF NOT EXISTS idx_sub_product_rates_product ON subscription_product_rates(product_id);

-- 3. SUBSCRIPTION ITEMS
-- Each item links a specific assigned product (e.g., a POS machine) to a user.
-- Stores the full rate chain for fast commission computation during auto-debit.
CREATE TABLE IF NOT EXISTS subscription_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES subscription_products(id) ON DELETE CASCADE,
  reference_id TEXT,
  reference_type TEXT DEFAULT 'pos_machine',
  retailer_rate DECIMAL(12, 2) NOT NULL DEFAULT 0,
  distributor_rate DECIMAL(12, 2) NOT NULL DEFAULT 0,
  md_rate DECIMAL(12, 2) NOT NULL DEFAULT 0,
  gst_percent DECIMAL(5, 2) NOT NULL DEFAULT 18.00,
  distributor_id TEXT,
  master_distributor_id TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_items_subscription ON subscription_items(subscription_id);
CREATE INDEX IF NOT EXISTS idx_sub_items_reference ON subscription_items(reference_id);

-- 4. SUBSCRIPTION COMMISSIONS (credited to distributor/MD after auto-debit)
CREATE TABLE IF NOT EXISTS subscription_commissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  debit_id UUID NOT NULL REFERENCES subscription_debits(id) ON DELETE CASCADE,
  beneficiary_id TEXT NOT NULL,
  beneficiary_role TEXT NOT NULL CHECK (beneficiary_role IN ('distributor', 'master_distributor')),
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  gst_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  item_count INT NOT NULL DEFAULT 0,
  ledger_id UUID,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  failure_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_commissions_debit ON subscription_commissions(debit_id);
CREATE INDEX IF NOT EXISTS idx_sub_commissions_beneficiary ON subscription_commissions(beneficiary_id);

-- 5. Add GST columns to subscription_debits for clarity
ALTER TABLE subscription_debits ADD COLUMN IF NOT EXISTS gst_amount DECIMAL(12, 2) DEFAULT 0;
ALTER TABLE subscription_debits ADD COLUMN IF NOT EXISTS base_amount DECIMAL(12, 2) DEFAULT 0;
ALTER TABLE subscription_debits ADD COLUMN IF NOT EXISTS item_count INT DEFAULT 0;

-- 6. RLS
ALTER TABLE subscription_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_product_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_commissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all subscription_products" ON subscription_products;
DROP POLICY IF EXISTS "Allow all subscription_product_rates" ON subscription_product_rates;
DROP POLICY IF EXISTS "Allow all subscription_items" ON subscription_items;
DROP POLICY IF EXISTS "Allow all subscription_commissions" ON subscription_commissions;

CREATE POLICY "Allow all subscription_products" ON subscription_products FOR ALL USING (true);
CREATE POLICY "Allow all subscription_product_rates" ON subscription_product_rates FOR ALL USING (true);
CREATE POLICY "Allow all subscription_items" ON subscription_items FOR ALL USING (true);
CREATE POLICY "Allow all subscription_commissions" ON subscription_commissions FOR ALL USING (true);
