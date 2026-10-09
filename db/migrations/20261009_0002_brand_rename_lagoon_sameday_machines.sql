-- ============================================================================
-- Normalize remaining company machine brand tags to the new labels
-- ============================================================================
-- Companion to 20261009_0001. Those machines carried company-identifiable
-- free-text brand tags that must adopt the new "NAME - BANK" labels:
--
--   'Lagoon (Paytm)' / 'Paytm-Lagoon'  -> LAGOON - HDFC   (key=lagoon)
--   'HDFC-SAMEDAY'                      -> SAMEDAY - HDFC  (key=samedaytours)
--
-- Generic provider tags ('Razorpay', 'AXIS') are intentionally LEFT untouched —
-- they are not tied to a single company and their owner is resolved via the
-- machine's assignment / the transaction merchant_slug, not this free-text tag.
--
-- Idempotent + safe to re-run.
-- ============================================================================

UPDATE pos_machines SET brand = 'LAGOON - HDFC'
 WHERE brand ILIKE '%LAGOON%' AND brand <> 'LAGOON - HDFC';

UPDATE pos_machines SET brand = 'SAMEDAY - HDFC'
 WHERE brand ILIKE '%SAMEDAY%' AND brand <> 'SAMEDAY - HDFC';

UPDATE pos_machines
   SET brand_id = (SELECT id FROM brands WHERE key = 'lagoon')
 WHERE brand = 'LAGOON - HDFC';

UPDATE pos_machines
   SET brand_id = (SELECT id FROM brands WHERE key = 'samedaytours')
 WHERE brand = 'SAMEDAY - HDFC';
