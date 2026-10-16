-- ============================================================================
-- CA Billing: full company invoice profile
--
-- Per-transaction reimbursement + GST invoices must carry the issuing company's
-- complete legal + tax + bank profile (reference format: D:\tech\invoice_python).
-- The CA fills these per company (brand); invoice documents are only generated
-- once the profile is complete.
--
-- Issuer  = the Company / Brand (these fields)
-- Billed To = the Partner / aggregator on the transaction (partners table)
--
-- Idempotent + safe to re-run.
-- ============================================================================

ALTER TABLE ca_company_config
  ADD COLUMN IF NOT EXISTS pan                       TEXT,
  ADD COLUMN IF NOT EXISTS email                     TEXT,
  ADD COLUMN IF NOT EXISTS phone                     TEXT,
  ADD COLUMN IF NOT EXISTS state_code                TEXT,
  ADD COLUMN IF NOT EXISTS cin                       TEXT,
  ADD COLUMN IF NOT EXISTS place_of_supply           TEXT,
  ADD COLUMN IF NOT EXISTS jurisdiction              TEXT,
  ADD COLUMN IF NOT EXISTS reverse_charge            TEXT    DEFAULT 'NO',
  -- Description of Service lines: [{ description, sac, percent }]
  ADD COLUMN IF NOT EXISTS service_lines             JSONB   DEFAULT '[]'::jsonb,
  -- Terms & conditions: ["line", ...]
  ADD COLUMN IF NOT EXISTS terms                     JSONB   DEFAULT '[]'::jsonb,
  -- Bank details
  ADD COLUMN IF NOT EXISTS bank_account_number       TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_type         TEXT,   -- "Particular of A/C"
  ADD COLUMN IF NOT EXISTS bank_holder_name          TEXT,
  ADD COLUMN IF NOT EXISTS bank_name                 TEXT,
  ADD COLUMN IF NOT EXISTS bank_branch               TEXT,
  ADD COLUMN IF NOT EXISTS bank_ifsc                 TEXT,
  -- Authorised signatory
  ADD COLUMN IF NOT EXISTS authorized_signatory_name TEXT,
  ADD COLUMN IF NOT EXISTS signature_image           TEXT;   -- optional data-URL


-- ── Seed profiles for known companies (only fills blanks; never overwrites) ──
-- Pulled from the reference config files. CA can edit afterwards.
DO $$
DECLARE
  v_id UUID;
BEGIN
  -- TEACHWAY (brand key 'teachway')
  SELECT id INTO v_id FROM brands WHERE key = 'teachway' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO ca_company_config (brand_id, legal_name, gstin)
    VALUES (v_id, 'TEACHWAY EDUCATION PRIVATE LIMITED', '07AAMCT3623R1ZN')
    ON CONFLICT (brand_id) DO NOTHING;

    UPDATE ca_company_config SET
      legal_name          = COALESCE(legal_name, 'TEACHWAY EDUCATION PRIVATE LIMITED'),
      gstin               = COALESCE(gstin, '07AAMCT3623R1ZN'),
      pan                 = COALESCE(pan, 'AAMCT3623R'),
      email               = COALESCE(email, 'teachway839@gmail.com'),
      phone               = COALESCE(phone, '8527748384'),
      state_code          = COALESCE(state_code, '07'),
      place_of_supply     = COALESCE(place_of_supply, 'Delhi'),
      jurisdiction        = COALESCE(jurisdiction, 'Delhi'),
      address             = COALESCE(address, 'First Floor, KH-86 PLOT D3/258, Palam-Dabri Marg, SAI PROPERTY DILLER, GALI NO-9 MAHAVIR ENCL PALAM, New Delhi, South West Delhi, Delhi - 110045'),
      bank_account_number = COALESCE(bank_account_number, '926020007270478'),
      bank_account_type   = COALESCE(bank_account_type, 'Current Account'),
      bank_holder_name    = COALESCE(bank_holder_name, 'TEACHWAY EDUCATION PRIVATE LIMITED'),
      bank_name           = COALESCE(bank_name, 'Axis Bank'),
      bank_ifsc           = COALESCE(bank_ifsc, 'UTIB0004531'),
      bank_branch         = COALESCE(bank_branch, 'Delhi'),
      service_lines       = CASE WHEN service_lines = '[]'::jsonb OR service_lines IS NULL THEN '[
        {"description":"IT training, e-learning platform development and digital content services","sac":"998314","percent":30},
        {"description":"Software application development, testing and deployment services","sac":"998314","percent":25},
        {"description":"Cloud computing, SaaS platform and data processing services","sac":"998315","percent":20},
        {"description":"IT infrastructure management and technical support services","sac":"998316","percent":15},
        {"description":"Information technology consulting and advisory services","sac":"998313","percent":10}
      ]'::jsonb ELSE service_lines END
    WHERE brand_id = v_id;
  END IF;

  -- LAGOON (brand key 'lagoon')
  SELECT id INTO v_id FROM brands WHERE key = 'lagoon' LIMIT 1;
  IF v_id IS NOT NULL THEN
    INSERT INTO ca_company_config (brand_id, legal_name, gstin)
    VALUES (v_id, 'LAGOON CRAFT LABS SOLUTIONS PRIVATE LIMITED', '07AAGCL6454Q1ZS')
    ON CONFLICT (brand_id) DO NOTHING;

    UPDATE ca_company_config SET
      legal_name          = COALESCE(legal_name, 'LAGOON CRAFT LABS SOLUTIONS PRIVATE LIMITED'),
      gstin               = COALESCE(gstin, '07AAGCL6454Q1ZS'),
      email               = COALESCE(email, 'lagooncraftlabs1@gmail.com'),
      phone               = COALESCE(phone, '+91 90155 52525'),
      state_code          = COALESCE(state_code, '07'),
      cin                 = COALESCE(cin, 'U62099DL2025PTC460476'),
      place_of_supply     = COALESCE(place_of_supply, 'Delhi'),
      jurisdiction        = COALESCE(jurisdiction, 'Delhi'),
      address             = COALESCE(address, 'FIRST FLOOR, EXTN., 1 BUILD UP PROPERTY BEARING NO. P-9 MOHAN GARDEN, Uttam Nagar, New Delhi, South West Delhi, Delhi-110059'),
      bank_account_number = COALESCE(bank_account_number, '99998527100857'),
      bank_account_type   = COALESCE(bank_account_type, 'Current'),
      bank_holder_name    = COALESCE(bank_holder_name, 'LAGOON CRAFT LABS SOLUTIONS PRIVATE LIMITED'),
      bank_name           = COALESCE(bank_name, 'HDFC Bank'),
      bank_ifsc           = COALESCE(bank_ifsc, 'HDFC0007324'),
      service_lines       = CASE WHEN service_lines = '[]'::jsonb OR service_lines IS NULL THEN '[
        {"description":"Consultancy in Information Technology and associated software and related services","sac":"998314","percent":22},
        {"description":"IT consulting, setup, repair, and data processing services","sac":"998314","percent":18},
        {"description":"Cloud services, network management, and technical support","sac":"998314","percent":26},
        {"description":"Training and digital marketing services","sac":"998314","percent":14},
        {"description":"Other information technology and computer service activities","sac":"998439","percent":20}
      ]'::jsonb ELSE service_lines END
    WHERE brand_id = v_id;
  END IF;
END $$;
