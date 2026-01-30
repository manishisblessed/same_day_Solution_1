-- Enable RLS on payout_transactions if not already enabled
ALTER TABLE IF EXISTS payout_transactions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Retailers can view their own payout transactions" ON payout_transactions;
DROP POLICY IF EXISTS "Retailers can insert their own payout transactions" ON payout_transactions;
DROP POLICY IF EXISTS "Retailers can create payout transactions" ON payout_transactions;
DROP POLICY IF EXISTS "Service role can manage all payout transactions" ON payout_transactions;
DROP POLICY IF EXISTS "Service role full access to payout transactions" ON payout_transactions;
DROP POLICY IF EXISTS "Admins can view all payout transactions" ON payout_transactions;
DROP POLICY IF EXISTS "Admin can view all payout transactions" ON payout_transactions;

-- Policy: Retailers can view their own payout transactions
-- Matches retailer_id (which is partner_id) with the partner_id from retailers table via email lookup
CREATE POLICY "Retailers can view their own payout transactions"
ON payout_transactions
FOR SELECT
TO authenticated
USING (
  retailer_id = (
    SELECT partner_id FROM retailers WHERE email = auth.email()
    LIMIT 1
  )
);

-- Policy: Retailers can insert their own payout transactions
CREATE POLICY "Retailers can insert their own payout transactions"
ON payout_transactions
FOR INSERT
TO authenticated
WITH CHECK (
  retailer_id = (
    SELECT partner_id FROM retailers WHERE email = auth.email()
    LIMIT 1
  )
);

-- Policy: Service role (admin operations) can do everything
CREATE POLICY "Service role can manage all payout transactions"
ON payout_transactions
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Policy: Admins can view all payout transactions
CREATE POLICY "Admins can view all payout transactions"
ON payout_transactions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM admin_users WHERE email = auth.email()
  )
);

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE ON payout_transactions TO authenticated;
GRANT ALL ON payout_transactions TO service_role;

