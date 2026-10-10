/**
 * Authoritative resolver for an AMBIGUOUS Pay2New pay/recharge outcome.
 *
 * The pay/recharge call debits the wallet BEFORE hitting the provider. If that
 * call times out or the network drops, the HTTP result is a transport failure
 * (`ambiguous: true`) and the real outcome is UNKNOWN — the biller may already
 * have charged the card. Refunding on that signal alone is exactly what caused
 * the silent losses (we refunded the wallet while the vendor had succeeded).
 *
 * This helper confirms the real outcome via the provider's transactionStatus
 * API before any money moves:
 *   - SUCCESS                      -> 'SUCCESS' (record the order; never refund)
 *   - definitive order-level FAIL  -> 'FAILED'  (safe to refund)
 *   - "no transaction found" FRESH -> 'PENDING' (provider index may lag a real
 *                                     charge; let the reconciliation cron decide
 *                                     once the txn is old enough — NEVER refund
 *                                     a possibly-charged card here)
 *   - provider PENDING / unreachable -> 'PENDING'
 *
 * 'PENDING' means: leave the debit in place, do NOT refund, do NOT mark failed.
 * The reconciliation cron owns the authoritative late refund for genuinely
 * stuck/failed debits (with its own age window), so money movement stays in one
 * place and a false refund can never double-charge the customer.
 */

import { pay2newCheckStatus } from './checkStatus'

export type Pay2NewSettleOutcome = 'SUCCESS' | 'FAILED' | 'PENDING'

export interface Pay2NewSettleResult {
  outcome: Pay2NewSettleOutcome
  orderId?: string
  operatorReference?: string
  amount?: number | string
  error?: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function settlePay2New(
  requestId: string,
  opts: { attempts?: number; spacingMs?: number } = {}
): Promise<Pay2NewSettleResult> {
  const attempts = Math.max(1, opts.attempts ?? 2)
  const spacingMs = opts.spacingMs ?? 2500

  let last: Pay2NewSettleResult = { outcome: 'PENDING' }

  for (let i = 0; i < attempts; i++) {
    let res: Awaited<ReturnType<typeof pay2newCheckStatus>>
    try {
      res = await pay2newCheckStatus({ request_id: requestId })
    } catch {
      res = { success: false }
    }

    if (res.success) {
      if (res.status === 'SUCCESS') {
        return {
          outcome: 'SUCCESS',
          orderId: res.order_id,
          operatorReference: res.operator_reference,
          amount: res.amount,
        }
      }
      // A definitive order-level FAILED/REFUNDED (an actual order block, NOT the
      // "no transaction found" placeholder) is safe to act on immediately.
      if ((res.status === 'FAILED' && !res.notFound) || res.status === 'REFUNDED') {
        return { outcome: 'FAILED', error: res.error }
      }
      // notFound (fresh) or provider PENDING -> inconclusive; keep polling / defer.
      last = { outcome: 'PENDING', error: res.error }
    }

    if (i < attempts - 1) await sleep(spacingMs)
  }

  return last
}
