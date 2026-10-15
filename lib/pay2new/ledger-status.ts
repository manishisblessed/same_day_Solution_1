/**
 * Shared resolver for the authoritative state of a Pay2New (BBPS-2) partner
 * payment, read off its partner_wallet_ledger DEBIT row.
 *
 * Used by:
 *   - POST /api/partner/pay2new/bill/status      (status lookup, incl. by bill_fetch_ref)
 *   - POST /api/partner/pay2new/bill/pay          (idempotent replay of a prior attempt)
 *
 * Why this exists: Pay2New's pay-step order_id ("P2N_PAY…"/"P2F…") is stored in
 * the ledger DESCRIPTION ("OrderID:…"), NOT in payout_transaction_id (a uuid
 * column that cannot hold it). The previous status endpoint read order_id from
 * payout_transaction_id and so always returned null + mislabelled SUCCESS rows
 * as PENDING. This resolver reads the order_id from the description and derives
 * status consistently from: refund presence → failed flag → recorded order →
 * (optional) authoritative upstream check.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { pay2newCheckStatus } from '@/services/pay2new'

export interface Pay2NewDebitRow {
  id: string
  reference_id: string
  description: string | null
  status: string | null
  created_at: string
  debit?: number | null
  bill_fetch_ref?: string | null
}

export type Pay2NewStatus = 'SUCCESS' | 'FAILED' | 'PENDING' | 'REFUNDED'

export interface Pay2NewResolvedState {
  requestId: string
  billFetchRef: string | null
  /** Pay-step order_id (P2N_PAY…). Non-null only on SUCCESS. */
  orderId: string | null
  status: Pay2NewStatus
  amount: number | null
  charge: number | null
  operatorReference: string | null
  createdAt: string
  updatedAt: string
}

const SELECT_COLS = 'id, reference_id, description, status, created_at, debit, bill_fetch_ref'

// A negative provider verdict ("no transaction found" -> FAILED) is only trusted
// once a payment is older than this. Younger payments may simply still be
// in-flight at the provider (the pay call can block up to ~90s), so we keep them
// PENDING rather than prematurely reporting FAILED. The reconciliation cron owns
// the authoritative refund once a payment is genuinely stuck.
const NEGATIVE_VERDICT_MIN_AGE_MS =
  (Number(process.env.PAY2NEW_NEGATIVE_VERDICT_MIN_AGE_MIN) > 0
    ? Number(process.env.PAY2NEW_NEGATIVE_VERDICT_MIN_AGE_MIN)
    : 15) * 60_000

export function parseOrderId(desc: string | null): string | null {
  const m = desc?.match(/OrderID:([^\s|]+)/)
  return m && m[1] !== 'N/A' ? m[1] : null
}

function parseOperatorRef(desc: string | null): string | null {
  const m = desc?.match(/Ref:([^\s|]+)/)
  return m && m[1] !== 'N/A' ? m[1] : null
}

function parseAmounts(desc: string | null): { amount: number | null; charge: number | null } {
  const m = desc?.match(/₹([\d.]+)\s*\+\s*₹([\d.]+)\s*charge/)
  return { amount: m ? parseFloat(m[1]) : null, charge: m ? parseFloat(m[2]) : null }
}

/**
 * Resolve the terminal/pending state of a Pay2New DEBIT row using ONLY local
 * data already in hand (no upstream provider call). Intended for BULK listing /
 * reconciliation endpoints that resolve many rows at once: the caller performs a
 * single refund/clawback lookup for the whole page and passes the result in.
 *
 * State precedence (identical to resolvePay2NewDebitState):
 *   refunded (REFUND present, no CLAWBACK) → failed flag → recorded order → pending
 *
 * No money is moved and no description is mutated. PENDING rows are left as-is;
 * the reconciliation cron and the single-row status endpoint own authoritative
 * upstream confirmation.
 */
