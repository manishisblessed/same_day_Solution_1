-- ============================================================================
-- Rename POS brands to bank-suffixed labels + split Avika into two brands
-- ============================================================================
-- Standardizes every brand/fleet/company display name to the "NAME - BANK"
-- format used across all POS surfaces (transactions, machines, reports,
-- reconciliation, Brands & Vendor Rates):
--
--   ashvam        -> ASHVAM
--   teachway      -> TEACHWAY - AXIS
--   newscenaric   -> NEW SCENARIC - HDFC
--   lagoon        -> LAGOON - HDFC
--   samedaytours  -> SAMEDAY - HDFC
--   avika (HDFC)  -> AVIKA - HDFC   (keeps key='avika' = canonical merchant_slug)
--   avika (Axis)  -> AVIKA - AXIS   (NEW brand row, key='avika-axis')
--
-- Brand KEYS are left unchanged (except the new avika-axis) so merchant_slug ->
-- brand MDR resolution (getBrandIdByKey) keeps working. The Avika fleet split
-- remains driven at read-time by pos_machines.brand (see lib/pos/machine-group).
--
-- Idempotent + safe to re-run. The runner wraps each file in its own
-- transaction, so no explicit BEGIN/COMMIT here.
-- ============================================================================

-- ── 1. Rename existing brand display names (keys unchanged) ──────────────────
UPDATE brands SET name = 'ASHVAM',             short_name = 'ASHVAM'             WHERE key = 'ashvam';
UPDATE brands SET name = 'TEACHWAY - AXIS',     short_name = 'TEACHWAY - AXIS'     WHERE key = 'teachway';
UPDATE brands SET name = 'NEW SCENARIC - HDFC', short_name = 'NEW SCENARIC - HDFC' WHERE key = 'newscenaric';
UPDATE brands SET name = 'LAGOON - HDFC',       short_name = 'LAGOON - HDFC'       WHERE key = 'lagoon';
UPDATE brands SET name = 'SAMEDAY - HDFC',      short_name = 'SAMEDAY - HDFC'      WHERE key = 'samedaytours';
-- Avika (HDFC) keeps key='avika' as the canonical merchant_slug for captures.
UPDATE brands SET name = 'AVIKA - HDFC',        short_name = 'AVIKA - HDFC'        WHERE key = 'avika';

-- ── 2. Split: create the Avika-Axis brand (own rate card in Brands & Rates) ──
INSERT INTO brands (key, name, short_name, settlement_mode)
VALUES ('avika-axis', 'AVIKA - AXIS', 'AVIKA - AXIS', 'T1')
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, short_name = EXCLUDED.short_name;

-- ── 3. Normalize the free-text fleet tag on machines to the new format ───────
--      Matches legacy 'AVIKA-AXIS'/'AVIKA-HDFC' (and spaced variants).
UPDATE pos_machines SET brand = 'AVIKA - AXIS' WHERE brand ILIKE '%AVIKA%AXIS%' AND brand <> 'AVIKA - AXIS';
UPDATE pos_machines SET brand = 'AVIKA - HDFC' WHERE brand ILIKE '%AVIKA%HDFC%' AND brand <> 'AVIKA - HDFC';

-- ── 4. Re-link machines to the correct brand_id by fleet ─────────────────────
UPDATE pos_machines
   SET brand_id = (SELECT id FROM brands WHERE key = 'avika-axis')
 WHERE brand = 'AVIKA - AXIS';

UPDATE pos_machines
   SET brand_id = (SELECT id FROM brands WHERE key = 'avika')
 WHERE brand = 'AVIKA - HDFC';
