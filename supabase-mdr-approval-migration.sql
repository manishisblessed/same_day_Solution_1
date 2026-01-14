-- ============================================================================
-- MDR APPROVAL & COMMISSION CALCULATION MIGRATION
-- ============================================================================
-- This migration adds MDR approval fields and commission calculation support
-- ============================================================================

-- Add approved_mdr_rate to distributors table (approved by master distributor)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'distributors' AND column_name = 'approved_mdr_rate') THEN
    ALTER TABLE distributors ADD COLUMN approved_mdr_rate DECIMAL(8, 4);
    COMMENT ON COLUMN distributors.approved_mdr_rate IS 'MDR rate approved by master distributor (e.g., 0.015 for 1.5%)';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'distributors' AND column_name = 'mdr_approved_by') THEN
    ALTER TABLE distributors ADD COLUMN mdr_approved_by TEXT;
    COMMENT ON COLUMN distributors.mdr_approved_by IS 'Master distributor partner_id who approved the MDR';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'distributors' AND column_name = 'mdr_approved_at') THEN
    ALTER TABLE distributors ADD COLUMN mdr_approved_at TIMESTAMP WITH TIME ZONE;
    COMMENT ON COLUMN distributors.mdr_approved_at IS 'Timestamp when MDR was approved';
  END IF;
END $$;

-- Add approved_mdr_rate to master_distributors table (approved by company/admin)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'master_distributors' AND column_name = 'approved_mdr_rate') THEN
    ALTER TABLE master_distributors ADD COLUMN approved_mdr_rate DECIMAL(8, 4);
    COMMENT ON COLUMN master_distributors.approved_mdr_rate IS 'MDR rate approved by company/admin (e.g., 0.01 for 1%)';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'master_distributors' AND column_name = 'mdr_approved_by') THEN
    ALTER TABLE master_distributors ADD COLUMN mdr_approved_by TEXT;
    COMMENT ON COLUMN master_distributors.mdr_approved_by IS 'Admin user ID who approved the MDR';
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'master_distributors' AND column_name = 'mdr_approved_at') THEN
    ALTER TABLE master_distributors ADD COLUMN mdr_approved_at TIMESTAMP WITH TIME ZONE;
    COMMENT ON COLUMN master_distributors.mdr_approved_at IS 'Timestamp when MDR was approved';
  END IF;
END $$;

-- Add retailer_mdr_rate to retailers table (MDR rate charged to retailer)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                 WHERE table_name = 'retailers' AND column_name = 'retailer_mdr_rate') THEN
    ALTER TABLE retailers ADD COLUMN retailer_mdr_rate DECIMAL(8, 4) DEFAULT 0.02;
    COMMENT ON COLUMN retailers.retailer_mdr_rate IS 'MDR rate charged to retailer (e.g., 0.02 for 2%)';
  END IF;
END $$;

-- ============================================================================
-- COMMISSION CALCULATION FUNCTION
-- ============================================================================
-- This function calculates commissions for all levels in the hierarchy
-- Commission = (Higher MDR - Lower MDR) * Transaction Amount
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_commission_hierarchy(
  p_transaction_id UUID,
  p_transaction_type TEXT,
  p_gross_amount DECIMAL(12, 2),
  p_retailer_id TEXT,
  p_distributor_id TEXT,
  p_master_distributor_id TEXT
) RETURNS TABLE (
  user_id TEXT,
  user_role TEXT,
  commission_rate DECIMAL(8, 4),
  commission_amount DECIMAL(12, 2)
) AS $$
DECLARE
  v_retailer_mdr DECIMAL(8, 4);
  v_distributor_mdr DECIMAL(8, 4);
  v_master_distributor_mdr DECIMAL(8, 4);
  v_distributor_commission DECIMAL(12, 2);
  v_master_distributor_commission DECIMAL(12, 2);
