-- ============================================================
-- Pay2New (BBPS-2 Credit Card) — Authoritative state + evidence
-- Run once in Supabase SQL editor (or via supabase db push)
-- ============================================================
--
-- WHY: Until now the "status" of a Pay2New partner-API payment was DERIVED on
-- every read by string-parsing the partner_wallet_ledger DEBIT row (OrderID in
-- the description, a REFUND_<id> marker, the status column). Money movement and
-- status were coupled only by naming convention across ~7 code paths, so any
-- out-of-band wallet credit (manual float correction, generic reversal) returned
-- the money WITHOUT flipping the derived status — stranding records at PENDING
-- (incident: 5 Nov 2026 Pay2New reversals).
--
-- WHAT: Three tables + one exception-safe trigger that turn status into an
-- explicit, owned projection kept in lock-step with ledger money movement:
--
--   1. pay2new_payments        — single source of truth for state per request_id.
--   2. pay2new_status_log      — append-only evidence: the EXACT raw vendor
--                                payload for every status probe (recovery claims).
--   3. pay2new_recovery_claims — opened when the vendor contradicts a prior
--                                terminal state (e.g. we REFUNDED, vendor later
--                                SUCCESS) so losses are captured + claimable.
--
-- The trigger maintains pay2new_payments from partner_wallet_ledger activity and
-- is wrapped so it can NEVER fail a wallet write (money safety over projection).
-- ============================================================

