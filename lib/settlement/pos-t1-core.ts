/**
 * POS T+1 Settlement Core
 *
 * Single source of truth for the retailer POS T+1 auto-settlement, shared by
 * the cron (`lib/cron/t1-settlement-cron.ts`) and the API endpoint
 * (`app/api/pos/auto-settle-t1/route.ts`) so the two can never drift.
 *
 * Behaviour:
 *  - Settles each eligible transaction as its OWN ledger row (not a combined
 *    batch), and pays the distributor a per-transaction commission equal to
 *    (retailer_mdr - distributor_mdr) * gross.
 *  - Retailer credit + distributor commission + txn update are written
 *    atomically by the `settle_pos_txn_t1` RPC — a crash can never leave one
 *    without the other, and the unique (reference_id, retailer_id) index makes
 *    a double credit impossible.
 *  - Honours each retailer's `t1_settlement_start_at`: transactions captured
 *    before settlement was switched on are permanently excluded (marked
 *    `t1_excluded_pre_start`) so they never settle and never clog the queue.
 *  - Drains the full backlog by looping over batches until nothing eligible
 *    remains, with hard guards against infinite loops.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { calculateMDR } from '@/lib/mdr-scheme/settlement.service'
import { raiseSettlementAlert, resolveSettlementAlerts } from '@/lib/settlement-alerts'
import type { SettlementType } from '@/types/mdr-scheme.types'

const BATCH_SIZE = 500
const MAX_ITERATIONS = 200 // 200 * 500 = 100k txns per run — a safety backstop.

/** TDS withheld on every distributor commission credit (2%). */
export const DISTRIBUTOR_COMMISSION_TDS_RATE = 0.02

interface RetailerMeta {
  distributorId: string | null
  masterDistributorId: string | null
  name: string
  startAt: string | null
}

export interface PosT1SettlementResult {
  processed: number
  failed: number
  commissionCredited: number
  mdCommissionCredited: number
  excludedPreStart: number
  retailersProcessed: number
  results: Array<{
    txn_id: string
    retailer_id: string
    net: number
    commission: number
    distributor_id: string | null
    md_commission: number
    master_distributor_id: string | null
    wallet_credit_id: string | null
  }>
}

export interface PosT1SettlementOptions {
  /** Only settle transactions captured strictly before this instant. Defaults to today 00:00 local. */
  beforeDate?: Date
  /** Pre-computed paused retailer ids; fetched if omitted. */
  pausedRetailers?: Set<string>
}

async function getPausedRetailerIds(supabase: SupabaseClient): Promise<Set<string>> {
  const { data } = await supabase
    .from('retailers')
    .select('partner_id')
    .eq('t1_settlement_paused', true)
  return new Set((data || []).map((r: any) => r.partner_id))
}

/**
 * Run the retailer POS T+1 settlement to completion for all eligible
 * transactions. Safe to call concurrently — the RPC serialises per-txn work
 * and the DB unique index prevents any double credit.
 */
