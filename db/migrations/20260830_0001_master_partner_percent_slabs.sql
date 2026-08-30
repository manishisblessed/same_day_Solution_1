-- ============================================================================
-- MASTER PARTNER SCHEME SLABS: PERCENTAGE COMMISSION SUPPORT
-- ============================================================================
-- Extends master_partner_scheme_slabs so each slab can be either:
--   * rate_type = 'flat'    -> flat ₹ `charge` per transaction (legacy behaviour)
--   * rate_type = 'percent' -> `commission_percent` % of the transaction amount
--
-- Existing slabs default to 'flat' so nothing changes for already-created
-- schemes. The master partner override in the POS T+1 settlement stays capped
-- at the company's own MDR margin on each transaction.
-- ============================================================================

-- 1. New columns ------------------------------------------------------------
ALTER TABLE master_partner_scheme_slabs
  ADD COLUMN IF NOT EXISTS rate_type TEXT NOT NULL DEFAULT 'flat';

ALTER TABLE master_partner_scheme_slabs
  ADD COLUMN IF NOT EXISTS commission_percent DECIMAL(5, 2);

-- 2. Constraints (guarded so re-runs don't error) ---------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_mcp_slab_rate_type') THEN
    ALTER TABLE master_partner_scheme_slabs
      ADD CONSTRAINT chk_mcp_slab_rate_type CHECK (rate_type IN ('flat', 'percent'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_mcp_slab_percent_range') THEN
    ALTER TABLE master_partner_scheme_slabs
      ADD CONSTRAINT chk_mcp_slab_percent_range
      CHECK (commission_percent IS NULL OR (commission_percent >= 0 AND commission_percent <= 100));
  END IF;

  -- A percent slab must carry a percent value.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_mcp_slab_percent_present') THEN
    ALTER TABLE master_partner_scheme_slabs
      ADD CONSTRAINT chk_mcp_slab_percent_present
      CHECK (rate_type <> 'percent' OR commission_percent IS NOT NULL);
  END IF;
END $$;

COMMENT ON COLUMN master_partner_scheme_slabs.rate_type IS
  'How this slab computes the master partner override: flat = flat rupee charge, percent = commission_percent %% of txn amount.';
COMMENT ON COLUMN master_partner_scheme_slabs.commission_percent IS
  'Percentage (0-100) of the transaction amount credited to the master partner when rate_type = percent.';

-- 3. Helper function: resolve commission for a (partner, amount) pair --------
-- Now returns a flat charge OR amount * percent / 100 depending on slab type.
CREATE OR REPLACE FUNCTION get_master_partner_commission(
  p_partner_id UUID,
  p_amount DECIMAL(12, 2)
)
RETURNS TABLE(master_partner_id UUID, commission DECIMAL(12, 2)) AS $$
BEGIN
  RETURN QUERY
  SELECT a.master_partner_id,
         COALESCE(s.commission, 0)::DECIMAL(12, 2)
  FROM master_partner_partner_assignments a
  JOIN master_partner_schemes sc ON sc.id = a.scheme_id AND sc.status = 'active'
  LEFT JOIN LATERAL (
    SELECT CASE
             WHEN rate_type = 'percent'
               THEN ROUND(p_amount * COALESCE(commission_percent, 0) / 100.0, 2)
             ELSE charge
           END AS commission
    FROM master_partner_scheme_slabs
    WHERE scheme_id = a.scheme_id
      AND is_active = true
      AND min_amount <= p_amount
      AND max_amount >= p_amount
    ORDER BY commission ASC
    LIMIT 1
  ) s ON true
  WHERE a.partner_id = p_partner_id
    AND a.status = 'active'
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_master_partner_commission(UUID, DECIMAL) TO service_role;
