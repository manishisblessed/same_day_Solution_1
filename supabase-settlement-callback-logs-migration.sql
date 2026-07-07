-- Settlement Callback Logs
-- Tracks every callback delivery attempt for audit & debugging

CREATE TABLE IF NOT EXISTS settlement_callback_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id UUID NOT NULL,
  partner_id UUID NOT NULL,
  webhook_url TEXT NOT NULL,
  event TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  status TEXT NOT NULL,
  http_status INTEGER,
  success BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scl_reference ON settlement_callback_logs(reference_id);
CREATE INDEX idx_scl_partner ON settlement_callback_logs(partner_id);
CREATE INDEX idx_scl_created ON settlement_callback_logs(created_at DESC);

ALTER TABLE settlement_callback_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON settlement_callback_logs FOR ALL USING (true);

COMMENT ON TABLE settlement_callback_logs IS 'Audit log for settlement webhook callback delivery attempts';
