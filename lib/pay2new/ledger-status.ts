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
    : 10) * 60_000

function parseOrderId(desc: string | null): string | null {
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

  const { data: refundEntries } = await supabase
    .from('partner_wallet_ledger')
    .select('id, created_at')
    .eq('partner_id', partnerId)
    .eq('reference_id', `REFUND_${requestId}`)
    .limit(1)
  const wasRefunded = !!(refundEntries && refundEntries.length > 0)

  let status: Pay2NewStatus
  let updatedAt = debitEntry.created_at

  if (wasRefunded) {
    status = 'REFUNDED'
    updatedAt = refundEntries![0].created_at
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
        } else if (up.success && (up.status === 'FAILED' || up.status === 'REFUNDED')) {
          // Only trust a negative verdict for a payment old enough that it cannot
          // still be in-flight; otherwise stay PENDING (the recon cron refunds
          // genuinely-stuck debits and emits the terminal webhook).
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
