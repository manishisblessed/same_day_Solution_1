-- Migration: Add TPIN support to distributors table
-- Mirrors the retailer TPIN system (supabase-tpin-migration.sql)

ALTER TABLE distributors
ADD COLUMN IF NOT EXISTS tpin_hash TEXT DEFAULT NULL;

ALTER TABLE distributors
ADD COLUMN IF NOT EXISTS tpin_enabled BOOLEAN DEFAULT FALSE;

ALTER TABLE distributors
ADD COLUMN IF NOT EXISTS tpin_failed_attempts INTEGER DEFAULT 0;

ALTER TABLE distributors
ADD COLUMN IF NOT EXISTS tpin_locked_until TIMESTAMP WITH TIME ZONE DEFAULT NULL;

CREATE OR REPLACE FUNCTION set_distributor_tpin(
  p_distributor_id TEXT,
  p_tpin TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_tpin_hash TEXT;
BEGIN
  IF LENGTH(p_tpin) < 4 OR LENGTH(p_tpin) > 6 THEN
    RAISE EXCEPTION 'T-PIN must be 4-6 digits';
  END IF;

  IF p_tpin ~ '[^0-9]' THEN
    RAISE EXCEPTION 'T-PIN must contain only digits';
  END IF;

  v_tpin_hash := encode(sha256(p_tpin::bytea), 'hex');

  UPDATE distributors
  SET
    tpin_hash = v_tpin_hash,
    tpin_enabled = TRUE,
    tpin_failed_attempts = 0,
    tpin_locked_until = NULL,
    updated_at = NOW()
  WHERE partner_id = p_distributor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Distributor not found';
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION verify_distributor_tpin(
  p_distributor_id TEXT,
  p_tpin TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_distributor RECORD;
  v_tpin_hash TEXT;
  v_result JSONB;
BEGIN
  SELECT tpin_hash, tpin_enabled, tpin_failed_attempts, tpin_locked_until
  INTO v_distributor
  FROM distributors
  WHERE partner_id = p_distributor_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Distributor not found');
  END IF;

  IF NOT v_distributor.tpin_enabled OR v_distributor.tpin_hash IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'T-PIN not set. Please set your T-PIN first.');
  END IF;

  IF v_distributor.tpin_locked_until IS NOT NULL AND v_distributor.tpin_locked_until > NOW() THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Account temporarily locked due to too many failed attempts. Try again later.',
      'locked_until', v_distributor.tpin_locked_until
    );
  END IF;

  v_tpin_hash := encode(sha256(p_tpin::bytea), 'hex');

  IF v_tpin_hash = v_distributor.tpin_hash THEN
    UPDATE distributors
    SET tpin_failed_attempts = 0, tpin_locked_until = NULL
    WHERE partner_id = p_distributor_id;

    RETURN jsonb_build_object('success', true);
  ELSE
    UPDATE distributors
    SET tpin_failed_attempts = COALESCE(tpin_failed_attempts, 0) + 1,
        tpin_locked_until = CASE
          WHEN COALESCE(tpin_failed_attempts, 0) + 1 >= 5 THEN NOW() + INTERVAL '30 minutes'
          ELSE NULL
        END
    WHERE partner_id = p_distributor_id;

    IF v_distributor.tpin_failed_attempts + 1 >= 5 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Too many failed attempts. Account locked for 30 minutes.',
        'locked', true
      );
    ELSE
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Invalid T-PIN',
        'attempts_remaining', 5 - v_distributor.tpin_failed_attempts - 1
      );
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION set_distributor_tpin(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION set_distributor_tpin(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION verify_distributor_tpin(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION verify_distributor_tpin(TEXT, TEXT) TO anon;

COMMENT ON COLUMN distributors.tpin_hash IS 'Hashed T-PIN for transaction authorization';
COMMENT ON COLUMN distributors.tpin_enabled IS 'Whether T-PIN verification is enabled for this distributor';
COMMENT ON COLUMN distributors.tpin_failed_attempts IS 'Number of consecutive failed T-PIN attempts';
COMMENT ON COLUMN distributors.tpin_locked_until IS 'Timestamp until which the account is locked due to failed attempts';
