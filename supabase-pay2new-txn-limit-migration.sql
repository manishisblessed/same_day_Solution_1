-- Migration: configurable Pay2New / Credit Card max transaction limit
-- Replaces the previously hardcoded ₹2,00,000 ceiling with admin-controlled limits:
--   1. GLOBAL (application flow — retailers & partners in the portal): stored in
--      portal_settings under service_key 'pay2new_app_max_amount' (managed from
--      Admin → Settings → Limits). No schema change needed for this part.
--   2. PER-PARTNER (Partner API flow): partners.api_max_txn_amount overrides the
--      global cap for a specific partner's API transactions. NULL = use global.

ALTER TABLE partners ADD COLUMN IF NOT EXISTS api_max_txn_amount NUMERIC;

COMMENT ON COLUMN partners.api_max_txn_amount IS
  'Maximum single transaction amount (₹) permitted via the Partner API for this partner. NULL = fall back to the global Pay2New limit (portal_settings.pay2new_app_max_amount).';

-- Seed the global default (₹2,00,000) if not already present.
INSERT INTO portal_settings (service_key, enabled, active_provider, updated_by, updated_at)
VALUES ('pay2new_app_max_amount', true, '200000', 'system', NOW())
ON CONFLICT (service_key) DO NOTHING;
