-- Portal Settings & Audit Log Tables
-- Run this in Supabase SQL editor

-- Service settings table (stores on/off state and active provider per service)
CREATE TABLE IF NOT EXISTS portal_settings (
  service_key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  active_provider TEXT NOT NULL DEFAULT 'internal',
  updated_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Audit log for all portal management changes
CREATE TABLE IF NOT EXISTS portal_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_key TEXT NOT NULL,
  action TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  performed_by TEXT NOT NULL,
  performed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_audit_performed_at ON portal_audit_log(performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_audit_service_key ON portal_audit_log(service_key);

-- Seed default settings for all services
INSERT INTO portal_settings (service_key, enabled, active_provider) VALUES
  ('__master__',       true, 'system'),
  ('bbps',             true, 'chagans'),
  ('aeps',             true, 'chagans'),
  ('payout',           true, 'sparkup'),
  ('mini_atm_pos',     true, 'internal'),
  ('aadhaar_pay',      true, 'chagans'),
  ('recharge',         true, 'sparkup'),
  ('travel',           false, 'internal'),
  ('cash_management',  true, 'internal'),
  ('lic',              true, 'chagans'),
  ('insurance',        false, 'internal')
ON CONFLICT (service_key) DO NOTHING;

-- Enable RLS
ALTER TABLE portal_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_audit_log ENABLE ROW LEVEL SECURITY;

-- Admin-only policies
CREATE POLICY "Admin full access on portal_settings"
  ON portal_settings FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Admin full access on portal_audit_log"
  ON portal_audit_log FOR ALL
  USING (true)
  WITH CHECK (true);
