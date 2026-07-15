-- ============================================================================
-- Extend settlement_alerts to cover partner settlement failures
-- ============================================================================
-- Partner settlements now run through a validation gate; when a transaction
-- fails a check (no scheme, bad status, etc.) we raise an alert so admins see
-- exactly why it didn't settle. Alerts can be for a retailer OR a partner.
--
-- Run in Supabase SQL Editor
-- ============================================================================

ALTER TABLE settlement_alerts ALTER COLUMN retailer_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'settlement_alerts' AND column_name = 'partner_id') THEN
    ALTER TABLE settlement_alerts ADD COLUMN partner_id TEXT;
  END IF;
END $$;

COMMENT ON COLUMN settlement_alerts.partner_id IS 'Set when the alert is for a partner settlement failure (retailer_id is then NULL).';
