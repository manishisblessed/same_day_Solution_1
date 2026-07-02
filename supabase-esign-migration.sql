-- Leegality eSigning Integration Tables
-- Run this migration in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS esign_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  leegality_document_id TEXT UNIQUE NOT NULL,
  irn TEXT,
  document_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'IN PROGRESS',
  signed_file_url TEXT,
  audit_trail_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS esign_invitees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES esign_documents(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  sign_url TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  sign_type TEXT,
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_esign_documents_user ON esign_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_esign_documents_leegality_id ON esign_documents(leegality_document_id);
CREATE INDEX IF NOT EXISTS idx_esign_documents_status ON esign_documents(status);
CREATE INDEX IF NOT EXISTS idx_esign_invitees_document ON esign_invitees(document_id);
CREATE INDEX IF NOT EXISTS idx_esign_invitees_sign_url ON esign_invitees(sign_url);

-- RLS Policies
ALTER TABLE esign_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE esign_invitees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own esign documents"
  ON esign_documents FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access on esign_documents"
  ON esign_documents FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on esign_invitees"
  ON esign_invitees FOR ALL
  USING (auth.role() = 'service_role');