export function resolvePay2NewDebitStateLocal(
  debitEntry: Pay2NewDebitRow,
  opts: { refunded: boolean; refundedAt?: string | null }
): Pay2NewResolvedState {
  const { amount, charge } = parseAmounts(debitEntry.description)
  const orderId = parseOrderId(debitEntry.description)
  const operatorReference = parseOperatorRef(debitEntry.description)

  let status: Pay2NewStatus
  let updatedAt = debitEntry.created_at

  if (opts.refunded) {
    status = 'REFUNDED'
    updatedAt = opts.refundedAt || updatedAt
  } else if ((debitEntry.status || '').toLowerCase() === 'failed') {
    status = 'FAILED'
  } else if (orderId) {
    status = 'SUCCESS'
  } else {
    status = 'PENDING'
  }

  return {
    requestId: debitEntry.reference_id,
    billFetchRef: debitEntry.bill_fetch_ref ?? null,
    orderId: status === 'SUCCESS' ? orderId : null,
    status,
    amount,
    charge,
    operatorReference,
    createdAt: debitEntry.created_at,
    updatedAt,
  }
}

/**
 * Batch-resolve a page of Pay2New DEBIT rows with a SINGLE refund/clawback
 * lookup. Returns one resolved state per input row (order preserved).
 */
export async function resolvePay2NewDebitStatesBatch(
  supabase: SupabaseClient,
  partnerId: string,
  debitRows: Pay2NewDebitRow[]
): Promise<Pay2NewResolvedState[]> {
  if (debitRows.length === 0) return []

  const refKeys: string[] = []
  for (const row of debitRows) {
    refKeys.push(`REFUND_${row.reference_id}`, `CLAWBACK_${row.reference_id}`)
  }

  // Chunk the IN() lookup so a large page can never overflow the PostgREST
  // query-string length limit (each key is ~24 chars; 2× rows per page).
  const CHUNK = 300
  const refundAtById = new Map<string, string>()
  const clawbackIds = new Set<string>()
  for (let i = 0; i < refKeys.length; i += CHUNK) {
    const slice = refKeys.slice(i, i + CHUNK)
    const { data: refundEntries } = await supabase
      .from('partner_wallet_ledger')
      .select('reference_id, created_at')
      .eq('partner_id', partnerId)
      .in('reference_id', slice)
    for (const r of (refundEntries || []) as Array<{ reference_id: string; created_at: string }>) {
      if (r.reference_id.startsWith('REFUND_')) {
        refundAtById.set(r.reference_id.slice('REFUND_'.length), r.created_at)
      } else if (r.reference_id.startsWith('CLAWBACK_')) {
        clawbackIds.add(r.reference_id.slice('CLAWBACK_'.length))
      }
    }
  }

  return debitRows.map((row) => {
    const refundedAt = refundAtById.get(row.reference_id)
    const refunded = !!refundedAt && !clawbackIds.has(row.reference_id)
    return resolvePay2NewDebitStateLocal(row, { refunded, refundedAt })
  })
}

/**
 * Find a partner's prior Pay2New payment attempt for a given bill_fetch_ref
 * (natural idempotency key) or an explicit client_ref. Returns the most recent
 * matching DEBIT row, or null. `excludeRequestId` lets a just-created debit skip
 * matching itself when resolving a concurrency conflict.
 */
export async function findPriorPay2NewAttempt(
  supabase: SupabaseClient,
  partnerId: string,
  billFetchRef: string,
  clientRef?: string | null,
  excludeRequestId?: string
): Promise<Pay2NewDebitRow | null> {
  const base = () =>
    supabase
      .from('partner_wallet_ledger')
      .select(SELECT_COLS)
      .eq('partner_id', partnerId)
      .eq('service_type', 'pay2new')
      .eq('transaction_type', 'DEBIT')
      .order('created_at', { ascending: false })
      .limit(2)

  if (billFetchRef) {
    const { data } = await base().eq('bill_fetch_ref', billFetchRef)
    const row = (data || []).find((r: any) => r.reference_id !== excludeRequestId)
    if (row) return row as Pay2NewDebitRow
  }

  if (clientRef) {
    const { data } = await base().eq('client_ref', clientRef)
    const row = (data || []).find((r: any) => r.reference_id !== excludeRequestId)
    if (row) return row as Pay2NewDebitRow
  }

  return null
}

