-- ============================================================================
-- Partner T+1 Settlement: opt-in pause + settlement mode
-- ============================================================================
-- 1. Partners must be explicitly resumed by an admin before their POS
--    transactions are auto-settled by the T+1 cron. Run this BEFORE deploying
--    the unified T+1 cron so no partner settles unintentionally.
-- 2. Adds settlement_mode_allowed to partners:
--      'T1'      -> T+1 only (default)
--      'T0_T1'   -> Pulse Pay (partner can manually settle selected txns at
--                   T+0 MDR) + automatic T+1 for the rest
--      'INSTANT' -> every captured transaction is credited to the partner
--                   wallet immediately, net of T+0 MDR
--
-- Run in Supabase SQL Editor
-- ============================================================================

-- New partners start paused
ALTER TABLE partners ALTER COLUMN t1_settlement_paused SET DEFAULT TRUE;

-- Pause all existing partners (opt-in rollout: resume one at a time from the
-- Admin > Settlement > Partners tab)
UPDATE partners
SET t1_settlement_paused = TRUE
WHERE t1_settlement_paused IS DISTINCT FROM TRUE;

COMMENT ON COLUMN partners.t1_settlement_paused IS 'Pause T+1 auto settlement for this partner. Defaults to TRUE — admin must resume the partner to enable auto settlement.';

-- Settlement mode per partner
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'partners' AND column_name = 'settlement_mode_allowed') THEN
    ALTER TABLE partners ADD COLUMN settlement_mode_allowed TEXT NOT NULL DEFAULT 'T1'
      CHECK (settlement_mode_allowed IN ('T1', 'T0_T1', 'INSTANT'));
  END IF;
END $$;

COMMENT ON COLUMN partners.settlement_mode_allowed IS 'T1 = T+1 only, T0_T1 = Pulse Pay (manual T+0) + T+1, INSTANT = auto credit per transaction at T+0 MDR';
