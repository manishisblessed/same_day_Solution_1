-- Settlement alerts: records transactions the T+1 cron could NOT settle
-- (e.g. missing MDR rate for the retailer's scheme) so admins are notified
-- instead of settlements silently failing.

CREATE TABLE IF NOT EXISTS settlement_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL DEFAULT 'MDR_RATE_MISSING',
  retailer_id TEXT NOT NULL,
  txn_id TEXT NOT NULL,
  amount NUMERIC(14,2),
  reason TEXT,
  details JSONB,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT
);

-- One OPEN alert per transaction (repeat failures update last_seen_at instead)
CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_alerts_open_txn
  ON settlement_alerts (txn_id) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_settlement_alerts_status
  ON settlement_alerts (status, created_at DESC);