/**
 * Resolve the terminal/pending state of a Pay2New DEBIT row.
 *
 * Money is never moved here. For a PENDING row (debited, no recorded order, not
 * failed, not refunded) it will — unless `checkUpstream: false` — ask Pay2New for
 * the authoritative status and, on a confirmed SUCCESS, back-fill the order_id
 * into the description so the row resolves instantly next time. Refunds for
 * confirmed-failed PENDING rows are left to the pay route (synchronous) and the
 * reconciliation cron (asynchronous), keeping money movement in one place.
 */
export async function resolvePay2NewDebitState(
  supabase: SupabaseClient,
  partnerId: string,
  debitEntry: Pay2NewDebitRow,
  opts: { checkUpstream?: boolean } = {}
): Promise<Pay2NewResolvedState> {
  const requestId = debitEntry.reference_id
  const { amount, charge } = parseAmounts(debitEntry.description)
  let orderId = parseOrderId(debitEntry.description)
  let operatorReference = parseOperatorRef(debitEntry.description)

  // A REFUND_<id> means the wallet was credited back. A CLAWBACK_<id> means that
  // refund was later REVERSED (re-debited) because the vendor actually succeeded
  // — i.e. the refund was false. So the payment is only genuinely refunded when a
  // REFUND exists and NO clawback reversed it.
  const { data: refundEntries } = await supabase
    .from('partner_wallet_ledger')
    .select('id, reference_id, created_at')
    .eq('partner_id', partnerId)
    .in('reference_id', [`REFUND_${requestId}`, `CLAWBACK_${requestId}`])
  const refundRow = (refundEntries || []).find((r: any) => r.reference_id === `REFUND_${requestId}`)
  const hasClawback = (refundEntries || []).some((r: any) => r.reference_id === `CLAWBACK_${requestId}`)
  const wasRefunded = !!refundRow && !hasClawback

  let status: Pay2NewStatus
  let updatedAt = debitEntry.created_at

  if (wasRefunded) {
    status = 'REFUNDED'
    updatedAt = refundRow!.created_at
  } else if ((debitEntry.status || '').toLowerCase() === 'failed') {
    status = 'FAILED'
  } else if (orderId) {
    status = 'SUCCESS'
  } else {
    status = 'PENDING'
    if (opts.checkUpstream !== false) {
      try {
        const up = await pay2newCheckStatus({ request_id: requestId })
        if (up.success && up.status === 'SUCCESS') {
          status = 'SUCCESS'
          if (up.operator_reference) operatorReference = up.operator_reference
          if (up.order_id) orderId = up.order_id
          // Back-fill the order_id so this row resolves instantly next time.
          if (up.order_id && !/OrderID:/.test(debitEntry.description || '')) {
            await supabase
              .from('partner_wallet_ledger')
              .update({
                description: `${debitEntry.description || ''} | OrderID:${up.order_id} | Ref:${operatorReference || 'N/A'}`,
              })
              .eq('id', debitEntry.id)
          }
        } else if (up.success && !up.notFound && (up.status === 'FAILED' || up.status === 'REFUNDED')) {
          // Only trust a DEFINITIVE order-level negative verdict (NOT a "no
          // transaction found", which is inconclusive and routed to admin review)
          // and only once the payment is old enough that it cannot still be
          // in-flight; otherwise stay PENDING (held). The recon cron refunds
          // genuinely-failed debits; not-found is escalated to admin, never auto.
          const ageMs = Date.now() - new Date(debitEntry.created_at).getTime()
          if (ageMs >= NEGATIVE_VERDICT_MIN_AGE_MS) {
            status = up.status
            if (up.operator_reference) operatorReference = up.operator_reference
          }
        }
        // Any other state (incl. provider PENDING) -> leave PENDING.
      } catch {
        // Provider unreachable — leave PENDING; the recon cron will resolve it.
      }
    }
  }

  return {
    requestId,
    billFetchRef: debitEntry.bill_fetch_ref ?? null,
    orderId: status === 'SUCCESS' ? orderId : null,
    status,
    amount,
    charge,
    operatorReference,
    createdAt: debitEntry.created_at,
    updatedAt,
  }
}