-- ─── 1. State projection (single source of truth) ────────────────────────────
CREATE TABLE IF NOT EXISTS pay2new_payments (
  request_id             TEXT        PRIMARY KEY,         -- ledger reference_id (SDS…)
  partner_id             TEXT,                            -- owning partner (uuid as text)
  owner_type             TEXT        NOT NULL DEFAULT 'partner_api',
  bill_fetch_ref         TEXT,
  amount                 NUMERIC,                         -- bill amount (rupees)
  charge                 NUMERIC,                         -- service charge incl. GST
  total_debit            NUMERIC,                         -- amount + charge (wallet debit)
  card_last4             TEXT,
  customer_number        TEXT,
  state                  TEXT        NOT NULL DEFAULT 'PENDING'
                           CHECK (state IN ('INITIATED','PENDING','SUCCESS','FAILED','REFUNDED','UNDER_REVIEW')),
  order_id               TEXT,                            -- pay-step order_id (SUCCESS only)
  operator_reference     TEXT,
  vendor_last_status     TEXT,                            -- last normalized vendor verdict
  vendor_last_checked_at TIMESTAMPTZ,
  failed_confirmations   INT         NOT NULL DEFAULT 0,  -- the 30-min / 2-check gate counter
  refund_evidence_id     BIGINT,                          -- status_log row that justified the refund
  refund_at              TIMESTAMPTZ,
  clawback_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_p2n_payments_partner      ON pay2new_payments (partner_id);
CREATE INDEX IF NOT EXISTS idx_p2n_payments_bill_fetch   ON pay2new_payments (bill_fetch_ref);
CREATE INDEX IF NOT EXISTS idx_p2n_payments_state        ON pay2new_payments (state);
CREATE INDEX IF NOT EXISTS idx_p2n_payments_created      ON pay2new_payments (created_at);

-- ─── 2. Evidence store (append-only) ─────────────────────────────────────────
-- One row per vendor status probe, from EVERY source. raw_response holds the
-- exact bytes Pay2New returned — this is the legal evidence to claim a recovery
-- if Pay2New later flips a FAILED/REFUNDED verdict to SUCCESS.
CREATE TABLE IF NOT EXISTS pay2new_status_log (
  id                 BIGSERIAL   PRIMARY KEY,
  request_id         TEXT        NOT NULL,
  probed_by          TEXT        NOT NULL,                -- pay|status_api|recon|direct_recon|false_refund_cron|clawback_cron|admin|monitor
  parsed_status      TEXT,                                -- SUCCESS|FAILED|PENDING|REFUNDED|UNREACHABLE
  provider_success   BOOLEAN,                             -- the checkStatus .success flag
  not_found          BOOLEAN     NOT NULL DEFAULT FALSE,
  order_id           TEXT,
  operator_reference TEXT,
  amount             NUMERIC,
  error              TEXT,
  raw_response       JSONB,                               -- EXACT vendor payload (evidence)
  probed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_p2n_status_log_request ON pay2new_status_log (request_id, probed_at DESC);
CREATE INDEX IF NOT EXISTS idx_p2n_status_log_status  ON pay2new_status_log (parsed_status);

-- ─── 3. Recovery claims (the irreducible-gap ledger) ─────────────────────────
CREATE TABLE IF NOT EXISTS pay2new_recovery_claims (
  id                  BIGSERIAL   PRIMARY KEY,
  request_id          TEXT        NOT NULL UNIQUE,
  partner_id          TEXT,
  owner_type          TEXT        NOT NULL DEFAULT 'partner_api',
  amount              NUMERIC,
  prior_state         TEXT,                               -- what we had (REFUNDED/FAILED)
  vendor_state        TEXT,                               -- what the vendor now says (SUCCESS)
  refund_evidence_id  BIGINT,                             -- status_log row that justified our refund
  success_evidence_id BIGINT,                             -- status_log row proving vendor SUCCESS
  order_id            TEXT,
  operator_reference  TEXT,
  clawback_attempted  BOOLEAN     NOT NULL DEFAULT FALSE,
  clawback_succeeded  BOOLEAN     NOT NULL DEFAULT FALSE,
  status              TEXT        NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','clawed_back','unrecoverable','claimed_from_vendor','closed')),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_p2n_recovery_status ON pay2new_recovery_claims (status);

-- ─── RLS — service role (backend) full access ────────────────────────────────
ALTER TABLE pay2new_payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay2new_status_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE pay2new_recovery_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_p2n_payments"        ON pay2new_payments;
DROP POLICY IF EXISTS "service_role_p2n_status_log"      ON pay2new_status_log;
DROP POLICY IF EXISTS "service_role_p2n_recovery_claims" ON pay2new_recovery_claims;
CREATE POLICY "service_role_p2n_payments"        ON pay2new_payments        FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "service_role_p2n_status_log"      ON pay2new_status_log      FOR ALL USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY "service_role_p2n_recovery_claims" ON pay2new_recovery_claims FOR ALL USING (TRUE) WITH CHECK (TRUE);

-- updated_at helper (reuse if an earlier migration created it).
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS p2n_payments_updated_at ON pay2new_payments;
CREATE TRIGGER p2n_payments_updated_at
  BEFORE UPDATE ON pay2new_payments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS p2n_recovery_updated_at ON pay2new_recovery_claims;
CREATE TRIGGER p2n_recovery_updated_at
  BEFORE UPDATE ON pay2new_recovery_claims
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── 4. Projection trigger (keeps state in lock-step with money) ──────────────
-- Maintains pay2new_payments from partner_wallet_ledger activity. Keyed off the
-- reference_id convention, so it tracks money moved by ANY path:
--   • SDS… DEBIT (debit>0)   → upsert payment, derive PENDING/SUCCESS/FAILED
--   • REFUND_<id>            → state := REFUNDED (unless already SUCCESS)
--   • CLAWBACK_<id>          → state := SUCCESS (false refund reversed)
--
-- SAFETY: the entire body is wrapped in an exception handler that swallows ALL
-- errors. The projection must NEVER roll back a wallet write — money movement
-- wins; a drift is caught by the invariant-monitor cron instead.
CREATE OR REPLACE FUNCTION p2n_sync_payment_from_ledger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_ref     TEXT := NEW.reference_id;
  v_base    TEXT;
  v_order   TEXT;
  v_opref   TEXT;
  v_amount  NUMERIC;
  v_charge  NUMERIC;
  v_card    TEXT;
  v_failcnt INT;
  v_state   TEXT;
BEGIN
  -- Only Pay2New rows are projected.
  IF COALESCE(NEW.service_type, '') <> 'pay2new' THEN
    RETURN NEW;
  END IF;

  -- ── REFUND marker → REFUNDED (money returned to partner) ──
  IF v_ref LIKE 'REFUND\_%' THEN
    v_base := substring(v_ref from '^REFUND_(.*)$');
    UPDATE pay2new_payments
       SET state      = CASE WHEN state = 'SUCCESS' THEN 'SUCCESS' ELSE 'REFUNDED' END,
           refund_at  = COALESCE(refund_at, NEW.created_at),
           updated_at = NOW()
     WHERE request_id = v_base;
    IF NOT FOUND THEN
      INSERT INTO pay2new_payments (request_id, partner_id, state, refund_at, created_at)
      VALUES (v_base, NEW.partner_id::text, 'REFUNDED', NEW.created_at, NEW.created_at)
      ON CONFLICT (request_id) DO NOTHING;
    END IF;
    RETURN NEW;
  END IF;

  -- ── CLAWBACK marker → SUCCESS (false refund reversed; card was charged) ──
  IF v_ref LIKE 'CLAWBACK\_%' THEN
    v_base := substring(v_ref from '^CLAWBACK_(.*)$');
    UPDATE pay2new_payments
       SET state       = 'SUCCESS',
           clawback_at = COALESCE(clawback_at, NEW.created_at),
           updated_at  = NOW()
     WHERE request_id = v_base;
    RETURN NEW;
  END IF;

  -- ── The payment DEBIT itself (SDS…, DEBIT, debit>0) ──
  IF v_ref LIKE 'SDS%' AND COALESCE(NEW.transaction_type, '') = 'DEBIT' AND COALESCE(NEW.debit, 0) > 0 THEN
    v_order := substring(NEW.description from 'OrderID:([^ |]+)');
    IF v_order = 'N/A' THEN v_order := NULL; END IF;
    v_opref := substring(NEW.description from 'Ref:([^ |]+)');
    IF v_opref = 'N/A' THEN v_opref := NULL; END IF;
    v_amount := NULLIF(substring(NEW.description from '₹([0-9.]+) \+'), '')::numeric;
    v_charge := NULLIF(substring(NEW.description from '₹[0-9.]+ \+ ₹([0-9.]+) charge'), '')::numeric;
    v_card   := substring(NEW.description from 'Card:\*+([0-9]+)');
    v_failcnt := COALESCE(NULLIF(substring(NEW.description from 'FailedConfirmed\(([0-9]+)\)'), '')::int, 0);

    v_state := CASE
      WHEN v_order IS NOT NULL THEN 'SUCCESS'
      WHEN lower(COALESCE(NEW.status, '')) = 'failed' THEN 'FAILED'
      WHEN NEW.description ILIKE '%ReviewRequired%' THEN 'UNDER_REVIEW'
      ELSE 'PENDING'
    END;

    INSERT INTO pay2new_payments (
      request_id, partner_id, owner_type, bill_fetch_ref, amount, charge, total_debit,
      card_last4, state, order_id, operator_reference, failed_confirmations, created_at
    ) VALUES (
      v_ref, NEW.partner_id::text, 'partner_api', NEW.bill_fetch_ref, v_amount, v_charge, NEW.debit,
      v_card, v_state, v_order, v_opref, v_failcnt, NEW.created_at
    )
    ON CONFLICT (request_id) DO UPDATE SET
      bill_fetch_ref       = COALESCE(EXCLUDED.bill_fetch_ref, pay2new_payments.bill_fetch_ref),
      amount               = COALESCE(EXCLUDED.amount, pay2new_payments.amount),
      charge               = COALESCE(EXCLUDED.charge, pay2new_payments.charge),
      total_debit          = COALESCE(EXCLUDED.total_debit, pay2new_payments.total_debit),
      card_last4           = COALESCE(EXCLUDED.card_last4, pay2new_payments.card_last4),
      order_id             = COALESCE(EXCLUDED.order_id, pay2new_payments.order_id),
      operator_reference   = COALESCE(EXCLUDED.operator_reference, pay2new_payments.operator_reference),
      failed_confirmations = GREATEST(pay2new_payments.failed_confirmations, EXCLUDED.failed_confirmations),
      -- Never downgrade a terminal state; OrderID (SUCCESS) always wins.
      state = CASE
        WHEN EXCLUDED.order_id IS NOT NULL THEN 'SUCCESS'
        WHEN pay2new_payments.state IN ('SUCCESS','REFUNDED') THEN pay2new_payments.state
        WHEN EXCLUDED.state = 'FAILED' THEN 'FAILED'
        WHEN EXCLUDED.state = 'UNDER_REVIEW' AND pay2new_payments.state = 'PENDING' THEN 'UNDER_REVIEW'
        ELSE pay2new_payments.state
      END,
      updated_at = NOW();
    RETURN NEW;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Projection must never break a wallet write. Drift is caught by the monitor.
  RETURN NEW;
END;
$$;

-- WHEN clause keeps the hot wallet-ledger table untouched for every non-Pay2New
-- service (payout, aeps, …): the function only runs for pay2new rows.
DROP TRIGGER IF EXISTS p2n_sync_payment_from_ledger_trg ON partner_wallet_ledger;
CREATE TRIGGER p2n_sync_payment_from_ledger_trg
  AFTER INSERT OR UPDATE ON partner_wallet_ledger
  FOR EACH ROW
  WHEN (NEW.service_type = 'pay2new')
  EXECUTE FUNCTION p2n_sync_payment_from_ledger();

-- ─── 5. Backfill from existing ledger (idempotent) ───────────────────────────
INSERT INTO pay2new_payments (
  request_id, partner_id, owner_type, bill_fetch_ref, amount, charge, total_debit,
  card_last4, state, order_id, operator_reference, failed_confirmations, created_at
)
SELECT
  d.reference_id,
  d.partner_id::text,
  'partner_api',
  d.bill_fetch_ref,
  NULLIF(substring(d.description from '₹([0-9.]+) \+'), '')::numeric,
  NULLIF(substring(d.description from '₹[0-9.]+ \+ ₹([0-9.]+) charge'), '')::numeric,
  d.debit,
  substring(d.description from 'Card:\*+([0-9]+)'),
  CASE
    WHEN EXISTS (SELECT 1 FROM partner_wallet_ledger c
                  WHERE c.partner_id = d.partner_id AND c.reference_id = 'CLAWBACK_' || d.reference_id)
      THEN 'SUCCESS'
    WHEN d.description ~ 'OrderID:' AND substring(d.description from 'OrderID:([^ |]+)') <> 'N/A'
      THEN 'SUCCESS'
    WHEN EXISTS (SELECT 1 FROM partner_wallet_ledger r
                  WHERE r.partner_id = d.partner_id AND r.reference_id = 'REFUND_' || d.reference_id)
      THEN 'REFUNDED'
    WHEN lower(COALESCE(d.status, '')) = 'failed' THEN 'FAILED'
    WHEN d.description ILIKE '%ReviewRequired%' THEN 'UNDER_REVIEW'
    ELSE 'PENDING'
  END,
  CASE WHEN substring(d.description from 'OrderID:([^ |]+)') = 'N/A' THEN NULL
       ELSE substring(d.description from 'OrderID:([^ |]+)') END,
  CASE WHEN substring(d.description from 'Ref:([^ |]+)') = 'N/A' THEN NULL
       ELSE substring(d.description from 'Ref:([^ |]+)') END,
  COALESCE(NULLIF(substring(d.description from 'FailedConfirmed\(([0-9]+)\)'), '')::int, 0),
  d.created_at
FROM partner_wallet_ledger d
WHERE d.service_type = 'pay2new'
  AND d.transaction_type = 'DEBIT'
  AND d.reference_id LIKE 'SDS%'
  AND COALESCE(d.debit, 0) > 0
ON CONFLICT (request_id) DO NOTHING;

-- Stamp refund_at / clawback_at timestamps from the existing marker rows.
UPDATE pay2new_payments p
   SET refund_at = r.created_at
  FROM partner_wallet_ledger r
 WHERE r.reference_id = 'REFUND_' || p.request_id
   AND p.refund_at IS NULL;

UPDATE pay2new_payments p
   SET clawback_at = c.created_at
  FROM partner_wallet_ledger c
 WHERE c.reference_id = 'CLAWBACK_' || p.request_id
   AND p.clawback_at IS NULL;

-- ─── 6. Drift view (money vs state must always agree) ─────────────────────────
-- Any row here is a divergence the invariant-monitor cron should alert on.
CREATE OR REPLACE VIEW pay2new_state_drift AS
SELECT
  p.request_id,
  p.partner_id,
  p.state,
  p.total_debit,
  (SELECT TRUE FROM partner_wallet_ledger r
     WHERE r.reference_id = 'REFUND_' || p.request_id LIMIT 1)   AS has_refund,
  (SELECT TRUE FROM partner_wallet_ledger c
     WHERE c.reference_id = 'CLAWBACK_' || p.request_id LIMIT 1) AS has_clawback,
  p.order_id,
  p.created_at
FROM pay2new_payments p
WHERE
  -- refunded money but state not terminal-refunded
  (EXISTS (SELECT 1 FROM partner_wallet_ledger r WHERE r.reference_id = 'REFUND_' || p.request_id)
     AND NOT EXISTS (SELECT 1 FROM partner_wallet_ledger c WHERE c.reference_id = 'CLAWBACK_' || p.request_id)
     AND p.state <> 'REFUNDED')
  OR
  -- clawed back (card charged) but state not SUCCESS
  (EXISTS (SELECT 1 FROM partner_wallet_ledger c WHERE c.reference_id = 'CLAWBACK_' || p.request_id)
     AND p.state <> 'SUCCESS')
  OR
  -- order recorded but state not SUCCESS
  (p.order_id IS NOT NULL AND p.state <> 'SUCCESS');
