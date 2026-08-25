-- ============================================================================
-- Onboarding Invite Wizard + Upline Declaration Approval
-- ============================================================================
-- Ports NEXTGEN's token-based invite onboarding wizard to same_day_solution_in.
--
-- Unlike NEXTGEN (single `User` table + `parentId`), this project stores each
-- role in its own table (master_distributors / distributors / retailers) linked
-- by master_distributor_id / distributor_id on `partner_id`. There is NO Super
-- Distributor. The invite therefore carries the TARGET role + parent FKs, and
-- the partner row is only INSERTed at the end of the wizard (register step).
--
-- All wizard KYC state lives on `onboarding_verifications` (keyed by invite_id)
-- because the partner row does not exist until registration completes.
--
-- Idempotent + safe to re-run.
-- ============================================================================

-- ── 1. Invites ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_invites (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token                         TEXT NOT NULL UNIQUE,
  phone                         TEXT NOT NULL,
  email                         TEXT NOT NULL,
  name                          TEXT,
  -- Target role for the invitee (no super_distributor in this project).
  target_role                   TEXT NOT NULL
                                  CHECK (target_role IN ('master_distributor', 'distributor', 'retailer')),
  -- Who created the invite.
  invited_by_role               TEXT NOT NULL,
  invited_by_id                 TEXT,          -- admin_users.id (uuid) or partner_id (text)
  invited_by_email              TEXT,
  invited_by_name               TEXT,
  -- Parent linkage applied to the partner row at registration.
  parent_master_distributor_id  TEXT,          -- master_distributors.partner_id
  parent_distributor_id         TEXT,          -- distributors.partner_id
  -- Lifecycle.
  status                        TEXT NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'registered', 'verified',
                                                    'resubmit', 'approved', 'rejected', 'expired')),
  phone_verified_at             TIMESTAMPTZ,
  email_verified_at             TIMESTAMPTZ,
  aadhaar_verified_at           TIMESTAMPTZ,
  registered_at                 TIMESTAMPTZ,
  verified_at                   TIMESTAMPTZ,
  approved_at                   TIMESTAMPTZ,
  rejected_at                   TIMESTAMPTZ,
  rejected_reason               TEXT,
  -- partner_id of the row created at registration (backfilled).
  created_partner_id            TEXT,
  expires_at                    TIMESTAMPTZ NOT NULL,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_invites_token       ON onboarding_invites (token);
CREATE INDEX IF NOT EXISTS idx_onboarding_invites_status      ON onboarding_invites (status);
CREATE INDEX IF NOT EXISTS idx_onboarding_invites_invited_by  ON onboarding_invites (invited_by_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_invites_email       ON onboarding_invites (lower(email));
CREATE INDEX IF NOT EXISTS idx_onboarding_invites_phone       ON onboarding_invites (phone);

-- ── 2. Verification results (per-invite KYC audit) ──────────────────────────
-- Mirrors NEXTGEN VerificationResult. `type` examples:
--   PAN_360, BANK_PENNY_DROP, GST, AADHAAR_DIGILOCKER, BUSINESS_NAME,
--   DOCUMENT_SELFIE, ONBOARD_VIDEO, DOCUMENT_<TYPE>, SELF_DECLARATION
CREATE TABLE IF NOT EXISTS onboarding_verifications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id           UUID NOT NULL REFERENCES onboarding_invites(id) ON DELETE CASCADE,
  type                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'Success'
                        CHECK (status IN ('Success', 'Failure', 'Uploaded', 'Pending', 'Rejected')),
  verified_name       TEXT,
  response_payload    JSONB DEFAULT '{}'::jsonb,
  created_partner_id  TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per (invite, type): later attempts upsert over the same slot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_verifications_invite_type
  ON onboarding_verifications (invite_id, type);
CREATE INDEX IF NOT EXISTS idx_onboarding_verifications_invite
  ON onboarding_verifications (invite_id);

-- ── 3. OTP store (email OTP + SMS fallback) ─────────────────────────────────
-- Twilio Verify (primary SMS) is stateless, but we persist email OTP codes and
-- act as an SMS fallback store.
CREATE TABLE IF NOT EXISTS onboarding_otps (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id    UUID NOT NULL REFERENCES onboarding_invites(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL CHECK (channel IN ('SMS', 'EMAIL')),
  code_hash    TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ NOT NULL,
  verified_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_otps_invite_channel
  ON onboarding_otps (invite_id, channel);

-- ── 4. Upline declaration approvals ─────────────────────────────────────────
-- Required only when the INVITER is a network role (MD or DT). Admin-created
-- invites skip this. The approver is the inviting partner.
CREATE TABLE IF NOT EXISTS declaration_approvals (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id                UUID NOT NULL REFERENCES onboarding_invites(id) ON DELETE CASCADE,
  approver_role            TEXT NOT NULL,
  approver_id              TEXT NOT NULL,     -- inviting partner's partner_id
  approver_email           TEXT,
  onboardee_role           TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  approver_signature_url   TEXT,
  approver_selfie_url      TEXT,
  approval_lat             DOUBLE PRECISION,
  approval_lng             DOUBLE PRECISION,
  approval_ip              TEXT,
  approval_user_agent      TEXT,
  declaration_doc_url      TEXT,
  approved_at              TIMESTAMPTZ,
  rejected_reason          TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_declaration_approvals_invite   ON declaration_approvals (invite_id);
CREATE INDEX IF NOT EXISTS idx_declaration_approvals_approver ON declaration_approvals (approver_id);
CREATE INDEX IF NOT EXISTS idx_declaration_approvals_status   ON declaration_approvals (status);

-- ── 5. Agreement acceptance audit ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agreement_acceptances (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id     UUID REFERENCES onboarding_invites(id) ON DELETE SET NULL,
  partner_id    TEXT,
  doc_version   TEXT NOT NULL,
  doc_id        TEXT,
  method        TEXT NOT NULL DEFAULT 'click_wrap',   -- click_wrap | esign | otp
  accepted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip            TEXT,
  user_agent    TEXT
);

CREATE INDEX IF NOT EXISTS idx_agreement_acceptances_invite  ON agreement_acceptances (invite_id);
CREATE INDEX IF NOT EXISTS idx_agreement_acceptances_partner ON agreement_acceptances (partner_id);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- All wizard/admin routes use the service-role client (bypasses RLS). We still
-- enable RLS and add restrictive policies so anon/authenticated cannot read.
ALTER TABLE onboarding_invites       ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_otps          ENABLE ROW LEVEL SECURITY;
ALTER TABLE declaration_approvals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_acceptances    ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically; no permissive policies for anon.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'onboarding_invites' AND policyname = 'service_role_all_invites') THEN
    CREATE POLICY service_role_all_invites ON onboarding_invites
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'onboarding_verifications' AND policyname = 'service_role_all_verifications') THEN
    CREATE POLICY service_role_all_verifications ON onboarding_verifications
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'onboarding_otps' AND policyname = 'service_role_all_otps') THEN
    CREATE POLICY service_role_all_otps ON onboarding_otps
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'declaration_approvals' AND policyname = 'service_role_all_approvals') THEN
    CREATE POLICY service_role_all_approvals ON declaration_approvals
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'agreement_acceptances' AND policyname = 'service_role_all_agreements') THEN
    CREATE POLICY service_role_all_agreements ON agreement_acceptances
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
