-- ============================================================================
-- CA Billing: seed the remaining company invoice profiles
--
-- Pulled from the reference config files in D:\tech\invoice_python:
--   config_avika.py    -> avika, avika-axis  (same legal entity, two fleets)
--   config_sameday.py  -> samedaytours
--   config_ashvam.py   -> ashvam
--   config.py          -> newscenaric (New Scenaric Travels)
--   (teachway + lagoon already seeded in 0009)
--
-- Only fills blanks (COALESCE) — never overwrites values the CA has edited.
-- Idempotent + safe to re-run.
-- ============================================================================

DO $$
DECLARE
  v_id UUID;
  v_avika_sl JSONB := '[
    {"description":"Retail supply of grocery and daily household essentials through departmental store operations","sac":"996211","percent":22},
    {"description":"Fresh fruits, vegetables and perishable produce supplied via store and online grocery channels","sac":"996211","percent":18},
    {"description":"Dairy, bakery and refrigerated food products — retail sale and distribution","sac":"996211","percent":18},
    {"description":"Packaged foods, beverages, FMCG and convenience merchandise from departmental store inventory","sac":"996211","percent":16},
    {"description":"Online grocery order processing, packing and last-mile delivery of daily essentials across Delhi NCR","sac":"996812","percent":14},
    {"description":"In-store merchandising, inventory handling and neighborhood retail fulfilment support services","sac":"998599","percent":12}
  ]'::jsonb;
  v_sameday_sl JSONB := '[
    {"description":"BBPS (Bharat Bill Payment System) services — bill fetch, bill payment processing, and biller integration via NPCI-authorized BBPS infrastructure.","sac":"997159","percent":35},
    {"description":"Payout processing services — bulk disbursements, vendor payouts, salary transfers, and beneficiary fund transfers via IMPS / NEFT / UPI rails.","sac":"997159","percent":30},
    {"description":"Payment gateway and transaction processing — API-based collection, settlement, and reconciliation services for digital payments.","sac":"997159","percent":20},
    {"description":"Fintech platform and API integration support — onboarding, KYC/compliance module setup, and ongoing technical support for BBPS and payout APIs.","sac":"998314","percent":15}
  ]'::jsonb;
  v_newscenaric_sl JSONB := '[
    {"description":"Travel Agency Services - Ticketing & Booking","sac":"998551","percent":30},
    {"description":"Tour Operator Services - Package Arrangement","sac":"998552","percent":35},
    {"description":"Reservation Services - Hotel & Transport","sac":"998553","percent":20},
    {"description":"Service Charges & Convenience Fee","sac":"998559","percent":15}
  ]'::jsonb;
  v_ashvam_sl JSONB := '[
    {"description":"Vendor payment facilitation and financial transfer services","sac":"997159","percent":100}
  ]'::jsonb;
