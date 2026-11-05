/**
 * Pay2New (BBPS-2) authoritative state machine.
 *
 * `pay2new_payments.state` is the SINGLE SOURCE OF TRUTH for a partner-API CC
 * payment. It is kept in lock-step with partner_wallet_ledger money movement by
 * the DB trigger `p2n_sync_payment_from_ledger` (see the 20261106 migration), so
 * it can never silently diverge from the money the way the old string-derived
 * status did.
 *
 * This module is the application-side reader/helper for that projection:
 *   - `readAuthoritativeState` — the state to SHOW the partner (bill/status).
 *   - `openRecoveryClaim`      — record the irreducible gap (we acted on a vendor
 *                                verdict that the vendor later contradicted) so
 *                                the loss is captured and claimable from Pay2New.
 *
 * Money is NEVER moved here; refunds/clawbacks stay in the pay route + crons,
 * which write the ledger markers the trigger projects from.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Pay2NewResolvedState, Pay2NewStatus } from './ledger-status'

export type Pay2NewPaymentState =
  | 'INITIATED'
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'REFUNDED'
  | 'UNDER_REVIEW'

export interface Pay2NewPaymentRow {
  request_id: string
  partner_id: string | null
  bill_fetch_ref: string | null
  amount: number | null
  charge: number | null
  total_debit: number | null
  state: Pay2NewPaymentState
  order_id: string | null
  operator_reference: string | null
  failed_confirmations: number | null
  refund_at: string | null
  clawback_at: string | null
  created_at: string
  updated_at: string
}

const PROJECTION_COLS =
  'request_id, partner_id, bill_fetch_ref, amount, charge, total_debit, state, order_id, operator_reference, failed_confirmations, refund_at, clawback_at, created_at, updated_at'

/**
 * Map the internal projection state to the partner-facing terminal/pending
 * status. UNDER_REVIEW / INITIATED are held → shown as PENDING (not a failure):
 * the money is still with us and the true outcome is not yet confirmed.
 */
export function toPartnerStatus(state: Pay2NewPaymentState): Pay2NewStatus {
  switch (state) {
    case 'SUCCESS':
      return 'SUCCESS'
    case 'FAILED':
      return 'FAILED'
    case 'REFUNDED':
      return 'REFUNDED'
    default:
      return 'PENDING'
  }
}

/**
 * Read the authoritative state for a request_id from the projection. Returns a
 * `Pay2NewResolvedState` (same shape bill/status already returns) or null when
 * there is no projection row yet (e.g. a payment created before the migration
 * backfill, or the retailer/direct flow) — callers fall back to the legacy
 * derivation in that case.
 */
export async function readAuthoritativeState(
  supabase: SupabaseClient,
  requestId: string
): Promise<Pay2NewResolvedState | null> {
  const { data, error } = await supabase
    .from('pay2new_payments')
    .select(PROJECTION_COLS)
    .eq('request_id', requestId)
    .maybeSingle()

  if (error || !data) return null
  const row = data as unknown as Pay2NewPaymentRow
  const status = toPartnerStatus(row.state)

  const updatedAt =
    row.clawback_at ||
    (status === 'REFUNDED' ? row.refund_at : null) ||
    row.updated_at ||
    row.created_at

  return {
    requestId: row.request_id,
    billFetchRef: row.bill_fetch_ref,
    orderId: status === 'SUCCESS' ? row.order_id : null,
    status,
    amount: row.amount,
    charge: row.charge,
    operatorReference: row.operator_reference,
    createdAt: row.created_at,
    updatedAt: updatedAt || row.created_at,
  }
}

export interface OpenRecoveryClaimInput {
  requestId: string
  partnerId?: string | null
  ownerType?: string
  amount?: number | null
  priorState: string
  vendorState: string
  refundEvidenceId?: number | null
  successEvidenceId?: number | null
  orderId?: string | null
  operatorReference?: string | null
  notes?: string | null
}

/**
 * Record a recovery claim when Pay2New contradicts a terminal verdict we already
 * acted on (classically: we REFUNDED on a "failed/not-found", and Pay2New later
 * confirms SUCCESS — the card WAS charged). Idempotent on request_id. Returns
 * true if a new claim was opened. Never throws.
 */
export async function openRecoveryClaim(
  supabase: SupabaseClient,
  input: OpenRecoveryClaimInput
): Promise<boolean> {
  try {
    const { data: existing } = await supabase
      .from('pay2new_recovery_claims')
      .select('id')
      .eq('request_id', input.requestId)
      .maybeSingle()
    if (existing) return false

    const { error } = await supabase.from('pay2new_recovery_claims').insert({
      request_id: input.requestId,
      partner_id: input.partnerId ?? null,
      owner_type: input.ownerType ?? 'partner_api',
      amount: input.amount ?? null,
      prior_state: input.priorState,
      vendor_state: input.vendorState,
      refund_evidence_id: input.refundEvidenceId ?? null,
      success_evidence_id: input.successEvidenceId ?? null,
      order_id: input.orderId ?? null,
      operator_reference: input.operatorReference ?? null,
      notes: input.notes ?? null,
      status: 'open',
    })
    if (error) {
      // Unique violation = a concurrent claim already opened; treat as no-op.
      if (!/duplicate|unique|23505/i.test(error.message || '')) {
        console.error('[Pay2New Recovery] failed to open claim:', error.message)
      }
      return false
    }
    console.warn(
      `[Pay2New Recovery] CLAIM OPENED request_id=${input.requestId} ` +
        `prior=${input.priorState} vendor=${input.vendorState} amount=${input.amount ?? '?'}`
    )
    return true
  } catch (e: any) {
    console.error('[Pay2New Recovery] open claim error:', e?.message)
    return false
  }
}
