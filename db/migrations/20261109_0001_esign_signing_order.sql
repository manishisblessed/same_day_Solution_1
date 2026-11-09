-- Add signing_order column to esign_invitees for sequential multi-party signing
ALTER TABLE esign_invitees ADD COLUMN IF NOT EXISTS signing_order INTEGER DEFAULT 1;