BEGIN
  -- ── AVIKA (HDFC fleet, key 'avika') ──────────────────────────────────────
  SELECT id INTO v_id FROM brands WHERE key = 'avika' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO ca_company_config (brand_id, legal_name, gstin)
    VALUES (v_id, 'AVIKA DEPARTMENTAL PRIVATE LIMITED', '07ABFCA7127H1ZP') ON CONFLICT (brand_id) DO NOTHING;
    UPDATE ca_company_config SET
      legal_name          = COALESCE(legal_name, 'AVIKA DEPARTMENTAL PRIVATE LIMITED'),
      gstin               = COALESCE(gstin, '07ABFCA7127H1ZP'),
      email               = COALESCE(email, 'orders@avikagrocery.com'),
      phone               = COALESCE(phone, '+91-7090601025'),
      state_code          = COALESCE(state_code, '07'),
      cin                 = COALESCE(cin, 'U47110DL2026PTC466668'),
      place_of_supply     = COALESCE(place_of_supply, 'Delhi'),
      jurisdiction        = COALESCE(jurisdiction, 'Delhi'),
      address             = COALESCE(address, '3RD FLOOR, TF-11B, EROS METRO MALL, DWARKA SECTOR-14, New Delhi, South West Delhi, Delhi'),
      bank_account_number = COALESCE(bank_account_number, '99907389599958'),
      bank_account_type   = COALESCE(bank_account_type, 'Current Account'),
      bank_holder_name    = COALESCE(bank_holder_name, 'AVIKA DEPARTMENTAL PRIVATE LIMITED'),
      bank_name           = COALESCE(bank_name, 'HDFC Bank'),
      bank_ifsc           = COALESCE(bank_ifsc, 'HDFC0000616'),
      bank_branch         = COALESCE(bank_branch, 'Delhi'),
      service_lines       = CASE WHEN service_lines = '[]'::jsonb OR service_lines IS NULL THEN v_avika_sl ELSE service_lines END
    WHERE brand_id = v_id;
  END IF;

  -- ── AVIKA (AXIS fleet, key 'avika-axis') — same legal entity ─────────────
  -- Bank defaults to the company HDFC account; CA can switch to the Axis
  -- settlement account for this fleet if different.
  SELECT id INTO v_id FROM brands WHERE key = 'avika-axis' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO ca_company_config (brand_id, legal_name, gstin)
    VALUES (v_id, 'AVIKA DEPARTMENTAL PRIVATE LIMITED', '07ABFCA7127H1ZP') ON CONFLICT (brand_id) DO NOTHING;
    UPDATE ca_company_config SET
      legal_name          = COALESCE(legal_name, 'AVIKA DEPARTMENTAL PRIVATE LIMITED'),
      gstin               = COALESCE(gstin, '07ABFCA7127H1ZP'),
      email               = COALESCE(email, 'orders@avikagrocery.com'),
      phone               = COALESCE(phone, '+91-7090601025'),
      state_code          = COALESCE(state_code, '07'),
      cin                 = COALESCE(cin, 'U47110DL2026PTC466668'),
      place_of_supply     = COALESCE(place_of_supply, 'Delhi'),
      jurisdiction        = COALESCE(jurisdiction, 'Delhi'),
      address             = COALESCE(address, '3RD FLOOR, TF-11B, EROS METRO MALL, DWARKA SECTOR-14, New Delhi, South West Delhi, Delhi'),
      bank_account_number = COALESCE(bank_account_number, '99907389599958'),
      bank_account_type   = COALESCE(bank_account_type, 'Current Account'),
      bank_holder_name    = COALESCE(bank_holder_name, 'AVIKA DEPARTMENTAL PRIVATE LIMITED'),
      bank_name           = COALESCE(bank_name, 'HDFC Bank'),
      bank_ifsc           = COALESCE(bank_ifsc, 'HDFC0000616'),
      bank_branch         = COALESCE(bank_branch, 'Delhi'),
      service_lines       = CASE WHEN service_lines = '[]'::jsonb OR service_lines IS NULL THEN v_avika_sl ELSE service_lines END
    WHERE brand_id = v_id;
  END IF;

  -- ── SAMEDAY SOLUTIONS (key 'samedaytours') — bank not in source ──────────
  SELECT id INTO v_id FROM brands WHERE key = 'samedaytours' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO ca_company_config (brand_id, legal_name, gstin)
    VALUES (v_id, 'SAMEDAY SOLUTIONS PRIVATE LIMITED', '07ABRCS2826B2ZA') ON CONFLICT (brand_id) DO NOTHING;
    UPDATE ca_company_config SET
      legal_name       = COALESCE(legal_name, 'SAMEDAY SOLUTIONS PRIVATE LIMITED'),
      gstin            = COALESCE(gstin, '07ABRCS2826B2ZA'),
      pan              = COALESCE(pan, 'ABRCS2826B'),
      email            = COALESCE(email, 'samedaysolutionpvtltd@gmail.com'),
      state_code       = COALESCE(state_code, '07'),
      place_of_supply  = COALESCE(place_of_supply, 'Delhi'),
      jurisdiction     = COALESCE(jurisdiction, 'Delhi'),
      address          = COALESCE(address, 'TF 11 B, Eros Metro Mall, Sec 14, Dwarka, South West Delhi, Delhi - 110078, India'),
      service_lines    = CASE WHEN service_lines = '[]'::jsonb OR service_lines IS NULL THEN v_sameday_sl ELSE service_lines END
    WHERE brand_id = v_id;
  END IF;

  -- ── ASHVAM LEARNING (key 'ashvam') ───────────────────────────────────────
  SELECT id INTO v_id FROM brands WHERE key = 'ashvam' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO ca_company_config (brand_id, legal_name, gstin)
    VALUES (v_id, 'ASHVAM LEARNING PRIVATE LIMITED', '07ABDCA8206D1Z1') ON CONFLICT (brand_id) DO NOTHING;
    UPDATE ca_company_config SET
      legal_name          = COALESCE(legal_name, 'ASHVAM LEARNING PRIVATE LIMITED'),
      gstin               = COALESCE(gstin, '07ABDCA8206D1Z1'),
      pan                 = COALESCE(pan, 'ABDCA8206D'),
      email               = COALESCE(email, 'operations@ashwamlearning.co.in'),
      state_code          = COALESCE(state_code, '07'),
      place_of_supply     = COALESCE(place_of_supply, 'West Bengal'),
      jurisdiction        = COALESCE(jurisdiction, 'Delhi'),
      address             = COALESCE(address, 'Shop No. F9, Plot No. 4, PKT-7, Sec-12, Dwarka, Delhi - 110078'),
      bank_account_number = COALESCE(bank_account_number, '50200114270222'),
      bank_account_type   = COALESCE(bank_account_type, 'Current Account'),
      bank_holder_name    = COALESCE(bank_holder_name, 'ASHVAM LEARNING PRIVATE LIMITED'),
      bank_name           = COALESCE(bank_name, 'HDFC BANK LTD.'),
      bank_ifsc           = COALESCE(bank_ifsc, 'HDFC0008175'),
      service_lines       = CASE WHEN service_lines = '[]'::jsonb OR service_lines IS NULL THEN v_ashvam_sl ELSE service_lines END
    WHERE brand_id = v_id;
  END IF;

  -- ── NEW SCENARIC TRAVELS (key 'newscenaric') — WB, 5% GST, bank partial ──
  SELECT id INTO v_id FROM brands WHERE key = 'newscenaric' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO ca_company_config (brand_id, legal_name, gstin)
    VALUES (v_id, 'New Scenaric Travels', '19AGFPJ1036N1Z9') ON CONFLICT (brand_id) DO NOTHING;
    UPDATE ca_company_config SET
      legal_name          = COALESCE(legal_name, 'New Scenaric Travels'),
      gstin               = COALESCE(gstin, '19AGFPJ1036N1Z9'),
      pan                 = COALESCE(pan, 'AGFPJ1036N'),
      email               = COALESCE(email, 'newscenarictravel65@gmail.com'),
      phone               = COALESCE(phone, '+91 8130039642'),
      state_code          = COALESCE(state_code, '19'),
      place_of_supply     = COALESCE(place_of_supply, 'West Bengal'),
      jurisdiction        = COALESCE(jurisdiction, 'West Bengal'),
      address             = COALESCE(address, '71 Park Street, Park Plaza, Ground Floor, Office No. 20, Park Street, Kolkata - 700016, West Bengal'),
      bank_account_number = COALESCE(bank_account_number, '50200118811631'),
      bank_holder_name    = COALESCE(bank_holder_name, 'New Scenaric Travels'),
      gst_percent         = COALESCE(NULLIF(gst_percent, 18), 5),
      service_lines       = CASE WHEN service_lines = '[]'::jsonb OR service_lines IS NULL THEN v_newscenaric_sl ELSE service_lines END
    WHERE brand_id = v_id;
  END IF;
END $$;


-- ── Backfill missing PAN from GSTIN (PAN = chars 3..12 of a 15-char GSTIN) ──
UPDATE ca_company_config
SET pan = substring(gstin FROM 3 FOR 10)
WHERE (pan IS NULL OR btrim(pan) = '')
  AND gstin IS NOT NULL
  AND length(btrim(gstin)) = 15;
