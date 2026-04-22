-- ============================================================================
-- Partner T+1 Settlement Migration
-- ============================================================================
-- Creates tables and columns for partner T+1 settlement feature:
-- - partner_id tracking on razorpay_pos_transactions
-- - partner scheme configuration (partner_schemes table)
-- - partner T+1 cron settings
-- - partner settlement pause flag
--
-- Run in Supabase SQL Editor
-- ============================================================================

-- ============================================================================
-- 1. ADD PARTNER ID AND SETTLEMENT COLUMNS TO razorpay_pos_transactions
-- ============================================================================
DO $$
BEGIN
  -- Add partner_id column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'partner_id') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN partner_id UUID;
  END IF;

  -- Add partner MDR tracking columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'partner_mdr_amount') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN partner_mdr_amount DECIMAL(15, 2);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'partner_net_amount') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN partner_net_amount DECIMAL(15, 2);
  END IF;

  -- Add partner wallet credit tracking
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'partner_wallet_credited') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN partner_wallet_credited BOOLEAN DEFAULT FALSE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'partner_wallet_credit_id') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN partner_wallet_credit_id UUID;
  END IF;

  -- Add settlement type column (to track T0 vs T1)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'settlement_type') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN settlement_type TEXT DEFAULT 'T1' CHECK (settlement_type IN ('T0', 'T1'));
  END IF;

  -- Add auto settle timestamp for partners
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'partner_auto_settled_at') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN partner_auto_settled_at TIMESTAMPTZ;
  END IF;
END $$;

-- Create indexes for partner settlement
CREATE INDEX IF NOT EXISTS idx_razorpay_pos_transactions_partner_id ON razorpay_pos_transactions(partner_id);
CREATE INDEX IF NOT EXISTS idx_razorpay_pos_transactions_partner_wallet_credited ON razorpay_pos_transactions(partner_wallet_credited);
CREATE INDEX IF NOT EXISTS idx_razorpay_pos_transactions_settlement_type ON razorpay_pos_transactions(settlement_type);
CREATE INDEX IF NOT EXISTS idx_razorpay_pos_transactions_partner_t1_pending 
  ON razorpay_pos_transactions(settlement_type, partner_wallet_credited, created_at) 
  WHERE settlement_type = 'T1' AND partner_wallet_credited = FALSE AND partner_id IS NOT NULL;

-- ============================================================================
-- 2. CREATE PARTNER SCHEME TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS partner_schemes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  
  mode TEXT NOT NULL CHECK (mode IN ('CARD', 'UPI')),
  card_type TEXT CHECK (card_type IN ('CREDIT', 'DEBIT', 'PREPAID')),
  brand_type TEXT, -- VISA, MasterCard, RuPay, Amex, Diners etc. NULL for UPI or when not applicable
  
  -- Partner MDR rates
  partner_mdr_t1 NUMERIC(5, 4) NOT NULL CHECK (partner_mdr_t1 >= 0 AND partner_mdr_t1 <= 100),
  partner_mdr_t0 NUMERIC(5, 4) NOT NULL CHECK (partner_mdr_t0 >= 0 AND partner_mdr_t0 <= 100),
  
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  effective_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_schemes_partner_id ON partner_schemes(partner_id);
CREATE INDEX IF NOT EXISTS idx_partner_schemes_mode ON partner_schemes(mode);
CREATE INDEX IF NOT EXISTS idx_partner_schemes_card_type ON partner_schemes(card_type);
CREATE INDEX IF NOT EXISTS idx_partner_schemes_brand_type ON partner_schemes(brand_type);
CREATE INDEX IF NOT EXISTS idx_partner_schemes_status ON partner_schemes(status);
CREATE INDEX IF NOT EXISTS idx_partner_schemes_effective_date ON partner_schemes(effective_date);

-- Ensure only one active scheme per partner per mode/card_type/brand_type combination
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_partner_scheme 
ON partner_schemes(partner_id, mode, card_type, brand_type) 
WHERE status = 'active';

-- RLS for partner_schemes
ALTER TABLE partner_schemes ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'partner_schemes' AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access" ON partner_schemes FOR ALL USING (true);
  END IF;
END $$;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_partner_schemes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_partner_schemes_updated_at_trigger ON partner_schemes;
CREATE TRIGGER update_partner_schemes_updated_at_trigger
  BEFORE UPDATE ON partner_schemes
  FOR EACH ROW
  EXECUTE FUNCTION update_partner_schemes_updated_at();

COMMENT ON TABLE partner_schemes IS 'MDR schemes for B2B partners. One active scheme per (partner_id, mode, card_type, brand_type)';
COMMENT ON COLUMN partner_schemes.partner_mdr_t1 IS 'Partner MDR rate for T+1 settlement (percentage)';
COMMENT ON COLUMN partner_schemes.partner_mdr_t0 IS 'Partner MDR rate for T+0 settlement (percentage)';

-- ============================================================================
-- 3. ADD PARTNER T+1 SETTLEMENT PAUSE FLAG TO partners TABLE
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'partners' AND column_name = 't1_settlement_paused') THEN
    ALTER TABLE partners ADD COLUMN t1_settlement_paused BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_partners_t1_settlement_paused 
