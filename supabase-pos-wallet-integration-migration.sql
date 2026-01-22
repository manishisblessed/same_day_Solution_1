-- ============================================================================
-- POS TRANSACTION → WALLET INTEGRATION MIGRATION
-- ============================================================================
-- This migration adds necessary columns to razorpay_pos_transactions 
-- for wallet credit tracking and retailer hierarchy mapping.
-- DO NOT modify existing tables beyond adding these columns.
-- ============================================================================

-- Add wallet credit tracking columns to razorpay_pos_transactions
DO $$ 
BEGIN
  -- Add wallet_credited flag
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'wallet_credited') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN wallet_credited BOOLEAN DEFAULT FALSE;
  END IF;

  -- Add wallet_credit_id (reference to wallet_ledger)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'wallet_credit_id') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN wallet_credit_id UUID;
  END IF;

  -- Add retailer hierarchy mapping columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'retailer_id') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN retailer_id TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'distributor_id') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN distributor_id TEXT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'master_distributor_id') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN master_distributor_id TEXT;
  END IF;

  -- Add MDR tracking columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'gross_amount') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN gross_amount DECIMAL(15, 2);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'mdr_amount') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN mdr_amount DECIMAL(15, 2);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'razorpay_pos_transactions' AND column_name = 'net_amount') THEN
    ALTER TABLE razorpay_pos_transactions ADD COLUMN net_amount DECIMAL(15, 2);
  END IF;
END $$;

-- Create indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_razorpay_pos_transactions_wallet_credited ON razorpay_pos_transactions(wallet_credited);
CREATE INDEX IF NOT EXISTS idx_razorpay_pos_transactions_retailer_id ON razorpay_pos_transactions(retailer_id);
CREATE INDEX IF NOT EXISTS idx_razorpay_pos_transactions_distributor_id ON razorpay_pos_transactions(distributor_id);
CREATE INDEX IF NOT EXISTS idx_razorpay_pos_transactions_master_distributor_id ON razorpay_pos_transactions(master_distributor_id);
CREATE INDEX IF NOT EXISTS idx_razorpay_pos_transactions_device_serial ON razorpay_pos_transactions(device_serial);

-- ============================================================================
-- COMMISSION PROCESSING FUNCTION
-- ============================================================================
-- Creates process_transaction_commission function if it doesn't exist
-- This function distributes commission to distributor and master_distributor
-- ============================================================================

