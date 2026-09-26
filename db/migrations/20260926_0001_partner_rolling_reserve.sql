-- ============================================================================
-- PARTNER ROLLING RESERVE (Phase 3)
-- ============================================================================
-- Instant-settling partners (e.g. ECAPS) pay their own end-users the moment we
-- forward a POS SUCCESS. A small fraction of Pine Labs "successes" auto-reverse
-- later (terminal timeout → card auto-refund). The confirmation micro-hold
-- (Phase 1) + fast reconcile (Phase 2) catch nearly all of them, but a residual
-- tail can still reverse AFTER we've settled the partner. This rolling reserve
-- is the financial backstop for that residual: a configurable % of each partner
-- settlement is held back for `reserve_hold_days`, and reversal losses are
-- covered automatically from the held balance instead of a manual clawback.
--
-- Additive + idempotent. Defaults keep it a NO-OP: reserve_percent defaults to
-- 0, so nothing is held back until an admin sets a percent for a partner.
-- ============================================================================

-- ── Per-partner reserve configuration ───────────────────────────────────────
ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS reserve_percent   NUMERIC(6,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reserve_hold_days INTEGER      NOT NULL DEFAULT 7;

COMMENT ON COLUMN partners.reserve_percent   IS 'Rolling-reserve rate (% of net settlement) held back per POS settlement to cover later reversals. 0 = disabled.';
COMMENT ON COLUMN partners.reserve_hold_days IS 'Days a reserve HOLD is retained before it is released back to the partner wallet.';

-- ── Reserve ledger ──────────────────────────────────────────────────────────
-- Append-only. Signed `balance_delta` sums to the partner's live reserve balance
--   HOLD    : +amount  (held back at settlement time; not yet in partner wallet)
--   RELEASE : -amount  (matured hold returned to partner wallet)
--   LOSS    : -amount  (reversal loss covered from the reserve)
CREATE TABLE IF NOT EXISTS partner_reserve_ledger (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id     UUID NOT NULL,
  txn_id         TEXT,
  entry_type     TEXT NOT NULL CHECK (entry_type IN ('HOLD', 'RELEASE', 'LOSS')),
  amount         NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  balance_delta  NUMERIC(14,2) NOT NULL,
  reference_id   TEXT NOT NULL,
  description    TEXT,
  -- HOLD rows only: when the hold matures and may be released.
  hold_release_at TIMESTAMPTZ,
  -- HOLD rows only: flipped true once the hold has been released or consumed.
  consumed       BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency: a given settlement/release/loss reference can only post once.
CREATE UNIQUE INDEX IF NOT EXISTS uq_partner_reserve_ledger_reference
  ON partner_reserve_ledger(reference_id);

-- Fast balance + maturity scans per partner.
CREATE INDEX IF NOT EXISTS idx_partner_reserve_ledger_partner
  ON partner_reserve_ledger(partner_id, entry_type);

CREATE INDEX IF NOT EXISTS idx_partner_reserve_ledger_mature
  ON partner_reserve_ledger(partner_id, hold_release_at)
  WHERE entry_type = 'HOLD' AND consumed = false;

COMMENT ON TABLE  partner_reserve_ledger IS 'Rolling-reserve ledger per partner. HOLD (+) at settlement, RELEASE (-) on maturity, LOSS (-) on reversal cover. Balance = SUM(balance_delta).';
COMMENT ON COLUMN partner_reserve_ledger.balance_delta IS 'Signed effect on reserve balance: +HOLD, -RELEASE, -LOSS.';
COMMENT ON COLUMN partner_reserve_ledger.hold_release_at IS 'HOLD rows: earliest time the hold may be released back to the partner wallet.';
COMMENT ON COLUMN partner_reserve_ledger.consumed IS 'HOLD rows: true once released (matured) or drawn down to cover a loss.';
