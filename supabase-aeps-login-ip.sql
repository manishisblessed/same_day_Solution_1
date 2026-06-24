-- Add login_ip column to aeps_merchants for IP-binding on transactions
ALTER TABLE aeps_merchants ADD COLUMN IF NOT EXISTS login_ip TEXT DEFAULT NULL;
