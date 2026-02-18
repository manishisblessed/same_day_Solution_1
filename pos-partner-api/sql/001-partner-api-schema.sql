-- ============================================================================
-- POS Partner API - Complete Database Schema
-- Run in Supabase SQL Editor
-- Same Day Solution - Enterprise POS Partner API
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1) PARTNERS TABLE
-- External partner organizations who consume the API
-- ============================================================================
CREATE TABLE IF NOT EXISTS partners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  business_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  gst_number TEXT,
  pan_number TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'suspended')),
  webhook_url TEXT,                -- partner's webhook endpoint for callbacks
  ip_whitelist TEXT[],             -- allowed IP addresses
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_partners_status ON partners(status);
CREATE INDEX idx_partners_email ON partners(email);

-- ============================================================================
-- 2) RETAILERS TABLE
-- Retailers mapped under a partner
-- ============================================================================
CREATE TABLE IF NOT EXISTS partner_retailers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  retailer_code TEXT NOT NULL,
  name TEXT NOT NULL,
  business_name TEXT,
  email TEXT,
  phone TEXT,
  city TEXT,
  state TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(partner_id, retailer_code)
);

CREATE INDEX idx_partner_retailers_partner ON partner_retailers(partner_id);
CREATE INDEX idx_partner_retailers_code ON partner_retailers(retailer_code);
CREATE INDEX idx_partner_retailers_status ON partner_retailers(status);

-- ============================================================================
-- 3) POS MACHINES TABLE
-- Physical POS terminals mapped to retailer + partner
-- ============================================================================
CREATE TABLE IF NOT EXISTS partner_pos_machines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  retailer_id UUID NOT NULL REFERENCES partner_retailers(id) ON DELETE CASCADE,
  terminal_id TEXT NOT NULL,              -- Razorpay TID
  device_serial TEXT,                     -- Device serial number
  machine_model TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'maintenance', 'decommissioned')),
  activated_at TIMESTAMPTZ,
  last_txn_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(terminal_id)
);

CREATE INDEX idx_partner_pos_machines_partner ON partner_pos_machines(partner_id);
CREATE INDEX idx_partner_pos_machines_retailer ON partner_pos_machines(retailer_id);
CREATE INDEX idx_partner_pos_machines_terminal ON partner_pos_machines(terminal_id);
CREATE INDEX idx_partner_pos_machines_device ON partner_pos_machines(device_serial);
CREATE INDEX idx_partner_pos_machines_status ON partner_pos_machines(status);

-- ============================================================================
-- 4) POS TRANSACTIONS - PARTITIONED BY MONTH (txn_time)
-- Core transaction table - handles 50 lakh+ records efficiently
-- ============================================================================

-- Parent partitioned table
CREATE TABLE IF NOT EXISTS pos_transactions (
  id BIGSERIAL,
  partner_id UUID NOT NULL,
  retailer_id UUID NOT NULL,
  terminal_id TEXT NOT NULL,
  razorpay_txn_id TEXT NOT NULL,          -- txnId from Razorpay POS
  razorpay_payment_id TEXT,               -- if available
  external_ref TEXT,                      -- externalRefNumber
  amount BIGINT NOT NULL,                 -- amount in paisa
  status TEXT NOT NULL DEFAULT 'AUTHORIZED'
    CHECK (status IN ('AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'VOIDED')),
  rrn TEXT,                               -- rrNumber
  card_brand TEXT,                        -- VISA, MASTERCARD, RUPAY
  card_type TEXT,                         -- CREDIT, DEBIT
  payment_mode TEXT,                      -- CARD, UPI, NFC
  settlement_status TEXT DEFAULT 'PENDING'
    CHECK (settlement_status IN ('PENDING', 'SETTLED', 'FAILED')),
  device_serial TEXT,
  txn_time TIMESTAMPTZ NOT NULL,          -- postingDate from Razorpay
  raw_payload JSONB,                      -- full webhook payload for audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, txn_time)
) PARTITION BY RANGE (txn_time);

-- Unique constraint on razorpay_txn_id per partition for dedup
CREATE UNIQUE INDEX idx_pos_txn_dedup ON pos_transactions(razorpay_txn_id, txn_time);

-- Performance indexes
CREATE INDEX idx_pos_txn_partner_time ON pos_transactions(partner_id, txn_time DESC);
CREATE INDEX idx_pos_txn_status ON pos_transactions(status, txn_time DESC);
CREATE INDEX idx_pos_txn_terminal ON pos_transactions(terminal_id, txn_time DESC);
CREATE INDEX idx_pos_txn_retailer ON pos_transactions(retailer_id, txn_time DESC);
CREATE INDEX idx_pos_txn_settlement ON pos_transactions(settlement_status, txn_time DESC);
CREATE INDEX idx_pos_txn_rrn ON pos_transactions(rrn) WHERE rrn IS NOT NULL;
CREATE INDEX idx_pos_txn_ext_ref ON pos_transactions(external_ref) WHERE external_ref IS NOT NULL;

-- ============================================================================
-- 4b) CREATE MONTHLY PARTITIONS
-- Create partitions for current year + next 2 months
-- ============================================================================

