-- Migration: Add T-PIN (Transaction PIN) support for retailers
-- Run this in Supabase SQL Editor

-- Add tpin column to retailers table (stored as hashed value)
ALTER TABLE retailers 
ADD COLUMN IF NOT EXISTS tpin_hash TEXT DEFAULT NULL;

-- Add tpin_enabled flag (retailers must explicitly set up their T-PIN)
ALTER TABLE retailers 
ADD COLUMN IF NOT EXISTS tpin_enabled BOOLEAN DEFAULT FALSE;

-- Add tpin_attempts counter for rate limiting
ALTER TABLE retailers 
ADD COLUMN IF NOT EXISTS tpin_failed_attempts INTEGER DEFAULT 0;

-- Add tpin_locked_until for temporary lockout after failed attempts
ALTER TABLE retailers 
ADD COLUMN IF NOT EXISTS tpin_locked_until TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Function to set T-PIN for a retailer
CREATE OR REPLACE FUNCTION set_retailer_tpin(
  p_retailer_id TEXT,
  p_tpin TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_tpin_hash TEXT;
BEGIN
  -- Validate T-PIN format (4-6 digits)
  IF LENGTH(p_tpin) < 4 OR LENGTH(p_tpin) > 6 THEN
    RAISE EXCEPTION 'T-PIN must be 4-6 digits';
  END IF;
  
  IF p_tpin !~ '^\d+$' THEN
    RAISE EXCEPTION 'T-PIN must contain only digits';
  END IF;
  
  -- Hash the T-PIN using pgcrypto (if available) or store as is (for demo)
  -- In production, use: v_tpin_hash := crypt(p_tpin, gen_salt('bf'));
  -- For now, using simple hash
  v_tpin_hash := encode(sha256(p_tpin::bytea), 'hex');
  
  -- Update retailer record
  UPDATE retailers
  SET 
    tpin_hash = v_tpin_hash,
    tpin_enabled = TRUE,
    tpin_failed_attempts = 0,
    tpin_locked_until = NULL,
    updated_at = NOW()
  WHERE partner_id = p_retailer_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Retailer not found';
  END IF;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to verify T-PIN for a retailer
CREATE OR REPLACE FUNCTION verify_retailer_tpin(
  p_retailer_id TEXT,
  p_tpin TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_retailer RECORD;
  v_tpin_hash TEXT;
  v_result JSONB;
BEGIN
  -- Get retailer record
  SELECT tpin_hash, tpin_enabled, tpin_failed_attempts, tpin_locked_until
  INTO v_retailer
  FROM retailers
  WHERE partner_id = p_retailer_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Retailer not found');
  END IF;
  
  -- If T-PIN is not enabled, allow transaction (backward compatibility)
  IF NOT v_retailer.tpin_enabled OR v_retailer.tpin_hash IS NULL THEN
    RETURN jsonb_build_object('success', TRUE, 'message', 'T-PIN not configured, transaction allowed');
  END IF;
  
  -- Check if account is locked
  IF v_retailer.tpin_locked_until IS NOT NULL AND v_retailer.tpin_locked_until > NOW() THEN
    RETURN jsonb_build_object(
      'success', FALSE, 
      'error', 'Account temporarily locked due to too many failed attempts',
      'locked_until', v_retailer.tpin_locked_until
    );
  END IF;
  
  -- Hash provided T-PIN and compare
  v_tpin_hash := encode(sha256(p_tpin::bytea), 'hex');
  
  IF v_tpin_hash = v_retailer.tpin_hash THEN
    -- Reset failed attempts on success
    UPDATE retailers
    SET tpin_failed_attempts = 0, tpin_locked_until = NULL
    WHERE partner_id = p_retailer_id;
    
    RETURN jsonb_build_object('success', TRUE, 'message', 'T-PIN verified successfully');
  ELSE
    -- Increment failed attempts
    UPDATE retailers
    SET 
      tpin_failed_attempts = tpin_failed_attempts + 1,
      tpin_locked_until = CASE 
        WHEN tpin_failed_attempts >= 4 THEN NOW() + INTERVAL '15 minutes'
        ELSE NULL
      END
    WHERE partner_id = p_retailer_id;
    
    IF v_retailer.tpin_failed_attempts >= 4 THEN
      RETURN jsonb_build_object(
        'success', FALSE, 
        'error', 'Account locked for 15 minutes due to too many failed attempts',
        'attempts_remaining', 0
      );
    ELSE
      RETURN jsonb_build_object(
        'success', FALSE, 
        'error', 'Invalid T-PIN',
        'attempts_remaining', 5 - v_retailer.tpin_failed_attempts - 1
      );
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION set_retailer_tpin(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION set_retailer_tpin(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION verify_retailer_tpin(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION verify_retailer_tpin(TEXT, TEXT) TO anon;

-- Add comment for documentation
COMMENT ON COLUMN retailers.tpin_hash IS 'Hashed T-PIN for transaction authorization';
COMMENT ON COLUMN retailers.tpin_enabled IS 'Whether T-PIN verification is enabled for this retailer';
COMMENT ON COLUMN retailers.tpin_failed_attempts IS 'Number of consecutive failed T-PIN attempts';
COMMENT ON COLUMN retailers.tpin_locked_until IS 'Timestamp until which the account is locked due to failed attempts';

