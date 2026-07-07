-- Migration: TOTP-based Two-Factor Authentication
-- Stores encrypted TOTP secrets and backup codes per user

-- 1. TOTP secrets table
CREATE TABLE IF NOT EXISTS user_totp_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  email TEXT NOT NULL,
  encrypted_secret TEXT NOT NULL,
  is_enabled BOOLEAN DEFAULT FALSE,
  backup_codes TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_totp_user_id ON user_totp_secrets(user_id);
CREATE INDEX IF NOT EXISTS idx_totp_email ON user_totp_secrets(email);

-- 2. RLS
ALTER TABLE user_totp_secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_read_own_totp" ON user_totp_secrets
  FOR SELECT USING (user_id = auth.uid());

-- Admin can read all (for support/reset)
CREATE POLICY "admin_read_totp" ON user_totp_secrets
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.email = auth.jwt() ->> 'email'
    )
  );

-- Insert/update only via service role (API routes)