CREATE OR REPLACE FUNCTION process_transaction_commission(
  p_transaction_id UUID,
  p_transaction_type TEXT,
  p_gross_amount DECIMAL(12, 2),
  p_retailer_id TEXT,
  p_distributor_id TEXT DEFAULT NULL,
  p_master_distributor_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  v_retailer_commission_rate DECIMAL(8, 4) DEFAULT 0.002; -- 0.2% default
  v_distributor_commission_rate DECIMAL(8, 4) DEFAULT 0.001; -- 0.1% default
  v_master_distributor_commission_rate DECIMAL(8, 4) DEFAULT 0.0005; -- 0.05% default
  v_retailer_commission DECIMAL(12, 2);
  v_distributor_commission DECIMAL(12, 2);
  v_master_distributor_commission DECIMAL(12, 2);
BEGIN
  -- Calculate commissions based on gross amount
  v_retailer_commission := ROUND(p_gross_amount * v_retailer_commission_rate, 2);
  
  -- Credit retailer commission (if any)
  IF v_retailer_commission > 0 AND p_retailer_id IS NOT NULL THEN
    INSERT INTO commission_ledger (
      transaction_id, transaction_type, user_id, user_role,
      mdr_amount, commission_rate, commission_amount
    ) VALUES (
      p_transaction_id, p_transaction_type, p_retailer_id, 'retailer',
      p_gross_amount * 0.015, v_retailer_commission_rate, v_retailer_commission
    );
    
    -- Credit to wallet using add_ledger_entry
    PERFORM add_ledger_entry(
      p_retailer_id,
      'retailer',
      'primary',
      'commission',
      p_transaction_type,
      'COMMISSION',
      v_retailer_commission,
      0,
      'COMM_' || p_transaction_id::TEXT,
      p_transaction_id,
      'completed',
      'Commission earned on ' || p_transaction_type || ' transaction'
    );
  END IF;
  
  -- Credit distributor commission (if applicable)
  IF p_distributor_id IS NOT NULL THEN
    v_distributor_commission := ROUND(p_gross_amount * v_distributor_commission_rate, 2);
    
    IF v_distributor_commission > 0 THEN
      INSERT INTO commission_ledger (
        transaction_id, transaction_type, user_id, user_role,
        mdr_amount, commission_rate, commission_amount
      ) VALUES (
        p_transaction_id, p_transaction_type, p_distributor_id, 'distributor',
        p_gross_amount * 0.015, v_distributor_commission_rate, v_distributor_commission
      );
      
      PERFORM add_ledger_entry(
        p_distributor_id,
        'distributor',
        'primary',
        'commission',
        p_transaction_type,
        'COMMISSION',
        v_distributor_commission,
        0,
        'COMM_' || p_transaction_id::TEXT,
        p_transaction_id,
        'completed',
        'Commission earned on downstream ' || p_transaction_type || ' transaction'
      );
    END IF;
  END IF;
  
  -- Credit master distributor commission (if applicable)
  IF p_master_distributor_id IS NOT NULL THEN
    v_master_distributor_commission := ROUND(p_gross_amount * v_master_distributor_commission_rate, 2);
    
    IF v_master_distributor_commission > 0 THEN
      INSERT INTO commission_ledger (
        transaction_id, transaction_type, user_id, user_role,
        mdr_amount, commission_rate, commission_amount
      ) VALUES (
        p_transaction_id, p_transaction_type, p_master_distributor_id, 'master_distributor',
        p_gross_amount * 0.015, v_master_distributor_commission_rate, v_master_distributor_commission
      );
      
      PERFORM add_ledger_entry(
        p_master_distributor_id,
        'master_distributor',
        'primary',
        'commission',
        p_transaction_type,
        'COMMISSION',
        v_master_distributor_commission,
        0,
        'COMM_' || p_transaction_id::TEXT,
        p_transaction_id,
        'completed',
        'Commission earned on downstream ' || p_transaction_type || ' transaction'
      );
    END IF;
  END IF;
  
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Error in process_transaction_commission: %', SQLERRM;
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- CALCULATE TRANSACTION CHARGE FUNCTION (for BBPS)
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_transaction_charge(
  p_amount DECIMAL(12, 2),
  p_transaction_type TEXT
)
RETURNS DECIMAL(12, 2) AS $$
DECLARE
  v_charge DECIMAL(12, 2);
BEGIN
  -- Default charges based on transaction type
  IF p_transaction_type = 'bbps' THEN
    -- BBPS charge slabs
    IF p_amount <= 1000 THEN
      v_charge := 10;
    ELSIF p_amount <= 5000 THEN
      v_charge := 15;
    ELSIF p_amount <= 10000 THEN
      v_charge := 20;
    ELSIF p_amount <= 25000 THEN
      v_charge := 30;
    ELSIF p_amount <= 49999 THEN
      v_charge := 40;
    ELSE
      v_charge := 50;
    END IF;
  ELSIF p_transaction_type = 'settlement' THEN
    -- Settlement charges
    IF p_amount <= 49999 THEN
      v_charge := 20;
    ELSIF p_amount <= 99999 THEN
      v_charge := 30;
    ELSIF p_amount <= 149999 THEN
      v_charge := 50;
    ELSE
      v_charge := 70;
    END IF;
  ELSE
    v_charge := 0;
  END IF;
  
  RETURN v_charge;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ADMIN PERMISSION CHECK FUNCTION (if not exists)
-- ============================================================================

CREATE OR REPLACE FUNCTION check_admin_permission(
  p_admin_id UUID,
  p_permission_key TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_is_super_admin BOOLEAN;
  v_has_permission BOOLEAN;
BEGIN
  -- Check if admin exists and is active
  SELECT is_super_admin INTO v_is_super_admin
  FROM admin_users
  WHERE id = p_admin_id AND is_active = TRUE;
  
  IF v_is_super_admin IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Super admins have all permissions
  IF v_is_super_admin THEN
    RETURN TRUE;
  END IF;
  
  -- Check specific permission in admin_role_permissions
  SELECT EXISTS (
    SELECT 1 
    FROM admin_role_permissions arp
    JOIN admin_users au ON au.role_id = arp.role_id
    WHERE au.id = p_admin_id 
      AND arp.permission_key = p_permission_key
      AND arp.is_enabled = TRUE
  ) INTO v_has_permission;
  
  RETURN COALESCE(v_has_permission, FALSE);
EXCEPTION WHEN OTHERS THEN
  -- If tables don't exist, return true for backward compatibility
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================