BEGIN
  -- Get retailer MDR rate (default 2% if not set)
  SELECT COALESCE(retailer_mdr_rate, 0.02) INTO v_retailer_mdr
  FROM retailers
  WHERE partner_id = p_retailer_id;
  
  -- Get distributor approved MDR rate
  SELECT COALESCE(approved_mdr_rate, 0.015) INTO v_distributor_mdr
  FROM distributors
  WHERE partner_id = p_distributor_id;
  
  -- Get master distributor approved MDR rate
  SELECT COALESCE(approved_mdr_rate, 0.01) INTO v_master_distributor_mdr
  FROM master_distributors
  WHERE partner_id = p_master_distributor_id;
  
  -- Calculate distributor commission: (Retailer MDR - Distributor MDR) * Amount
  v_distributor_commission := (v_retailer_mdr - v_distributor_mdr) * p_gross_amount;
  
  -- Calculate master distributor commission: (Distributor MDR - Master Distributor MDR) * Amount
  v_master_distributor_commission := (v_distributor_mdr - v_master_distributor_mdr) * p_gross_amount;
  
  -- Return commission for distributor
  IF p_distributor_id IS NOT NULL AND v_distributor_commission > 0 THEN
    RETURN QUERY SELECT 
      p_distributor_id::TEXT,
      'distributor'::TEXT,
      (v_retailer_mdr - v_distributor_mdr)::DECIMAL(8, 4),
      v_distributor_commission;
  END IF;
  
  -- Return commission for master distributor
  IF p_master_distributor_id IS NOT NULL AND v_master_distributor_commission > 0 THEN
    RETURN QUERY SELECT 
      p_master_distributor_id::TEXT,
      'master_distributor'::TEXT,
      (v_distributor_mdr - v_master_distributor_mdr)::DECIMAL(8, 4),
      v_master_distributor_commission;
  END IF;
  
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- FUNCTION TO PROCESS COMMISSION FOR TRANSACTION
-- ============================================================================
-- This function creates commission ledger entries and credits wallets
-- ============================================================================

CREATE OR REPLACE FUNCTION process_transaction_commission(
  p_transaction_id UUID,
  p_transaction_type TEXT,
  p_gross_amount DECIMAL(12, 2),
  p_retailer_id TEXT,
  p_distributor_id TEXT,
  p_master_distributor_id TEXT
) RETURNS VOID AS $$
DECLARE
  v_commission RECORD;
  v_ledger_id UUID;
  v_retailer_mdr DECIMAL(8, 4);
  v_mdr_amount DECIMAL(12, 2);
BEGIN
  -- Get retailer MDR rate
  SELECT COALESCE(retailer_mdr_rate, 0.02) INTO v_retailer_mdr
  FROM retailers
  WHERE partner_id = p_retailer_id;
  
  -- Calculate total MDR amount
  v_mdr_amount := p_gross_amount * v_retailer_mdr;
  
  -- Process commissions for each level
  FOR v_commission IN 
    SELECT * FROM calculate_commission_hierarchy(
      p_transaction_id,
      p_transaction_type,
      p_gross_amount,
      p_retailer_id,
      p_distributor_id,
      p_master_distributor_id
    )
  LOOP
    -- Create commission ledger entry
    INSERT INTO commission_ledger (
      transaction_id,
      transaction_type,
      user_id,
      user_role,
      mdr_amount,
      commission_rate,
      commission_amount
    ) VALUES (
      p_transaction_id,
      p_transaction_type,
      v_commission.user_id,
      v_commission.user_role,
      v_mdr_amount,
      v_commission.commission_rate,
      v_commission.commission_amount
    ) RETURNING id INTO v_ledger_id;
    
    -- Credit commission to user's wallet
    INSERT INTO wallet_ledger (
      user_id,
      user_role,
      wallet_type,
      fund_category,
      transaction_type,
      credit,
      debit,
      opening_balance,
      closing_balance,
      reference_id,
      description,
      status
    )
    SELECT 
      v_commission.user_id,
      v_commission.user_role,
      'primary',
      'commission',
      'COMMISSION',
      v_commission.commission_amount,
      0,
      COALESCE((SELECT balance FROM wallets WHERE user_id = v_commission.user_id AND wallet_type = 'primary'), 0),
      COALESCE((SELECT balance FROM wallets WHERE user_id = v_commission.user_id AND wallet_type = 'primary'), 0) + v_commission.commission_amount,
      p_transaction_id::TEXT,
      'Commission from transaction ' || p_transaction_id::TEXT,
      'completed'
    RETURNING id INTO v_ledger_id;
    
    -- Update wallet balance
    UPDATE wallets
    SET balance = balance + v_commission.commission_amount,
        updated_at = NOW()
    WHERE user_id = v_commission.user_id 
      AND wallet_type = 'primary';
    
    -- Update commission ledger with ledger entry ID
    UPDATE commission_ledger
    SET ledger_entry_id = v_ledger_id
    WHERE id = (SELECT id FROM commission_ledger 
                WHERE transaction_id = p_transaction_id 
                  AND user_id = v_commission.user_id 
                  AND user_role = v_commission.user_role
                ORDER BY created_at DESC LIMIT 1);
  END LOOP;
END;
$$ LANGUAGE plpgsql;

