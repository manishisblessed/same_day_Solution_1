-- Migration: Add status_api_enabled column (Partner Transaction Status / Reconciliation API)
--
-- Dedicated gate for the bulk status + reconciliation endpoints:
--   POST /api/partner/pay2new/bill/status/bulk
--   POST /api/partner/settlement/status/bulk
--   POST /api/partner/transactions/summary
--
-- When FALSE (default), the partner cannot read transaction status via the API
-- even if BBPS-2 / Settlement-2 are enabled — they get a clear "option disabled,
-- contact support" error. Admin enables it per partner from the POS Partner API tab.

-- PARTNERS (the only actor that holds partner API keys)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS status_api_enabled BOOLEAN NOT NULL DEFAULT false;

-- INDEX
CREATE INDEX IF NOT EXISTS idx_partners_status_api_enabled ON partners (status_api_enabled);
