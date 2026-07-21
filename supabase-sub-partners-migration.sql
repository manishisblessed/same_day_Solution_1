-- Sub-Partners Migration
-- Allows partner accounts to create team members (sub-partners)
-- with individual logins and role-based permissions.

-- 1. Create sub_partners table
CREATE TABLE IF NOT EXISTS sub_partners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  designation TEXT DEFAULT 'Operator',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'suspended')),
  permissions JSONB NOT NULL DEFAULT '{
    "dashboard": true,
    "wallet": false,
    "transactions": true,
    "ledger": false,
    "services": false,
    "bbps": false,
    "bbps-2": false,
    "credit-card": false,
    "credit-card-2": false,
    "payout": false,
    "settlement-2": false,
    "aeps": false,
    "aeps-ledger": false,
    "pos-machines": false,
    "subscriptions": false,
    "mdr-schemes": false,
    "reports": false,
    "api-dashboard": false,
    "analytics": false,
    "reconciliation": false,
    "api-management": false,
    "settings": false,
    "sub-partners": false
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_sub_partners_parent ON sub_partners(parent_partner_id);
CREATE INDEX IF NOT EXISTS idx_sub_partners_email ON sub_partners(email);
CREATE INDEX IF NOT EXISTS idx_sub_partners_status ON sub_partners(status);

-- 3. Add sub_partner columns to partners table
ALTER TABLE partners ADD COLUMN IF NOT EXISTS sub_partner_limit INTEGER DEFAULT 5;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS sub_partners_enabled BOOLEAN DEFAULT false;

-- 4. Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_sub_partners_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sub_partners_updated_at ON sub_partners;
CREATE TRIGGER trg_sub_partners_updated_at
  BEFORE UPDATE ON sub_partners
  FOR EACH ROW
  EXECUTE FUNCTION update_sub_partners_updated_at();

-- 5. RLS policies
ALTER TABLE sub_partners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on sub_partners"
  ON sub_partners FOR ALL
  USING (true)
  WITH CHECK (true);
