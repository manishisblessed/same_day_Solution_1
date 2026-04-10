-- ============================================================================
-- 010: Partner ↔ Merchant Links (Payout Scoping)
--
-- Maps Partner API partners (partners.id) to Same Day retailers
-- (retailers.partner_id) so each partner can only initiate payouts
-- for merchants explicitly linked to their account.
--
-- Run in Supabase SQL Editor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS partner_merchant_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  merchant_id TEXT NOT NULL,            -- retailers.partner_id (e.g. "RET001")
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(partner_id, merchant_id)
);

CREATE INDEX IF NOT EXISTS idx_pml_partner
  ON partner_merchant_links(partner_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_pml_merchant
  ON partner_merchant_links(merchant_id) WHERE is_active = true;

-- RLS --
ALTER TABLE partner_merchant_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access"
  ON partner_merchant_links FOR ALL USING (true);

-- Auto-update updated_at --
CREATE TRIGGER update_partner_merchant_links_updated_at
  BEFORE UPDATE ON partner_merchant_links
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE partner_merchant_links IS
  'Maps Partner API partners to Same Day retailers for payout scoping. '
  'Admin links a merchant_id before the partner can use it in /api/partner/payout/transfer.';
