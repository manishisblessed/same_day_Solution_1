-- ============================================================================
-- Partner settlement start date (guards against paying historical transactions)
-- ============================================================================
-- When a partner is enabled for auto settlement, only transactions captured on
-- or after t1_settlement_start_at are ever settled (T+1 cron, Pulse Pay, or
-- Instant). Transactions before this date are the partner's for ownership /
-- reporting, but are never auto-credited — this prevents a large historical
-- backlog from being paid out in one go when settlement is first switched on.
--
-- NULL = no restriction (settle from any date) — keeps older partners working
-- exactly as before.
--
-- Run in Supabase SQL Editor
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'partners' AND column_name = 't1_settlement_start_at') THEN
    ALTER TABLE partners ADD COLUMN t1_settlement_start_at TIMESTAMPTZ;
  END IF;
END $$;

COMMENT ON COLUMN partners.t1_settlement_start_at IS 'Only transactions captured on/after this timestamp are auto-settled (T+1 / Pulse Pay / Instant). NULL = no restriction. Set when partner settlement is first enabled to avoid paying out historical backlog.';
