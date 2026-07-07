-- Migration: Single-session enforcement (one active session per user)
-- Run this in Supabase SQL Editor

-- 1. Create user_sessions table
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  session_token TEXT NOT NULL UNIQUE,
  ip_address TEXT,
  user_agent TEXT,
  geo_latitude DOUBLE PRECISION,
  geo_longitude DOUBLE PRECISION,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  ended_reason TEXT  -- 'logout' | 'replaced' | 'inactivity' | 'admin_revoked'
);

-- 2. Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active
  ON user_sessions(user_id, is_active) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_user_sessions_token
  ON user_sessions(session_token) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_user_sessions_email_active
  ON user_sessions(email, is_active) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_user_sessions_expires
  ON user_sessions(expires_at) WHERE is_active = TRUE;

-- 3. RLS policies
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

-- Admins can read all sessions
CREATE POLICY "admin_read_sessions" ON user_sessions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM admin_users
      WHERE admin_users.email = auth.jwt() ->> 'email'
    )
  );

-- Users can read their own sessions
CREATE POLICY "user_read_own_sessions" ON user_sessions
  FOR SELECT USING (user_id = auth.uid());

-- Only service role can insert/update (API routes use service role)
-- No explicit INSERT/UPDATE policies needed since API routes use supabaseAdmin

-- 4. Cleanup function: expire stale sessions older than 24 hours
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS void AS $$
BEGIN
  UPDATE user_sessions
  SET is_active = FALSE,
      ended_reason = COALESCE(ended_reason, 'inactivity')
  WHERE is_active = TRUE
    AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Optional: schedule cleanup via pg_cron (if available)
-- SELECT cron.schedule('cleanup-expired-sessions', '*/10 * * * *', 'SELECT cleanup_expired_sessions()');
