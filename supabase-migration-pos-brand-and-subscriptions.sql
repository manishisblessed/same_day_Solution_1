-- ============================================================================
-- POS brand column + Subscriptions (auto-debit) tables
-- Run in Supabase SQL Editor
-- ============================================================================

-- 1. Add brand to pos_machines (optional)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'pos_machines' AND column_name = 'brand') THEN
    ALTER TABLE pos_machines ADD COLUMN brand TEXT;
  END IF;
END $$;

-- 2. Subscription plans (admin-defined: rental per machine, billing cycle)
CREATE TABLE IF NOT EXISTS subscription_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  monthly_rental_per_machine DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (monthly_rental_per_machine >= 0),
  other_charges DECIMAL(12, 2) DEFAULT 0 CHECK (other_charges >= 0),
  billing_cycle_day INT NOT NULL DEFAULT 1 CHECK (billing_cycle_day >= 1 AND billing_cycle_day <= 28),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Subscriptions (per user/retailer or partner - who pays for POS machines)
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL CHECK (user_role IN ('retailer', 'distributor', 'master_distributor')),
  plan_id UUID REFERENCES subscription_plans(id) ON DELETE SET NULL,
  pos_machine_count INT NOT NULL DEFAULT 0 CHECK (pos_machine_count >= 0),
  auto_debit_enabled BOOLEAN DEFAULT TRUE,
  monthly_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  next_billing_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_next_billing ON subscriptions(next_billing_date) WHERE auto_debit_enabled = TRUE AND status = 'active';

-- 4. Subscription debit transactions (history of auto-debits)
CREATE TABLE IF NOT EXISTS subscription_debits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_id UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  billing_period_start DATE NOT NULL,
  billing_period_end DATE NOT NULL,
  pos_machine_count INT NOT NULL DEFAULT 0,
  ledger_id UUID,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'insufficient_balance')),
  failure_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_subscription_debits_subscription_id ON subscription_debits(subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscription_debits_created ON subscription_debits(created_at);

-- 5. Enable RLS (optional – adjust policies per your auth)
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_debits ENABLE ROW LEVEL SECURITY;

-- Policies: drop first so migration is re-runnable
DROP POLICY IF EXISTS "Admin all subscription_plans" ON subscription_plans;
DROP POLICY IF EXISTS "Users read own subscriptions" ON subscriptions;
DROP POLICY IF EXISTS "Admin all subscriptions" ON subscriptions;
DROP POLICY IF EXISTS "Users read own subscription_debits" ON subscription_debits;
DROP POLICY IF EXISTS "Admin all subscription_debits" ON subscription_debits;

CREATE POLICY "Admin all subscription_plans" ON subscription_plans FOR ALL USING (
  EXISTS (SELECT 1 FROM admin_users LIMIT 1)
);
CREATE POLICY "Users read own subscriptions" ON subscriptions FOR SELECT USING (true);
CREATE POLICY "Admin all subscriptions" ON subscriptions FOR ALL USING (true);
CREATE POLICY "Users read own subscription_debits" ON subscription_debits FOR SELECT USING (true);
CREATE POLICY "Admin all subscription_debits" ON subscription_debits FOR ALL USING (true);

-- Default plan (optional)
INSERT INTO subscription_plans (id, name, description, monthly_rental_per_machine, other_charges, billing_cycle_day, is_active)
VALUES (
  'a0000000-0000-0000-0000-000000000001'::uuid,
  'Standard POS Rental',
  'Monthly rental per POS machine assigned',
  500.00,
  0,
  1,
  TRUE
)
ON CONFLICT (id) DO NOTHING;
