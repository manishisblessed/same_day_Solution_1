-- T+1 SETTLEMENT CRON SETTINGS & PER-RETAILER PAUSE MIGRATION
-- Run this migration to enable admin-controlled T+1 settlement scheduling

-- 1. Create t1_cron_settings table (single-row config)
CREATE TABLE IF NOT EXISTS t1_cron_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_hour INTEGER NOT NULL DEFAULT 7 CHECK (schedule_hour >= 0 AND schedule_hour <= 23),
  schedule_minute INTEGER NOT NULL DEFAULT 0 CHECK (schedule_minute >= 0 AND schedule_minute <= 59),
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT CHECK (last_run_status IN ('success', 'partial', 'failed')),
  last_run_message TEXT,
  last_run_processed INTEGER DEFAULT 0,
  last_run_failed INTEGER DEFAULT 0,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default settings (7:00 AM IST, enabled)
INSERT INTO t1_cron_settings (schedule_hour, schedule_minute, timezone, is_enabled)
SELECT 7, 0, 'Asia/Kolkata', true
WHERE NOT EXISTS (SELECT 1 FROM t1_cron_settings);

-- 2. Add t1_settlement_paused to retailers table
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS t1_settlement_paused BOOLEAN DEFAULT FALSE;
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS t1_settlement_paused_at TIMESTAMPTZ;
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS t1_settlement_paused_by TEXT;

-- 3. Add t1_settlement_paused to distributors table (for partners)
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS t1_settlement_paused BOOLEAN DEFAULT FALSE;
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS t1_settlement_paused_at TIMESTAMPTZ;
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS t1_settlement_paused_by TEXT;

-- 4. Updated_at trigger for t1_cron_settings
CREATE OR REPLACE FUNCTION update_t1_cron_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_t1_cron_settings_updated_at ON t1_cron_settings;
CREATE TRIGGER update_t1_cron_settings_updated_at
  BEFORE UPDATE ON t1_cron_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_t1_cron_settings_updated_at();

-- 5. Enable RLS
ALTER TABLE t1_cron_settings ENABLE ROW LEVEL SECURITY;

-- 6. Index for fast lookup on paused retailers
CREATE INDEX IF NOT EXISTS idx_retailers_t1_paused ON retailers(t1_settlement_paused) WHERE t1_settlement_paused = TRUE;
CREATE INDEX IF NOT EXISTS idx_distributors_t1_paused ON distributors(t1_settlement_paused) WHERE t1_settlement_paused = TRUE;

-- 7. Settlement mode assignment per retailer/distributor
-- 'T1' = only T+1 auto-settlement (default, no Pulse Pay button)
-- 'T0_T1' = both T+0 Pulse Pay + T+1 auto-settlement (Pulse Pay button visible)
ALTER TABLE retailers ADD COLUMN IF NOT EXISTS settlement_mode_allowed TEXT DEFAULT 'T1' CHECK (settlement_mode_allowed IN ('T1', 'T0_T1'));
ALTER TABLE distributors ADD COLUMN IF NOT EXISTS settlement_mode_allowed TEXT DEFAULT 'T1' CHECK (settlement_mode_allowed IN ('T1', 'T0_T1'));
CREATE INDEX IF NOT EXISTS idx_retailers_settlement_mode ON retailers(settlement_mode_allowed);
CREATE INDEX IF NOT EXISTS idx_distributors_settlement_mode ON distributors(settlement_mode_allowed);
