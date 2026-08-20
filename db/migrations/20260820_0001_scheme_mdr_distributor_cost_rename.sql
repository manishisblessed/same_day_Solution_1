-- ============================================================================
-- Disambiguate scheme_mdr_rates.distributor_mdr_* -> distributor_cost_mdr_*
-- ============================================================================
-- WHY: `distributor_mdr_t1/t0` is overloaded. In the CASCADE model
-- (scheme_mdr_rates) it is the distributor's COST/buy rate (the distributor
-- EARNS retailer_mdr − this). In the legacy tables (retailer_schemes /
-- global_schemes) the identically-named field is the distributor's EARN rate.
-- The shared name has caused real mis-payments. This migration introduces an
-- unambiguous canonical column on the cascade table WITHOUT breaking any
-- existing reader/writer.
--
-- STRATEGY (zero-downtime, fully reversible):
--   1. Add distributor_cost_mdr_t1/t0 (nullable).
--   2. Backfill from the legacy-named columns.
--   3. A BEFORE INSERT/UPDATE trigger keeps the two in sync in BOTH directions,
--      so old code (writes distributor_mdr_*) and new code (reads
--      distributor_cost_mdr_*) both work during the transition.
--
-- A LATER, separate migration can drop the old columns once every reader/writer
-- has been cut over and verified in production.
--
-- Idempotent. Forward-only copy for the deploy pipeline (db/migrations).
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'scheme_mdr_rates' AND column_name = 'distributor_cost_mdr_t1') THEN
    ALTER TABLE scheme_mdr_rates ADD COLUMN distributor_cost_mdr_t1 NUMERIC(6,4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'scheme_mdr_rates' AND column_name = 'distributor_cost_mdr_t0') THEN
    ALTER TABLE scheme_mdr_rates ADD COLUMN distributor_cost_mdr_t0 NUMERIC(6,4);
  END IF;
END $$;

COMMENT ON COLUMN scheme_mdr_rates.distributor_cost_mdr_t1 IS
  'Canonical: distributor COST/buy rate (T+1). Distributor EARNS retailer_mdr_t1 - this. Replaces the ambiguous distributor_mdr_t1.';
COMMENT ON COLUMN scheme_mdr_rates.distributor_cost_mdr_t0 IS
  'Canonical: distributor COST/buy rate (T+0). Distributor EARNS retailer_mdr_t0 - this. Replaces the ambiguous distributor_mdr_t0.';
COMMENT ON COLUMN scheme_mdr_rates.distributor_mdr_t1 IS
  'DEPRECATED alias of distributor_cost_mdr_t1 (kept in sync by trigger). Do not read for payout logic.';
COMMENT ON COLUMN scheme_mdr_rates.distributor_mdr_t0 IS
  'DEPRECATED alias of distributor_cost_mdr_t0 (kept in sync by trigger). Do not read for payout logic.';

-- 2. Backfill new from old (only where new is still empty).
UPDATE scheme_mdr_rates
SET distributor_cost_mdr_t1 = COALESCE(distributor_cost_mdr_t1, distributor_mdr_t1),
    distributor_cost_mdr_t0 = COALESCE(distributor_cost_mdr_t0, distributor_mdr_t0)
WHERE distributor_cost_mdr_t1 IS NULL OR distributor_cost_mdr_t0 IS NULL;

-- 3. Two-way sync trigger. Whichever column a writer set (old or new), the other
--    is made to match, so both naming conventions stay consistent during rollout.
CREATE OR REPLACE FUNCTION public.sync_scheme_mdr_distributor_cost()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.distributor_cost_mdr_t1 := COALESCE(NEW.distributor_cost_mdr_t1, NEW.distributor_mdr_t1);
    NEW.distributor_cost_mdr_t0 := COALESCE(NEW.distributor_cost_mdr_t0, NEW.distributor_mdr_t0);
    NEW.distributor_mdr_t1 := COALESCE(NEW.distributor_mdr_t1, NEW.distributor_cost_mdr_t1, 0);
    NEW.distributor_mdr_t0 := COALESCE(NEW.distributor_mdr_t0, NEW.distributor_cost_mdr_t0, 0);
    RETURN NEW;
  END IF;

  -- UPDATE: prefer whichever side actually changed; else keep them equal.
  IF NEW.distributor_cost_mdr_t1 IS DISTINCT FROM OLD.distributor_cost_mdr_t1 THEN
    NEW.distributor_mdr_t1 := NEW.distributor_cost_mdr_t1;
  ELSIF NEW.distributor_mdr_t1 IS DISTINCT FROM OLD.distributor_mdr_t1 THEN
    NEW.distributor_cost_mdr_t1 := NEW.distributor_mdr_t1;
  END IF;

  IF NEW.distributor_cost_mdr_t0 IS DISTINCT FROM OLD.distributor_cost_mdr_t0 THEN
    NEW.distributor_mdr_t0 := NEW.distributor_cost_mdr_t0;
  ELSIF NEW.distributor_mdr_t0 IS DISTINCT FROM OLD.distributor_mdr_t0 THEN
    NEW.distributor_cost_mdr_t0 := NEW.distributor_mdr_t0;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_scheme_mdr_distributor_cost ON scheme_mdr_rates;
CREATE TRIGGER trg_sync_scheme_mdr_distributor_cost
  BEFORE INSERT OR UPDATE ON scheme_mdr_rates
  FOR EACH ROW EXECUTE FUNCTION public.sync_scheme_mdr_distributor_cost();
