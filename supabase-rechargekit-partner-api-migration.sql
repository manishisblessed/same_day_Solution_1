-- Migration: Add rechargekit_cc_enabled flag for Partner API access
-- This controls partner HMAC API access to /api/partner/rechargekit/* endpoints
-- (Separate from credit_card2_enabled which controls dashboard UI access)

ALTER TABLE partners ADD COLUMN IF NOT EXISTS rechargekit_cc_enabled BOOLEAN DEFAULT false;
