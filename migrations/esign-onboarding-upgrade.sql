-- eSign Onboarding Upgrade Migration
-- Run in Supabase SQL Editor

-- 1. Add invite_id to esign_documents to link eSigning back to onboarding
ALTER TABLE esign_documents
  ADD COLUMN IF NOT EXISTS invite_id UUID;

CREATE INDEX IF NOT EXISTS idx_esign_documents_invite ON esign_documents(invite_id);

-- 2. Make user_id nullable (onboarding esign happens before user account exists)
ALTER TABLE esign_documents
  ALTER COLUMN user_id DROP NOT NULL;

-- 3. Add esign_document_id to agreement_acceptances for tracking
ALTER TABLE agreement_acceptances
  ADD COLUMN IF NOT EXISTS esign_document_id TEXT;
