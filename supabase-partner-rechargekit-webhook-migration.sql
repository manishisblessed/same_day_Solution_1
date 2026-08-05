-- Dedicated RechargeKit (Credit Card) callback URL per partner.
-- Separate from webhook_url (POS transactions) so partners can route CC status
-- callbacks to a different endpoint. Signing reuses the existing webhook_secret.

ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS rechargekit_webhook_url text;

COMMENT ON COLUMN partners.rechargekit_webhook_url IS
  'Partner callback URL for RechargeKit CC transaction-status webhooks (event: rechargekit.cc.status). Signed with webhook_secret. Null = no push, partner polls status.';
