-- ============================================================================
-- ADD TEST BALANCE TO RETAILER
-- Run this in Supabase SQL Editor to add test funds
-- ============================================================================

-- STEP 1: Find your retailer partner_id
SELECT partner_id, name, email FROM retailers LIMIT 10;

-- STEP 2: Replace 'YOUR_RETAILER_PARTNER_ID' below with actual partner_id
-- Then run this block to add ₹5000 test balance

DO $$
DECLARE
  v_retailer_id TEXT := 'YOUR_RETAILER_PARTNER_ID';  -- <-- CHANGE THIS!
  v_amount DECIMAL := 5000.00;  -- Amount to add (in rupees)
  v_balance_before DECIMAL;
  v_balance_after DECIMAL;
  v_ledger_id UUID;
BEGIN
  -- Check if retailer exists
  IF NOT EXISTS (SELECT 1 FROM retailers WHERE partner_id = v_retailer_id) THEN
    RAISE EXCEPTION 'Retailer not found: %', v_retailer_id;
  END IF;

  -- Get current balance
  SELECT COALESCE(balance, 0) INTO v_balance_before
  FROM wallets 
  WHERE user_id = v_retailer_id AND wallet_type = 'primary';
  
  IF v_balance_before IS NULL THEN
    v_balance_before := 0;
  END IF;

  v_balance_after := v_balance_before + v_amount;

  -- Create or update wallet
  INSERT INTO wallets (user_id, user_role, wallet_type, balance)
  VALUES (v_retailer_id, 'retailer', 'primary', v_balance_after)
  ON CONFLICT (user_id, wallet_type) 
  DO UPDATE SET balance = v_balance_after, updated_at = NOW();

  -- Add ledger entry
  INSERT INTO wallet_ledger (
    retailer_id,
    transaction_type,
    amount,
    credit,
    opening_balance,
    closing_balance,
    balance_after,
    description,
    reference_id,
    wallet_type,
    fund_category
  ) VALUES (
    v_retailer_id,
    'ADMIN_CREDIT',
    v_amount,
    v_amount,
    v_balance_before,
    v_balance_after,
    v_balance_after,
    'Admin credit - Test balance',
    'TEST-' || to_char(NOW(), 'YYYYMMDDHH24MISS'),
    'primary',
    'admin'
  ) RETURNING id INTO v_ledger_id;

  RAISE NOTICE '✅ SUCCESS! Added ₹% to retailer %', v_amount, v_retailer_id;
  RAISE NOTICE '   Balance: ₹% → ₹%', v_balance_before, v_balance_after;
  RAISE NOTICE '   Ledger ID: %', v_ledger_id;
END $$;

-- STEP 3: Verify the balance was added
SELECT 
  r.partner_id,
  r.name,
  w.balance as wallet_balance
FROM retailers r
JOIN wallets w ON w.user_id = r.partner_id AND w.wallet_type = 'primary'
WHERE w.balance > 0;

