-- ============================================================================
-- MASTER CHANNEL PARTNER (MCP) MIGRATION
-- ============================================================================
-- Introduces a "Master Channel Partner" tier that sits ABOVE partners:
--   * A master channel partner IS a partners row with is_master_partner = true.
--     It reuses the entire partner stack (partner_wallets, partner_wallet_ledger,
--     <service>_enabled columns, and every /api/partner/* service route), so it
--     can transact and spend its wallet exactly like a normal partner.
--   * Child partners point back to it via partners.master_partner_id.
--   * The master channel partner earns a POS-ONLY override commission on each
--     POS T+1 settlement of its child partners. The commission is a FLAT ₹ per
--     transaction, resolved from a slab set (matched by the transaction amount)
--     that admin assigns per child partner. No commission on BBPS/payout/etc.
--   * The override is credited into the master partner's SAME partner_wallets
--     balance (unified with its spendable balance).
--
-- Run in Supabase SQL Editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. partners: master-partner flag + parent link
-- ----------------------------------------------------------------------------
ALTER TABLE partners ADD COLUMN IF NOT EXISTS is_master_partner BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS master_partner_id UUID REFERENCES partners(id);

CREATE INDEX IF NOT EXISTS idx_partners_is_master_partner ON partners(is_master_partner) WHERE is_master_partner = true;
CREATE INDEX IF NOT EXISTS idx_partners_master_partner_id ON partners(master_partner_id) WHERE master_partner_id IS NOT NULL;

COMMENT ON COLUMN partners.is_master_partner IS
  'True if this partner is a Master Channel Partner (parent tier that earns POS override on its child partners).';
COMMENT ON COLUMN partners.master_partner_id IS
  'The Master Channel Partner (partners.id, is_master_partner=true) that this partner reports under. NULL = direct partner.';

-- ----------------------------------------------------------------------------
-- 2. Master partner commission schemes (a named set of amount slabs)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS master_partner_schemes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE master_partner_schemes IS
  'Admin-defined POS commission schemes for Master Channel Partners. Each scheme owns a set of flat-fee amount slabs.';

-- Flat-fee amount slabs for a scheme: matched by per-transaction gross amount.
CREATE TABLE IF NOT EXISTS master_partner_scheme_slabs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  scheme_id UUID NOT NULL REFERENCES master_partner_schemes(id) ON DELETE CASCADE,
  min_amount DECIMAL(12, 2) NOT NULL,
  max_amount DECIMAL(12, 2) NOT NULL,
  charge DECIMAL(12, 2) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (min_amount >= 0),
  CHECK (max_amount > min_amount),
  CHECK (charge >= 0)
);

CREATE INDEX IF NOT EXISTS idx_mcp_scheme_slabs_scheme ON master_partner_scheme_slabs(scheme_id);
CREATE INDEX IF NOT EXISTS idx_mcp_scheme_slabs_amounts ON master_partner_scheme_slabs(min_amount, max_amount);

COMMENT ON TABLE master_partner_scheme_slabs IS
  'Flat ₹ commission slabs for a master partner scheme. A POS txn picks the slab where min_amount <= gross <= max_amount.';

-- ----------------------------------------------------------------------------
-- 3. Per-child-partner scheme assignment (admin-managed)
-- ----------------------------------------------------------------------------
-- Assigns a scheme to each child partner under a master partner. A child
-- partner belongs to at most one master partner + scheme (UNIQUE on partner_id).
CREATE TABLE IF NOT EXISTS master_partner_partner_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  master_partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  scheme_id UUID NOT NULL REFERENCES master_partner_schemes(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(partner_id)
);

CREATE INDEX IF NOT EXISTS idx_mcp_assignments_master ON master_partner_partner_assignments(master_partner_id);
CREATE INDEX IF NOT EXISTS idx_mcp_assignments_partner ON master_partner_partner_assignments(partner_id);
CREATE INDEX IF NOT EXISTS idx_mcp_assignments_scheme ON master_partner_partner_assignments(scheme_id);

COMMENT ON TABLE master_partner_partner_assignments IS
  'Maps each child partner to its Master Channel Partner + the commission scheme used to compute the master partner override.';

-- ----------------------------------------------------------------------------
-- 4. Per-transaction master partner commission tracking on POS transactions
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'master_partner_commission_credited') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN master_partner_commission_credited BOOLEAN NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'master_partner_commission_id') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN master_partner_commission_id UUID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'master_partner_commission_amount') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN master_partner_commission_amount DECIMAL(12, 2);
  END IF;
END $$;

COMMENT ON COLUMN razorpay_pos_transactions.master_partner_commission_credited IS
  'True once the per-transaction Master Channel Partner override has been written (or intentionally skipped).';
COMMENT ON COLUMN razorpay_pos_transactions.master_partner_commission_id IS
  'partner_wallet_ledger id of the master partner override credit for this transaction.';

-- Never retro-pay override on transactions already settled to the partner before
-- this feature existed: mark all currently partner-settled rows as handled.
UPDATE razorpay_pos_transactions
SET master_partner_commission_credited = true
WHERE partner_wallet_credited = true AND master_partner_commission_credited = false;

-- ----------------------------------------------------------------------------
-- 5. RLS (service role full access; app uses the service role key)
-- ----------------------------------------------------------------------------
ALTER TABLE master_partner_schemes ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_partner_scheme_slabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_partner_partner_assignments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'master_partner_schemes' AND policyname = 'Service role full access') THEN
    CREATE POLICY "Service role full access" ON master_partner_schemes FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'master_partner_scheme_slabs' AND policyname = 'Service role full access') THEN
    CREATE POLICY "Service role full access" ON master_partner_scheme_slabs FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'master_partner_partner_assignments' AND policyname = 'Service role full access') THEN
    CREATE POLICY "Service role full access" ON master_partner_partner_assignments FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 6. updated_at triggers
-- ----------------------------------------------------------------------------
DO $$
DECLARE tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'master_partner_schemes',
    'master_partner_scheme_slabs',
    'master_partner_partner_assignments'
  ])
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I;
       CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();',
      tbl, tbl, tbl, tbl
    );
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 7. Helper: resolve the flat commission for a (partner, amount) pair
-- ----------------------------------------------------------------------------
-- Returns the flat ₹ master-partner commission for a given child partner and
-- transaction amount, using the partner's active assignment + scheme slab.
-- Returns 0 when the partner has no active assignment / no matching slab.
CREATE OR REPLACE FUNCTION get_master_partner_commission(
  p_partner_id UUID,
  p_amount DECIMAL(12, 2)
)
RETURNS TABLE(master_partner_id UUID, commission DECIMAL(12, 2)) AS $$
BEGIN
  RETURN QUERY
  SELECT a.master_partner_id,
         COALESCE(s.charge, 0)::DECIMAL(12, 2)
  FROM master_partner_partner_assignments a
  JOIN master_partner_schemes sc ON sc.id = a.scheme_id AND sc.status = 'active'
  LEFT JOIN LATERAL (
    SELECT charge FROM master_partner_scheme_slabs
    WHERE scheme_id = a.scheme_id
      AND is_active = true
      AND min_amount <= p_amount
      AND max_amount >= p_amount
    ORDER BY charge ASC
    LIMIT 1
  ) s ON true
  WHERE a.partner_id = p_partner_id
    AND a.status = 'active'
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_master_partner_commission(UUID, DECIMAL) TO service_role;