-- 2026 Monthly Partitions
CREATE TABLE IF NOT EXISTS pos_transactions_2026_01
  PARTITION OF pos_transactions
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE IF NOT EXISTS pos_transactions_2026_02
  PARTITION OF pos_transactions
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

CREATE TABLE IF NOT EXISTS pos_transactions_2026_03
  PARTITION OF pos_transactions
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

CREATE TABLE IF NOT EXISTS pos_transactions_2026_04
  PARTITION OF pos_transactions
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE TABLE IF NOT EXISTS pos_transactions_2026_05
  PARTITION OF pos_transactions
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TABLE IF NOT EXISTS pos_transactions_2026_06
  PARTITION OF pos_transactions
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE IF NOT EXISTS pos_transactions_2026_07
  PARTITION OF pos_transactions
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE TABLE IF NOT EXISTS pos_transactions_2026_08
  PARTITION OF pos_transactions
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE TABLE IF NOT EXISTS pos_transactions_2026_09
  PARTITION OF pos_transactions
  FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');

CREATE TABLE IF NOT EXISTS pos_transactions_2026_10
  PARTITION OF pos_transactions
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

CREATE TABLE IF NOT EXISTS pos_transactions_2026_11
  PARTITION OF pos_transactions
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');

CREATE TABLE IF NOT EXISTS pos_transactions_2026_12
  PARTITION OF pos_transactions
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

-- 2027 Q1 (pre-create next year's first quarter)
CREATE TABLE IF NOT EXISTS pos_transactions_2027_01
  PARTITION OF pos_transactions
  FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');

CREATE TABLE IF NOT EXISTS pos_transactions_2027_02
  PARTITION OF pos_transactions
  FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');

CREATE TABLE IF NOT EXISTS pos_transactions_2027_03
  PARTITION OF pos_transactions
  FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');

-- ============================================================================
-- 4c) EXAMPLE: Create future monthly partition (run monthly via cron)
-- ============================================================================
-- To create a new partition for April 2027:
--
-- CREATE TABLE IF NOT EXISTS pos_transactions_2027_04
--   PARTITION OF pos_transactions
--   FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
--
-- Automate with pg_cron or external cron job

-- ============================================================================
-- 5) PARTNER API KEYS TABLE
-- HMAC-based authentication keys for partners
-- ============================================================================
CREATE TABLE IF NOT EXISTS partner_api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  api_key TEXT UNIQUE NOT NULL,             -- public key (sent in x-api-key header)
  api_secret TEXT NOT NULL,                 -- private secret (used for HMAC signing)
  label TEXT DEFAULT 'default',             -- human label for the key
  is_active BOOLEAN NOT NULL DEFAULT true,
  permissions JSONB DEFAULT '["read"]',     -- ["read", "export"]
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,                   -- optional expiry
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_partner_api_keys_key ON partner_api_keys(api_key) WHERE is_active = true;
CREATE INDEX idx_partner_api_keys_partner ON partner_api_keys(partner_id);

-- ============================================================================
-- 6) EXPORT JOBS TABLE
-- Async export job queue
-- ============================================================================
CREATE TABLE IF NOT EXISTS export_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'PROCESSING'
    CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED')),
  format TEXT NOT NULL DEFAULT 'csv'
    CHECK (format IN ('csv', 'excel', 'pdf', 'zip')),
  filters JSONB NOT NULL DEFAULT '{}',      -- query filters used
  file_url TEXT,                            -- S3 signed URL (set on completion)
  file_key TEXT,                            -- S3 object key
  file_size_bytes BIGINT,
  total_records INT,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,                   -- signed URL expiry
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_export_jobs_partner ON export_jobs(partner_id, created_at DESC);
CREATE INDEX idx_export_jobs_status ON export_jobs(status) WHERE status = 'PROCESSING';

