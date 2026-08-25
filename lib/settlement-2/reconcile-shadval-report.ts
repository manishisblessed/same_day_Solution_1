import type { SupabaseClient } from '@supabase/supabase-js'
import { checkTransactionStatus } from '@/services/shadval-pay'
import { isGenuineProviderSuccess, computeShadvalRefundAmount } from '@/lib/settlement-2/shadval-refund'
import { raiseSettlementAlert } from '@/lib/settlement-alerts'

/**
 * Daily Settlement-2 (Shadval) reconciliation.
 *
 * WHY: after Option C we only refund on provider-confirmed failure, but a
 * transaction that was refunded earlier (e.g. a historical 60-min timeout
 * refund) can STILL settle at the bank days later. If that happens the
 * beneficiary got paid AND the user was refunded = a double-money loss.
 *
 * This job re-checks every FAILED + refunded Shadval settlement in the window
 * against the provider's live status. Any that the provider now confirms as a
 * genuine SUCCESS (money left, UTR present) is a CONFIRMED double-money case —
 * we raise a SETTLEMENT2_DOUBLE_MONEY admin alert so it can be clawed back
 * (scripts/reconcile-shadval-double-money.js). READ-ONLY on wallets: it never
 * moves money, only reports/alerts.
 *
 * Must run from a Shadval-whitelisted host (production EC2) so the status API
 * accepts the calls.
 */

export interface ShadvalReconcileOptions {
  /** Lookback window in days. Default 7. */
  days?: number
  /** Max settlements to verify in one run. Default 300. */
  limit?: number
  /** Parallel provider calls. Default 5. */
  concurrency?: number
  /** Raise admin alerts for confirmed double-money. Default true. */
  raiseAlerts?: boolean
}

export interface ShadvalDoubleMoneyHit {
  id: string
  reference_id: string
  retailer_id: string
  wallet: 'partner' | 'retailer'
  refunded: number
  provider_utr?: string
  provider_txn_status?: string
  status_message?: string
  created_at: string
}

export interface ShadvalReconcileResult {
  checked: number
  doubleMoney: ShadvalDoubleMoneyHit[]
  refundOk: number
  unverified: number
  totalLoss: number
}

async function findRefundCredit(
  supabase: SupabaseClient,
  retailerId: string,
  referenceId: string
): Promise<{ found: boolean; amount: number; wallet: 'partner' | 'retailer' }> {
  const refs = [`REFUND_${referenceId}`, `REFUND_TIMEOUT_${referenceId}`]

  const { data: partnerRow } = await supabase.from('partners').select('id').eq('id', retailerId).maybeSingle()
  const wallet: 'partner' | 'retailer' = partnerRow ? 'partner' : 'retailer'
  const table = wallet === 'partner' ? 'partner_wallet_ledger' : 'wallet_ledger'
  const idCol = wallet === 'partner' ? 'partner_id' : 'retailer_id'

  const { data } = await supabase
    .from(table)
    .select('credit')
    .eq(idCol, retailerId)
    .in('reference_id', refs)
    .gt('credit', 0)
    .limit(1)

  if (data && data.length > 0) {
    return { found: true, amount: parseFloat(String(data[0].credit)) || 0, wallet }
  }
  return { found: false, amount: 0, wallet }
}

export async function runShadvalReconciliation(
  supabase: SupabaseClient,
  options: ShadvalReconcileOptions = {}
): Promise<ShadvalReconcileResult> {
  const days = options.days ?? 7
  const limit = options.limit ?? 300
  const concurrency = options.concurrency ?? 5
  const raiseAlerts = options.raiseAlerts ?? true

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const { data: candidates, error } = await supabase
    .from('shadval_settlement')
    .select('id, retailer_id, reference_id, amount, charges, total_debit, actual_wallet_debit, status, status_message, created_at, utr, order_id, account_number, account_holder_name, ifsc_code, mode')
    .eq('status', 'FAILED')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new Error(`reconcile fetch failed: ${error.message}`)

  const result: ShadvalReconcileResult = { checked: 0, doubleMoney: [], refundOk: 0, unverified: 0, totalLoss: 0 }
  const rows = candidates || []
  if (rows.length === 0) return result

  let idx = 0
  const worker = async () => {
    while (idx < rows.length) {
      const tx = rows[idx++]
      if (!tx.reference_id) { result.unverified++; continue }

      let statusResult
      try {
        statusResult = await checkTransactionStatus({ reference_id: tx.reference_id })
      } catch {
        result.unverified++
        continue
      }
      result.checked++

      if (!isGenuineProviderSuccess(statusResult)) {
        // provider agrees failed/pending/reversed/no-record → the refund is fine
        result.refundOk++
        continue
      }

      // Provider says SUCCESS with a UTR but we marked it FAILED. Confirm a
      // refund credit actually exists before flagging it as a loss.
      const refund = await findRefundCredit(supabase, tx.retailer_id, tx.reference_id)
      if (!refund.found) {
        // FAILED but never refunded — not a double-money loss (just a status drift).
        result.refundOk++
        continue
      }

      const lossAmount = refund.amount || computeShadvalRefundAmount(tx)
      const hit: ShadvalDoubleMoneyHit = {
        id: tx.id,
        reference_id: tx.reference_id,
        retailer_id: tx.retailer_id,
        wallet: refund.wallet,
        refunded: lossAmount,
        provider_utr: statusResult.data?.utr,
        provider_txn_status: statusResult.data?.txn_status,
        status_message: tx.status_message,
        created_at: tx.created_at,
      }
      result.doubleMoney.push(hit)
      result.totalLoss += lossAmount

      if (raiseAlerts) {
        await raiseSettlementAlert(supabase, {
          alertType: 'SETTLEMENT2_DOUBLE_MONEY',
          retailerId: refund.wallet === 'retailer' ? tx.retailer_id : undefined,
          partnerId: refund.wallet === 'partner' ? tx.retailer_id : undefined,
          txnId: tx.id,
          amount: lossAmount,
          reason: `DOUBLE-MONEY: payout SUCCEEDED at provider (UTR ${statusResult.data?.utr}) but wallet was refunded ₹${lossAmount.toFixed(2)} — ${tx.reference_id}. Claw back required.`,
          details: {
            reference_id: tx.reference_id,
            order_id: tx.order_id,
            provider_utr: statusResult.data?.utr,
            provider_txn_status: statusResult.data?.txn_status,
            account_number: tx.account_number,
            account_holder_name: tx.account_holder_name,
            mode: tx.mode,
            refunded_amount: lossAmount,
            created_at: tx.created_at,
          },
        }).catch(() => {})
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, rows.length)) }, worker))
  return result
}
