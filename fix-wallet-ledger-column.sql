-- Fix missing balance_after column in wallet_ledger table
-- Run this in your Supabase SQL Editor

-- Add balance_after column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'wallet_ledger' AND column_name = 'balance_after'
    ) THEN
        ALTER TABLE wallet_ledger ADD COLUMN balance_after DECIMAL(12, 2) DEFAULT 0;
        RAISE NOTICE 'Column balance_after added to wallet_ledger';
    ELSE
        RAISE NOTICE 'Column balance_after already exists';
    END IF;
END $$;

-- Also add balance_before if missing
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'wallet_ledger' AND column_name = 'balance_before'
    ) THEN
        ALTER TABLE wallet_ledger ADD COLUMN balance_before DECIMAL(12, 2) DEFAULT 0;
        RAISE NOTICE 'Column balance_before added to wallet_ledger';
    ELSE
        RAISE NOTICE 'Column balance_before already exists';
    END IF;
END $$;

-- Verify the columns exist
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'wallet_ledger' 
ORDER BY ordinal_position;

