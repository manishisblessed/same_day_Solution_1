-- Migration: Add payment_mode column to BBPS tables
-- Run this SQL in your Supabase SQL Editor if tables already exist

-- Add payment_mode to bbps_billers table (if column doesn't exist)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bbps_billers' 
    AND column_name = 'payment_mode'
  ) THEN
    ALTER TABLE bbps_billers ADD COLUMN payment_mode TEXT DEFAULT 'Cash';
    RAISE NOTICE 'Added payment_mode column to bbps_billers table';
  ELSE
    RAISE NOTICE 'payment_mode column already exists in bbps_billers table';
  END IF;
END $$;

-- Add payment_mode to bbps_transactions table (if column doesn't exist)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bbps_transactions' 
    AND column_name = 'payment_mode'
  ) THEN
    ALTER TABLE bbps_transactions ADD COLUMN payment_mode TEXT DEFAULT 'Cash';
    RAISE NOTICE 'Added payment_mode column to bbps_transactions table';
  ELSE
    RAISE NOTICE 'payment_mode column already exists in bbps_transactions table';
  END IF;
END $$;

-- Update existing records to have 'Cash' as default payment_mode (if NULL)
UPDATE bbps_billers SET payment_mode = 'Cash' WHERE payment_mode IS NULL;
UPDATE bbps_transactions SET payment_mode = 'Cash' WHERE payment_mode IS NULL;

