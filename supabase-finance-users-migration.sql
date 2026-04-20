-- Finance executives: login at /finance-same/login (Supabase Auth + profile row)
-- Requires public.update_updated_at_column() (already present in main schema).

CREATE TABLE IF NOT EXISTS finance_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_finance_users_email ON finance_users (email);

COMMENT ON TABLE finance_users IS 'Finance portal users; credentials in auth.users, profile here.';

DROP TRIGGER IF EXISTS update_finance_users_updated_at ON finance_users;
CREATE TRIGGER update_finance_users_updated_at
  BEFORE UPDATE ON finance_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE finance_users ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read their own profile row (browser sign-in / getCurrentUser).
DROP POLICY IF EXISTS "finance_users_select_own" ON finance_users;
CREATE POLICY "finance_users_select_own"
  ON finance_users
  FOR SELECT
  TO authenticated
  USING (email = (auth.jwt() ->> 'email'));