-- ============================================================================
-- 7) PARTNER EXPORT LIMITS TABLE
-- Daily export quota per partner
-- ============================================================================
CREATE TABLE IF NOT EXISTS partner_export_limits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id UUID UNIQUE NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  daily_limit INT NOT NULL DEFAULT 10,
  monthly_limit INT DEFAULT 300,
  max_records_per_export INT DEFAULT 500000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_partner_export_limits_partner ON partner_export_limits(partner_id);

-- ============================================================================
-- TRIGGERS: Auto-update updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'partners',
      'partner_retailers',
      'partner_pos_machines',
      'partner_api_keys',
      'export_jobs',
      'partner_export_limits'
    ])
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I;
       CREATE TRIGGER trg_%s_updated_at
         BEFORE UPDATE ON %I
         FOR EACH ROW
         EXECUTE FUNCTION update_updated_at_column();',
      tbl, tbl, tbl, tbl
    );
  END LOOP;
END;
$$;

-- ============================================================================
-- RLS POLICIES (using service role key bypasses RLS, but set up for safety)
-- ============================================================================
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_retailers ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_pos_machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_export_limits ENABLE ROW LEVEL SECURITY;

-- Service role has full access (API server uses service role key)
CREATE POLICY "Service role full access" ON partners FOR ALL USING (true);
CREATE POLICY "Service role full access" ON partner_retailers FOR ALL USING (true);
CREATE POLICY "Service role full access" ON partner_pos_machines FOR ALL USING (true);
CREATE POLICY "Service role full access" ON pos_transactions FOR ALL USING (true);
CREATE POLICY "Service role full access" ON partner_api_keys FOR ALL USING (true);
CREATE POLICY "Service role full access" ON export_jobs FOR ALL USING (true);
CREATE POLICY "Service role full access" ON partner_export_limits FOR ALL USING (true);

-- ============================================================================
-- HELPER FUNCTION: Check daily export count
-- ============================================================================
CREATE OR REPLACE FUNCTION get_daily_export_count(p_partner_id UUID)
RETURNS INT AS $$
  SELECT COUNT(*)::INT
  FROM export_jobs
  WHERE partner_id = p_partner_id
    AND created_at::date = CURRENT_DATE;
$$ LANGUAGE sql STABLE;

-- ============================================================================
-- HELPER FUNCTION: Auto-create next month's partition
-- Schedule this via pg_cron monthly
-- ============================================================================
CREATE OR REPLACE FUNCTION create_next_month_partition()
RETURNS void AS $$
DECLARE
  next_month_start DATE;
  next_month_end DATE;
  partition_name TEXT;
BEGIN
  next_month_start := date_trunc('month', NOW() + interval '2 months')::date;
  next_month_end := (next_month_start + interval '1 month')::date;
  partition_name := 'pos_transactions_' || to_char(next_month_start, 'YYYY_MM');

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF pos_transactions FOR VALUES FROM (%L) TO (%L)',
    partition_name, next_month_start, next_month_end
  );

  RAISE NOTICE 'Created partition: % (% to %)', partition_name, next_month_start, next_month_end;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SEED: Example partner + API key (for testing)
-- ============================================================================
-- INSERT INTO partners (name, business_name, email, phone, status)
-- VALUES ('Test Partner', 'Test Corp', 'partner@test.com', '9999999999', 'active')
-- RETURNING id;
--
-- -- Use the returned partner_id:
-- INSERT INTO partner_api_keys (partner_id, api_key, api_secret, label, permissions)
-- VALUES (
--   '<partner_id>',
--   'pk_live_' || encode(gen_random_bytes(24), 'hex'),
--   'sk_live_' || encode(gen_random_bytes(32), 'hex'),
--   'Production Key',
--   '["read", "export"]'
-- );

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON TABLE partners IS 'External partner organizations consuming the POS Partner API';
COMMENT ON TABLE partner_retailers IS 'Retailers mapped under a partner for POS transactions';
COMMENT ON TABLE partner_pos_machines IS 'Physical POS terminal devices mapped to partner + retailer';
COMMENT ON TABLE pos_transactions IS 'Partitioned POS transaction table - partitioned monthly by txn_time';
COMMENT ON TABLE partner_api_keys IS 'HMAC-based API authentication keys for partners';
COMMENT ON TABLE export_jobs IS 'Async export job queue for partner data exports';
COMMENT ON TABLE partner_export_limits IS 'Daily/monthly export quotas per partner';