export async function runPosT1Settlement(
  options: PosT1SettlementOptions = {}
): Promise<PosT1SettlementResult> {
  const supabase = getSupabaseAdmin()

  const cutoffDate = options.beforeDate ?? new Date(new Date().setHours(0, 0, 0, 0))
  const pausedRetailers = options.pausedRetailers ?? (await getPausedRetailerIds(supabase))

  // Self-heal: stamp retailer_id on captured transactions whose device is
  // registered in pos_machines (by tid/serial) but where the webhook never
  // wrote retailer_id (it only reads pos_device_mapping). Without this, such
  // transactions are invisible to the eligibility query below and never settle.
  try {
    const { data: backfilled, error: backfillError } = await supabase.rpc('backfill_pos_retailer_ids')
    if (backfillError) {
      console.error('[PosT1] backfill_pos_retailer_ids failed:', backfillError.message)
    } else if (backfilled && Number(backfilled) > 0) {
      console.log(`[PosT1] Backfilled retailer_id on ${backfilled} transaction(s) from pos_machines.`)
    }
  } catch (err: any) {
    console.error('[PosT1] backfill_pos_retailer_ids threw:', err?.message || err)
  }

  const result: PosT1SettlementResult = {
    processed: 0,
    failed: 0,
    commissionCredited: 0,
    mdCommissionCredited: 0,
    excludedPreStart: 0,
    retailersProcessed: 0,
    results: [],
  }

  const retailerCache = new Map<string, RetailerMeta>()
  // tid/serial -> device's current-holder assignment time. Used to permanently
  // exclude transactions that occurred BEFORE the current holder took the
  // device (defense-in-depth for rows whose retailer_id was stamped by an
  // older backfill that lacked the ownership-time gate).
  const machineAssignedAtCache = new Map<string, string | null>()
  const resolveDeviceAssignedAt = async (tid: string | null, serial: string | null): Promise<string | null> => {
    const key = tid ? `t:${tid}` : serial ? `s:${serial}` : ''
    if (!key) return null
    if (machineAssignedAtCache.has(key)) return machineAssignedAtCache.get(key)!
    let q = supabase.from('pos_machines').select('last_assigned_at').limit(1)
    q = tid ? q.eq('tid', tid) : q.eq('serial_number', serial as string)
    const { data } = await q.maybeSingle()
    const val = (data?.last_assigned_at as string) || null
    machineAssignedAtCache.set(key, val)
    return val
  }
  const retailersProcessed = new Set<string>()
  // Transactions we have permanently given up on / skipped this run, so the
  // drain loop never spins on the same rows.
  const skippedThisRun = new Set<string>()

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const { data: batch, error: fetchError } = await supabase
      .from('razorpay_pos_transactions')
      .select('*')
      .or('display_status.ilike.SUCCESS,display_status.ilike.CAPTURED')
      .eq('wallet_credited', false)
      .eq('t1_excluded_pre_start', false)
      .is('settlement_mode', null)
      .not('retailer_id', 'is', null)
      .lt('transaction_time', cutoffDate.toISOString())
      .order('transaction_time', { ascending: true })
      .limit(BATCH_SIZE)

    if (fetchError) {
      console.error('[PosT1] Error fetching unsettled transactions:', fetchError)
      break
    }
    if (!batch || batch.length === 0) break

    // Drop rows we already decided to skip this run (paused / MDR-fail).
    const fresh = batch.filter((t: any) => !skippedThisRun.has(t.id))
    if (fresh.length === 0) break

    let creditedThisIteration = 0

    for (const txn of fresh) {
      const retailerId = txn.retailer_id as string

      // Paused: leave in queue (will resume later), just skip this run.
      if (pausedRetailers.has(retailerId)) {
        skippedThisRun.add(txn.id)
        continue
      }

      // Resolve + cache retailer hierarchy / settlement start.
      let meta = retailerCache.get(retailerId)
      if (!meta) {
        const { data: rd } = await supabase
          .from('retailers')
          .select('distributor_id, master_distributor_id, name, business_name, t1_settlement_start_at')
          .eq('partner_id', retailerId)
          .maybeSingle()
        meta = {
          distributorId: rd?.distributor_id || null,
          masterDistributorId: rd?.master_distributor_id || null,
          name: rd?.business_name || rd?.name || retailerId,
          startAt: rd?.t1_settlement_start_at || null,
        }
        retailerCache.set(retailerId, meta)
      }

      // Ownership-time gate: never settle a transaction that happened BEFORE the
      // current holder was assigned this device (a reassigned machine must not
      // pay the new retailer for the previous merchant's history). Permanently
      // exclude so the drain loop never revisits it.
      const deviceAssignedAt = await resolveDeviceAssignedAt(txn.tid || null, txn.device_serial || null)
      if (deviceAssignedAt && new Date(txn.transaction_time) < new Date(deviceAssignedAt)) {
        await supabase
          .from('razorpay_pos_transactions')
          .update({ t1_excluded_pre_start: true })
          .eq('id', txn.id)
        skippedThisRun.add(txn.id)
        result.excludedPreStart++
        continue
      }

      // Date gate: permanently exclude transactions that predate enablement so
      // enabling T+1 never pays out a historical backlog and the queue stays clean.
      if (meta.startAt && new Date(txn.transaction_time) < new Date(meta.startAt)) {
        await supabase
          .from('razorpay_pos_transactions')
          .update({ t1_excluded_pre_start: true })
          .eq('id', txn.id)
        skippedThisRun.add(txn.id)
        result.excludedPreStart++
        continue
      }

      const grossAmount = parseFloat(txn.gross_amount || txn.amount || '0')
      if (!(grossAmount > 0)) {
        skippedThisRun.add(txn.id)
        result.failed++
        continue
      }

      const paymentMode = (txn.payment_mode || 'CARD').toUpperCase()
      const mdrResult = await calculateMDR({
        amount: grossAmount,
        settlement_type: 'T1' as SettlementType,
        mode: paymentMode.includes('UPI') ? 'UPI' : 'CARD',
        card_type: txn.card_type?.toUpperCase() || null,
        brand_type: txn.card_brand || null,
        card_classification: txn.card_classification || null,
        merchant_slug: txn.merchant_slug || null,
        retailer_id: retailerId,
        distributor_id: meta.distributorId,
      })

      if (!mdrResult.success || !mdrResult.result) {
        // Genuinely unsettleable until config is fixed — alert and retry next run.
        skippedThisRun.add(txn.id)
        result.failed++
        console.warn(`[PosT1] MDR calc failed for txn ${txn.txn_id}: ${mdrResult.error}`)
        await raiseSettlementAlert(supabase, {
          retailerId,
          txnId: txn.txn_id,
          amount: grossAmount,
          reason: mdrResult.error || 'MDR calculation failed',
          details: {
            payment_mode: paymentMode,
            card_type: txn.card_type || null,
            card_brand: txn.card_brand || null,
            card_classification: txn.card_classification || null,
            transaction_time: txn.transaction_time,
          },
        })
        continue
      }

      const r = mdrResult.result
      // Explicit per-tier commissions: DT earns amount*distributor_mdr%, MD earns
      // amount*md_mdr% — each paid off its own rate, net of 2% TDS.
      const commission = meta.distributorId && r.distributor_commission > 0 ? r.distributor_commission : 0
      const commissionTds = commission > 0
        ? Math.round(commission * DISTRIBUTOR_COMMISSION_TDS_RATE * 100) / 100
        : 0

      const mdCommission = meta.masterDistributorId && r.md_commission > 0 ? r.md_commission : 0
      const mdTds = mdCommission > 0
        ? Math.round(mdCommission * DISTRIBUTOR_COMMISSION_TDS_RATE * 100) / 100
        : 0

      const { data: ledgerId, error: rpcError } = await supabase.rpc('settle_pos_txn_t1', {
        p_txn_id: txn.id,
        p_retailer_id: retailerId,
        p_gross: grossAmount,
        p_retailer_mdr: r.retailer_mdr,
        p_retailer_fee: r.retailer_fee,
        p_retailer_net: r.retailer_settlement_amount,
        p_scheme_id: r.scheme_id || null,
        p_scheme_type: r.scheme_type || null,
        p_distributor_id: commission > 0 ? meta.distributorId : null,
        // Pass the EARNED rate (not the raw distributor_mdr, which is a cost in the
        // cascade model) so the ledger "Rate:" label reflects what was actually paid.
        p_distributor_mdr: r.distributor_earn_pct,
        p_distributor_commission: commission,
        p_distributor_tds: commissionTds,
        p_tid: txn.tid || txn.device_serial || null,
        p_retailer_name: meta.name,
        p_retailer_ref: `AUTO-T1-${txn.txn_id}`,
        p_commission_ref: `AUTO-T1-COMM-${txn.txn_id}`,
        p_master_distributor_id: mdCommission > 0 ? meta.masterDistributorId : null,
        p_md_mdr: r.md_earn_pct,
        p_md_commission: mdCommission,
        p_md_commission_ref: `AUTO-T1-MDCOMM-${txn.txn_id}`,
        p_md_tds: mdTds,
      })

      if (rpcError) {
        // Atomic settle failed → nothing was written. Skip this run, retry next.
        skippedThisRun.add(txn.id)
        result.failed++
        console.error(`[PosT1] settle_pos_txn_t1 failed for ${txn.txn_id}:`, rpcError.message)
        await raiseSettlementAlert(supabase, {
          retailerId,
          txnId: txn.txn_id,
          amount: grossAmount,
          reason: `Atomic settlement failed: ${rpcError.message}`,
          details: { transaction_time: txn.transaction_time },
        })
        continue
      }

      creditedThisIteration++
      result.processed++
      if (commission > 0) result.commissionCredited++
      if (mdCommission > 0) result.mdCommissionCredited++
      if (!retailersProcessed.has(retailerId)) {
        retailersProcessed.add(retailerId)
        result.retailersProcessed++
      }
      result.results.push({
        txn_id: txn.txn_id,
        retailer_id: retailerId,
        net: r.retailer_settlement_amount,
        commission,
        distributor_id: commission > 0 ? meta.distributorId : null,
        md_commission: mdCommission,
        master_distributor_id: mdCommission > 0 ? meta.masterDistributorId : null,
        wallet_credit_id: (ledgerId as string) || null,
      })
      await resolveSettlementAlerts(supabase, [txn.txn_id])
    }

    // No progress possible (everything left is skipped) → stop.
    if (creditedThisIteration === 0) break
  }

  return result
}
