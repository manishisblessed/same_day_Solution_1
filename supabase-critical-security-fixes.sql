-- CRITICAL SECURITY FIXES
-- Run immediately before production deployment

-- ══════════════════════════════════════════════════════════════
-- 1. TPIN: Revoke anon/authenticated access, switch to bcrypt
-- ══════════════════════════════════════════════════════════════

-- Revoke direct access — TPIN must only be called via API routes (service_role)
REVOKE EXECUTE ON FUNCTION set_retailer_tpin(TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION set_retailer_tpin(TEXT, TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION verify_retailer_tpin(TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION verify_retailer_tpin(TEXT, TEXT) FROM authenticated;

-- Ensure pgcrypto is available for bcrypt
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Recreate set_retailer_tpin with bcrypt hashing
CREATE OR REPLACE FUNCTION set_retailer_tpin(
  p_retailer_id TEXT,
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

  -- Use bcrypt (cost factor 10) instead of SHA-256
  v_tpin_hash := crypt(p_tpin, gen_salt('bf', 10));

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

-- Recreate verify_retailer_tpin with bcrypt comparison + stricter lockout
CREATE OR REPLACE FUNCTION verify_retailer_tpin(
  p_retailer_id TEXT,
  p_tpin TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_retailer RECORD;
BEGIN
  SELECT tpin_hash, tpin_enabled, tpin_failed_attempts, tpin_locked_until
  INTO v_retailer
  FROM retailers
  WHERE partner_id = p_retailer_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'Retailer not found');
  END IF;

  -- TPIN MUST be configured for any money movement
  IF NOT v_retailer.tpin_enabled OR v_retailer.tpin_hash IS NULL THEN
    RETURN jsonb_build_object('success', FALSE, 'error', 'T-PIN not configured. Please set up your T-PIN first.', 'tpin_required', TRUE);
  END IF;

  IF v_retailer.tpin_locked_until IS NOT NULL AND v_retailer.tpin_locked_until > NOW() THEN
    RETURN jsonb_build_object(
      'success', FALSE,
      'error', 'Account temporarily locked due to too many failed attempts',
      'locked_until', v_retailer.tpin_locked_until
    );
  END IF;

  -- bcrypt comparison
  IF v_retailer.tpin_hash = crypt(p_tpin, v_retailer.tpin_hash) THEN
    UPDATE retailers
    SET tpin_failed_attempts = 0, tpin_locked_until = NULL
    WHERE partner_id = p_retailer_id;

    RETURN jsonb_build_object('success', TRUE, 'message', 'T-PIN verified successfully');
  ELSE
    UPDATE retailers
    SET
      tpin_failed_attempts = tpin_failed_attempts + 1,
      tpin_locked_until = CASE
        WHEN tpin_failed_attempts >= 4 THEN NOW() + INTERVAL '30 minutes'
        ELSE NULL
      END
    WHERE partner_id = p_retailer_id;

    IF v_retailer.tpin_failed_attempts >= 4 THEN
      RETURN jsonb_build_object(
        'success', FALSE,
        'error', 'Account locked for 30 minutes due to too many failed attempts',
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

-- Only service_role can call these functions
GRANT EXECUTE ON FUNCTION set_retailer_tpin(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION verify_retailer_tpin(TEXT, TEXT) TO service_role;
