import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import {
  getPinelabConfig,
  fetchPinelabTransactionsForMerchant,
  mapToDbRecord,
  REVERSAL_DISPLAY_STATUSES,
} from '@/lib/pinelab/sync'
import { deliverPartnerReversal } from '@/lib/partner-webhook/deliver'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Backfill for Pine Labs transactions that were HARD-DELETED by the old sync
 * (any non-SUCCESS status was purged). Re-pulls a Pine Labs window and, for any
 * transaction that Pine Labs now reports as voided/reversed/refunded, either:
 *   - reinstates the row as VOIDED/REFUNDED (if it was purged), or
 *   - marks the existing SUCCESS row as reversed,
 * then (optionally) emits a signed `pos.transaction.reversed` webhook to the
 * owning partner so their books match ours. Returns a CSV report.
 *
 * Auth: x-cron-secret header (same as the Pine Labs sync endpoint).
 *
 * Body:
 *   { merchant: string, fromDate: "YYYY-MM-DD", toDate: "YYYY-MM-DD",
 *     dryRun?: boolean (default true), emitWebhooks?: boolean (default false),
 *     txnIds?: string[]  // optional: restrict to specific raw Pine Labs ids }
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const headerSecret = request.headers.get('x-cron-secret')
  if (cronSecret && headerSecret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: any = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { merchant, fromDate, toDate } = body
  const dryRun = body.dryRun !== false // default true (safe)
  const emitWebhooks = body.emitWebhooks === true // default false
  const restrictIds: string[] | null = Array.isArray(body.txnIds) && body.txnIds.length ? body.txnIds : null

  if (!merchant || !fromDate || !toDate) {
    return NextResponse.json({ error: 'merchant, fromDate, toDate are required' }, { status: 400 })
  }

  const configs = getPinelabConfig()
  const config = configs[merchant]
  if (!config) {
    return NextResponse.json(
      { error: `Unknown merchant '${merchant}'. Configured: ${Object.keys(configs).join(', ') || '(none)'}` },
      { status: 400 }
    )
  }

  const supabase = getSupabaseAdmin()

  let transactions
  try {
    transactions = await fetchPinelabTransactionsForMerchant(config, fromDate, toDate)
  } catch (err: any) {
    return NextResponse.json({ error: `Pinelab fetch failed: ${err.message}` }, { status: 502 })
  }

  const report: Array<Record<string, any>> = []
  let reinstated = 0
  let markedReversed = 0
  let alreadyReversed = 0
  let notReversal = 0
  let emitted = 0
  let settledConflicts = 0

  for (const txn of transactions) {
    if (!txn.transactionId) continue
    if (restrictIds && !restrictIds.includes(txn.transactionId)) continue

    const dbRecord = mapToDbRecord(txn, merchant, config.merchantName)
    if (!REVERSAL_DISPLAY_STATUSES.includes(dbRecord.display_status)) {
      notReversal++
      continue
    }

    const prefixedId = `PL_${txn.transactionId}`
    const { data: existing } = await supabase
      .from('razorpay_pos_transactions')
      .select('id, display_status, partner_wallet_credited, wallet_credited, tid, device_serial, amount')
      .eq('txn_id', prefixedId)
      .maybeSingle()

    const wasSuccess = existing?.display_status === 'SUCCESS'
    const isAlreadyReversed = existing ? REVERSAL_DISPLAY_STATUSES.includes(existing.display_status) : false
    const wasSettled = !!(existing?.partner_wallet_credited || existing?.wallet_credited)
    if (wasSettled) settledConflicts++

    // A purged row was historically served as a capture; a SUCCESS row was too.
    // Both need the partner told. An already-reversed row needs nothing.
    let action: 'reinstate' | 'mark-reversed' | 'already-reversed'
    if (!existing) action = 'reinstate'
    else if (isAlreadyReversed) action = 'already-reversed'
    else action = 'mark-reversed'

    const willEmit = emitWebhooks && (action === 'reinstate' || action === 'mark-reversed')

    if (!dryRun) {
      if (action === 'reinstate') {
        const { error } = await supabase.from('razorpay_pos_transactions').insert(dbRecord)
        if (!error) reinstated++
        else report.push({ txn_id: prefixedId, action: 'error', error: error.message })
      } else if (action === 'mark-reversed') {
        const { partner_id: _omit, ...upd } = dbRecord
        const { error } = await supabase
          .from('razorpay_pos_transactions')
          .update({ ...upd, updated_at: new Date().toISOString() })
          .eq('txn_id', prefixedId)
        if (!error) markedReversed++
        else report.push({ txn_id: prefixedId, action: 'error', error: error.message })
      } else {
        alreadyReversed++
      }

      if (willEmit) {
        await deliverPartnerReversal({
          supabase,
          tid: dbRecord.tid,
          deviceSerial: dbRecord.device_serial,
          txnId: prefixedId,
          payload: {
            event: 'pos.transaction.reversed',
            action: 'remove',
            txn_id: prefixedId,
            rrn: dbRecord.rrn,
            terminal_id: dbRecord.tid,
            tid: dbRecord.tid,
            device_serial: dbRecord.device_serial,
            mid: dbRecord.mid_code,
            amount: dbRecord.amount,
            previous_status: 'CAPTURED',
            status: dbRecord.display_status === 'REFUNDED' ? 'REFUNDED' : 'VOIDED',
            reversed_at: dbRecord.reversed_at,
            reason: dbRecord.reversal_reason,
            was_settled: wasSettled,
            backfill: true,
            _brand: 'PINELAB',
          },
          logPrefix: `Backfill Reversal/${merchant}`,
        })
        emitted++
      }
    } else {
      // dryRun accounting
      if (action === 'reinstate') reinstated++
      else if (action === 'mark-reversed') markedReversed++
      else alreadyReversed++
    }

    report.push({
      txn_id: prefixedId,
      tid: dbRecord.tid,
      rrn: dbRecord.rrn,
      amount: dbRecord.amount,
      new_status: dbRecord.display_status,
      previous_db_status: existing?.display_status ?? '(absent)',
      action,
      was_settled: wasSettled,
      would_emit: willEmit,
    })
  }

  // CSV report (easy to hand to a partner / nextgen team)
  const header = ['txn_id', 'tid', 'rrn', 'amount', 'new_status', 'previous_db_status', 'action', 'was_settled', 'would_emit']
  const csv = [
    header.join(','),
    ...report
      .filter(r => r.action !== 'error')
      .map(r => header.map(h => JSON.stringify(r[h] ?? '')).join(',')),
  ].join('\n')

  return NextResponse.json({
    merchant,
    fromDate,
    toDate,
    dryRun,
    emitWebhooks,
    fetched: transactions.length,
    summary: {
      reversals_found: reinstated + markedReversed + alreadyReversed,
      reinstated,
      marked_reversed: markedReversed,
      already_reversed: alreadyReversed,
      non_reversal_skipped: notReversal,
      webhooks_emitted: emitted,
      settled_conflicts_flagged: settledConflicts,
    },
    csv,
    report,
  })
}
