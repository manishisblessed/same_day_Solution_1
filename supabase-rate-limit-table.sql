-- Persistent rate limiting table (replaces in-memory Map)
-- Survives deploys/restarts, works across multiple instances

CREATE TABLE IF NOT EXISTS rate_limit_entries (
  id         BIGSERIAL PRIMARY KEY,
  key        TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 1,
  reset_at   TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limit_key ON rate_limit_entries (key);
CREATE INDEX IF NOT EXISTS idx_rate_limit_reset ON rate_limit_entries (reset_at);

-- Auto-cleanup expired entries every hour via pg_cron (if available).
-- If pg_cron is not available, the app cleans stale entries inline.
DO $body$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'cleanup-rate-limits',
      '0 * * * *',
      'DELETE FROM rate_limit_entries WHERE reset_at < now()'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available, skipping scheduled cleanup';
END $body$;

-- RPC for atomic rate-limit check-and-increment (single round-trip)
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key TEXT,
  p_max_requests INTEGER,
  p_window_ms INTEGER
)
RETURNS JSONB AS $$
DECLARE
  v_entry RECORD;
  v_now TIMESTAMPTZ := now();
  v_reset_at TIMESTAMPTZ := v_now + (p_window_ms || ' milliseconds')::interval;
BEGIN
  -- Clean this specific key if expired, then upsert atomically
  DELETE FROM rate_limit_entries WHERE key = p_key AND reset_at < v_now;

  INSERT INTO rate_limit_entries (key, count, reset_at)
  VALUES (p_key, 1, v_reset_at)
  ON CONFLICT (key) DO UPDATE
    SET count = rate_limit_entries.count + 1
  RETURNING count, reset_at INTO v_entry;

  IF v_entry.count > p_max_requests THEN
    RETURN jsonb_build_object(
      'limited', TRUE,
      'count', v_entry.count,
      'retry_after_sec', EXTRACT(EPOCH FROM (v_entry.reset_at - v_now))::INTEGER
    );
  END IF;

  RETURN jsonb_build_object('limited', FALSE, 'count', v_entry.count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION check_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;
