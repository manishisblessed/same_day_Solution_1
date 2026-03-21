-- Subscription Auto-Debit Cron Settings (same pattern as t1_cron_settings)
-- Run after supabase-migration-pos-brand-and-subscriptions.sql

CREATE TABLE IF NOT EXISTS subscription_cron_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_hour INTEGER NOT NULL DEFAULT 6 CHECK (schedule_hour >= 0 AND schedule_hour <= 23),
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

INSERT INTO subscription_cron_settings (schedule_hour, schedule_minute, timezone, is_enabled)
SELECT 6, 0, 'Asia/Kolkata', true
WHERE NOT EXISTS (SELECT 1 FROM subscription_cron_settings);

CREATE OR REPLACE FUNCTION update_subscription_cron_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_subscription_cron_settings_updated_at ON subscription_cron_settings;
CREATE TRIGGER update_subscription_cron_settings_updated_at
  BEFORE UPDATE ON subscription_cron_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_subscription_cron_settings_updated_at();

ALTER TABLE subscription_cron_settings ENABLE ROW LEVEL SECURITY;
