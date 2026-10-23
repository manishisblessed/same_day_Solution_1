-- ============================================================================
-- Rename SAMEDAY - HDFC > SAMEDAY T&T - HDFC in brands table + machines
-- ============================================================================
-- Idempotent + safe to re-run.
-- ============================================================================

UPDATE brands
   SET name = 'SAMEDAY T&T - HDFC', short_name = 'SAMEDAY T&T - HDFC'
 WHERE key = 'samedaytours';

UPDATE pos_machines
   SET brand = 'SAMEDAY T&T - HDFC'
 WHERE brand = 'SAMEDAY - HDFC';
