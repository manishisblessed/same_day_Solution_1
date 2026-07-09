-- ============================================================================
-- Partner TPIN Support Migration
-- ============================================================================
-- Adds TPIN columns to the partners table and creates verify/set functions
-- so partners can use the web dashboard settlement & BBPS features
-- (same flow as retailers).
-- ============================================================================

-- 1. Add TPIN columns to partners table
ALTER TABLE partners ADD COLUMN IF NOT EXISTS tpin_hash TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS tpin_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS tpin_failed_attempts INTEGER DEFAULT 0;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS tpin_locked_until TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN partners.tpin_hash IS 'Hashed T-PIN (bcrypt) for transaction authorization';
COMMENT ON COLUMN partners.tpin_enabled IS 'Whether T-PIN verification is enabled for this partner';
COMMENT ON COLUMN partners.tpin_failed_attempts IS 'Number of consecutive failed T-PIN attempts';
COMMENT ON COLUMN partners.tpin_locked_until IS 'Timestamp until which the account is locked due to failed attempts';

-- 2. Function to set T-PIN for a partner (bcrypt)
CREATE OR REPLACE FUNCTION set_partner_tpin(
  p_partner_id TEXT,
  p_tpin TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_tpin_hash TEXT;
BEGIN
  IF LENGTH(p_tpin) < 4 OR LENGTH(p_tpin) > 6 THEN
    RAISE EXCEPTION 'T-PIN must be 4-6 digits';
  END IF;

  IF p_tpin !~ '^\d+$' THEN
    RAISE EXCEPTION 'T-PIN must contain only digits';
  END IF;

  v_tpin_hash := crypt(p_tpin, gen_salt('bf', 10));

  UPDATE partners
  SET
    tpin_hash = v_tpin_hash,
    tpin_enabled = TRUE,
    tpin_failed_attempts = 0,
    tpin_locked_until = NULL,
    updated_at = NOW()
  WHERE id = p_partner_id::uuid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partner not found';
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Function to verify T-PIN for a partner (bcrypt)
CREATE OR REPLACE FUNCTION verify_partner_tpin(
  p_partner_id TEXT,
  p_tpin TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_partner RECORD;
BEGIN
  SELECT tpin_hash, tpin_enabled, tpin_failed_attempts, tpin_locked_until
  INTO v_partner
  FROM partners
  WHERE id = p_partner_id::uuid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Partner not found');
  END IF;

  IF NOT v_partner.tpin_enabled OR v_partner.tpin_hash IS NULL THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'T-PIN not configured. Please set up your T-PIN first.',
      'tpin_required', TRUE
    );
  END IF;

  IF v_partner.tpin_locked_until IS NOT NULL AND v_partner.tpin_locked_until > NOW() THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Account temporarily locked due to too many failed attempts',
      'locked_until', v_partner.tpin_locked_until
    );
  END IF;

  -- bcrypt comparison
  IF v_partner.tpin_hash = crypt(p_tpin, v_partner.tpin_hash) THEN
    -- Reset failed attempts on success
    UPDATE partners
    SET tpin_failed_attempts = 0, tpin_locked_until = NULL
    WHERE id = p_partner_id::uuid;

    RETURN jsonb_build_object('success', TRUE, 'message', 'T-PIN verified successfully');
  ELSE
    UPDATE partners
    SET
      tpin_failed_attempts = tpin_failed_attempts + 1,
      tpin_locked_until = CASE
        WHEN tpin_failed_attempts >= 4 THEN NOW() + INTERVAL '30 minutes'
        ELSE NULL
      END
    WHERE id = p_partner_id::uuid;

    IF v_partner.tpin_failed_attempts >= 4 THEN
      RETURN jsonb_build_object(
        'success', FALSE,
        'error', 'Account locked for 30 minutes due to too many failed attempts',
        'attempts_remaining', 0
      );
    ELSE
      RETURN jsonb_build_object(
        'success', FALSE,
        'error', 'Invalid T-PIN',
        'attempts_remaining', 5 - v_partner.tpin_failed_attempts - 1
      );
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Grant execute to service_role only (same security as retailer TPIN)
GRANT EXECUTE ON FUNCTION set_partner_tpin(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION verify_partner_tpin(TEXT, TEXT) TO service_role;
