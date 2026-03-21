-- Allow any brand label on pos_machines (matches bulk CSV: Ingenico, PAX, Verifone, etc.)
-- Older DBs may still have: CHECK (brand IN ('RAZORPAY', ...)) from supabase-pos-add-mid-tid-brand-migration.sql
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.oid, c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'pos_machines'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%brand%'
  LOOP
    EXECUTE format('ALTER TABLE pos_machines DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;
