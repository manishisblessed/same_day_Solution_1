-- Partner settlement / payout API access flag (POS Partner API admin tab)
ALTER TABLE partners
ADD COLUMN IF NOT EXISTS settlement_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN partners.settlement_enabled IS 'Allow partner to use Payout/Settlement Partner API (wallet transfers)';