ON partners(t1_settlement_paused) WHERE t1_settlement_paused = TRUE;

COMMENT ON COLUMN partners.t1_settlement_paused IS 'Flag to pause T+1 settlement for this partner';

-- ============================================================================
-- 4. CREATE PARTNER T+1 CRON SETTINGS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS partner_t1_cron_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  schedule_hour INTEGER NOT NULL DEFAULT 4 CHECK (schedule_hour >= 0 AND schedule_hour <= 23),
  schedule_minute INTEGER NOT NULL DEFAULT 0 CHECK (schedule_minute >= 0 AND schedule_minute <= 59),
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  
  last_run_at TIMESTAMP WITH TIME ZONE,
  last_run_status TEXT CHECK (last_run_status IN ('success', 'partial', 'failed')),
  last_run_message TEXT,
  last_run_processed INTEGER DEFAULT 0,
  last_run_failed INTEGER DEFAULT 0,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Only one settings record should exist
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_t1_cron_settings_singleton ON partner_t1_cron_settings(id) WHERE id IS NOT NULL;

-- RLS for partner_t1_cron_settings
ALTER TABLE partner_t1_cron_settings ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'partner_t1_cron_settings' AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access" ON partner_t1_cron_settings FOR ALL USING (true);
  END IF;
END $$;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_partner_t1_cron_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_partner_t1_cron_settings_updated_at_trigger ON partner_t1_cron_settings;
CREATE TRIGGER update_partner_t1_cron_settings_updated_at_trigger
  BEFORE UPDATE ON partner_t1_cron_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_partner_t1_cron_settings_updated_at();

COMMENT ON TABLE partner_t1_cron_settings IS 'Global T+1 settlement cron schedule and status for partners';
COMMENT ON COLUMN partner_t1_cron_settings.is_enabled IS 'Enable/disable partner T+1 settlement cron globally';
COMMENT ON COLUMN partner_t1_cron_settings.timezone IS 'Timezone for cron schedule (e.g., Asia/Kolkata)';

-- Initialize default settings (only once)
INSERT INTO partner_t1_cron_settings (schedule_hour, schedule_minute, timezone, is_enabled)
SELECT 4, 0, 'Asia/Kolkata', FALSE
WHERE NOT EXISTS (SELECT 1 FROM partner_t1_cron_settings);

-- ============================================================================
-- 5. HELPER FUNCTIONS FOR PARTNER SETTLEMENT
-- ============================================================================

-- Get paused partner IDs
CREATE OR REPLACE FUNCTION get_paused_partner_ids()
RETURNS TABLE(partner_id UUID) AS $$
BEGIN
  RETURN QUERY
  SELECT p.id
  FROM partners p
  WHERE p.t1_settlement_paused = TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_paused_partner_ids() TO service_role;

-- Get partner scheme for a given transaction
CREATE OR REPLACE FUNCTION get_partner_scheme(
  p_partner_id UUID,
  p_mode TEXT,
  p_card_type TEXT,
  p_brand_type TEXT
)
RETURNS TABLE(
  scheme_id UUID,
  partner_mdr_t0 NUMERIC,
  partner_mdr_t1 NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT ps.id, ps.partner_mdr_t0, ps.partner_mdr_t1
  FROM partner_schemes ps
  WHERE ps.partner_id = p_partner_id
    AND ps.mode = p_mode
    AND ps.status = 'active'
    AND (
      -- Exact match
      (ps.card_type = p_card_type AND ps.brand_type = p_brand_type)
      -- Card type match, any brand
      OR (ps.card_type = p_card_type AND ps.brand_type IS NULL)
      -- Any card type (fallback)
      OR (ps.card_type IS NULL AND ps.brand_type IS NULL)
    )
  ORDER BY 
    -- Prioritize exact matches
    CASE 
      WHEN ps.card_type = p_card_type AND ps.brand_type = p_brand_type THEN 0
      WHEN ps.card_type = p_card_type AND ps.brand_type IS NULL THEN 1
      ELSE 2
    END
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_partner_scheme(UUID, TEXT, TEXT, TEXT) TO service_role;

-- ============================================================================
-- 6. COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON COLUMN razorpay_pos_transactions.partner_id IS 'UUID of partner this transaction belongs to (populated from POS machine assignment)';
COMMENT ON COLUMN razorpay_pos_transactions.partner_mdr_amount IS 'MDR amount deducted for partner settlement';
COMMENT ON COLUMN razorpay_pos_transactions.partner_net_amount IS 'Net amount to be credited to partner wallet (amount - mdr)';
COMMENT ON COLUMN razorpay_pos_transactions.partner_wallet_credited IS 'Flag indicating wallet credit has been processed';
COMMENT ON COLUMN razorpay_pos_transactions.partner_wallet_credit_id IS 'Reference to partner_wallet_ledger entry';
COMMENT ON COLUMN razorpay_pos_transactions.settlement_type IS 'T+0 (same day) or T+1 (next day) settlement';
COMMENT ON COLUMN razorpay_pos_transactions.partner_auto_settled_at IS 'Timestamp when partner wallet was credited';
