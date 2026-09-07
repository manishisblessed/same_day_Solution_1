/**
 * Pine Labs reconciliation.
 *
 * Pine Labs' summary API reports `txnStatus=SUCCESS` the instant a card is
 * authorized at the terminal. The FINAL disposition (e.g. `FAILED` at batch
 * close, or a VOID/REFUND) can arrive hours to ~14 days later — long after our
 * sync's 48h lookback window has moved on. Left unchecked, those transactions
 * stay frozen as "captured" forever (an impossible 100% success rate).
 *
 * This job re-checks every still-captured Pine Labs transaction in a rolling
 * window against the LIVE Pine Labs API and:
 *   - flips ones Pine Labs now reports as FAILED / VOID / REFUND to the correct
 *     terminal status (stamping reversed_at / reversal_reason so the dashboard's
 *     "Failed Transactions" tab can show captured-time vs failed-time), and
 *     emits a signed partner-reversal webhook when the txn had been served as a
 *     capture;
 *   - positively marks confirmed-settled ones `pinelab_settlement_verified` so
 *     settlement can safely pay them out.
 *
 * It never credits or debits a wallet. Reversal-after-settlement is surfaced
 * loudly (`clawback needed`) for a human/finance follow-up.
 */
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import {
  getPinelabConfig,
  fetchPinelabTransactionsForMerchant,
  mapStatus,
  REVERSAL_DISPLAY_STATUSES,
  type PinelabMerchantConfig,
} from '@/lib/pinelab/sync'

export interface PinelabTxnLite {
  txnStatus?: string
  txnType?: string
  batchStatus?: string
  settlementDate?: string
  transactionId?: string
}

export interface ReconMerchantResult {
  merchant: string
  windowFrom: string
  windowTo: string
  checked: number
  flippedFailed: number
  flippedReversed: number
  verifiedSettled: number
  unsettledOld: number
  clawbackNeeded: number
  webhooksEmitted: number
  errors: string[]
}

export interface ReconRunResult {
  success: boolean
  apply: boolean
  results: ReconMerchantResult[]
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
const toIstString = (d: Date) =>
  new Date(d.getTime() + IST_OFFSET_MS).toISOString().replace('Z', '').split('.')[0]

/** Pine Labs "wall clock IST" datetime string → Date (server TZ agnostic). */
function parseIstDate(raw: string | undefined | null): Date | null {
  if (!raw || String(raw).trim() === '' || String(raw) === 'null') return null
  const normalized = String(raw).trim().replace(' ', 'T')
  const parsed = new Date(`${normalized}+05:30`)
  return isNaN(parsed.getTime()) ? null : parsed
}

/** A txn is settled once Pine Labs closes its batch / stamps a settlement date. */
export function isPinelabSettled(t: PinelabTxnLite | undefined): boolean {
  if (!t) return false
  const bs = String(t.batchStatus || '').toUpperCase()
  return !!parseIstDate(t.settlementDate) || bs === 'CLOSED' || bs === 'SETTLED'
}

/** Terminal (non-success) live disposition, or null if still a clean success. */
export function livesTerminalStatus(
  t: PinelabTxnLite | undefined
): { status: string; displayStatus: string } | null {
  if (!t) return null
  const { status, displayStatus } = mapStatus(t.txnStatus || '', t.txnType || '')
  if (displayStatus === 'SUCCESS') return null
  return { status, displayStatus }
}

interface DbRow {
  id: string
  txn_id: string
  amount: number | null
  tid: string | null
  device_serial: string | null
  mid_code: string | null
  rrn: string | null
  transaction_time: string
  display_status: string
  wallet_credited: boolean | null
  partner_wallet_credited: boolean | null
}

async function reconcileMerchant(
  slug: string,
  config: PinelabMerchantConfig,
  fromIso: string,
  toIso: string,
  cutoffDays: number,
  apply: boolean
): Promise<ReconMerchantResult> {
  const supabase = getSupabaseAdmin()
  const res: ReconMerchantResult = {
    merchant: slug,
    windowFrom: fromIso,
    windowTo: toIso,
    checked: 0,
    flippedFailed: 0,
    flippedReversed: 0,
    verifiedSettled: 0,
    unsettledOld: 0,
    clawbackNeeded: 0,
    webhooksEmitted: 0,
    errors: [],
  }

  // 1) Live snapshot from Pine Labs for the window.
  let live: Map<string, PinelabTxnLite>
  try {
    const txns = await fetchPinelabTransactionsForMerchant(config, fromIso, toIso)
    live = new Map(txns.map((t: any) => [String(t.transactionId), t as PinelabTxnLite]))
  } catch (err: any) {
    res.errors.push(`fetch: ${err?.message || err}`)
    return res
  }

  // 2) Our still-captured rows in the same window.
  const rows: DbRow[] = []
  let offset = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase
      .from('razorpay_pos_transactions')
      .select('id, txn_id, amount, tid, device_serial, mid_code, rrn, transaction_time, display_status, wallet_credited, partner_wallet_credited')
      .eq('display_status', 'SUCCESS')
      .eq('merchant_slug', slug)
      .gte('transaction_time', fromIso.includes('T') ? `${fromIso}+05:30` : fromIso)
      .lte('transaction_time', toIso.includes('T') ? `${toIso}+05:30` : toIso)
      .range(offset, offset + PAGE - 1)
    if (error) { res.errors.push(`db: ${error.message}`); break }
    if (!data || data.length === 0) break
    rows.push(...(data as DbRow[]))
    if (data.length < PAGE) break
    offset += PAGE
  }

  const now = Date.now()
  for (const row of rows) {
    res.checked++
    const liveTxn = live.get(row.txn_id.replace(/^PL_/, ''))
    await processRow(supabase, slug, row, liveTxn, now, cutoffDays, apply, res)
  }

  return res
}

/**
 * Decide + apply the outcome for one captured DB row against its live Pine Labs
 * status. Shared by the rolling-window pass and the straggler tail-sweep.
 * Mutates `res` counters. Never moves money.
 */
async function processRow(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  slug: string,
  row: DbRow,
  liveTxn: PinelabTxnLite | undefined,
  now: number,
  cutoffDays: number,
  apply: boolean,
  res: ReconMerchantResult
): Promise<void> {
  const ageDays = (now - new Date(row.transaction_time).getTime()) / 86400000
  const wasSettledToWallet = !!(row.wallet_credited || row.partner_wallet_credited)
  const terminal = livesTerminalStatus(liveTxn)

  // ── Case 1: Pine Labs now reports a terminal FAILED / VOID / REFUND ──
  if (terminal) {
    const isReversal = REVERSAL_DISPLAY_STATUSES.includes(terminal.displayStatus)
    const failTime = parseIstDate(liveTxn?.settlementDate) || new Date()
    if (apply) {
      const { error } = await supabase
        .from('razorpay_pos_transactions')
        .update({
          status: terminal.status,
          display_status: terminal.displayStatus,
          settlement_status: 'FAILED',
          reversed_at: failTime.toISOString(),
          reversal_reason: `pinelab-recon:${liveTxn?.txnStatus || liveTxn?.txnType || terminal.displayStatus}`,
          pinelab_settlement_verified: false,
          last_reconciled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      if (error) { res.errors.push(`flip ${row.txn_id}: ${error.message}`); return }
    }
    if (isReversal) res.flippedReversed++
    else res.flippedFailed++

    if (wasSettledToWallet) {
      res.clawbackNeeded++
      console.warn(`[PinelabRecon/${slug}] REVERSAL AFTER SETTLEMENT — clawback needed txn=${row.txn_id} amount=${row.amount}`)
    }

    // Tell the owning partner to remove/reverse it in their books.
    if (apply && row.tid) {
      try {
        const { deliverPartnerReversal } = await import('@/lib/partner-webhook/deliver')
        await deliverPartnerReversal({
          supabase,
          tid: row.tid,
          deviceSerial: row.device_serial,
          txnId: row.txn_id,
          payload: {
            event: 'pos.transaction.reversed',
            action: 'remove',
            txn_id: row.txn_id,
            rrn: row.rrn,
            terminal_id: row.tid,
            tid: row.tid,
            device_serial: row.device_serial,
            mid: row.mid_code,
            amount: row.amount || 0,
            previous_status: 'CAPTURED',
            status: terminal.displayStatus,
            reversed_at: failTime.toISOString(),
            reason: `pinelab-recon:${liveTxn?.txnStatus || terminal.displayStatus}`,
            was_settled: wasSettledToWallet,
            _brand: 'PINELAB',
          },
          logPrefix: `Recon Reversal/${slug}`,
        })
        res.webhooksEmitted++
      } catch (err: any) {
        res.errors.push(`notify ${row.txn_id}: ${err?.message || err}`)
      }
    }
    return
  }

  // ── Case 2: still SUCCESS at Pine Labs and now settled → verify for payout ──
  if (isPinelabSettled(liveTxn)) {
    const settledAt = parseIstDate(liveTxn?.settlementDate)
    if (apply) {
      const { error } = await supabase
        .from('razorpay_pos_transactions')
        .update({
          pinelab_settlement_verified: true,
          settlement_verified_at: new Date().toISOString(),
          settlement_status: 'SETTLED',
          settled_on: settledAt ? settledAt.toISOString() : undefined,
          last_reconciled_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      if (error) { res.errors.push(`verify ${row.txn_id}: ${error.message}`); return }
    }
    res.verifiedSettled++
    return
  }

  // ── Case 3: still SUCCESS but unsettled past the cutoff → suspicious ──
  // We do NOT auto-fail (Pine Labs still reports success); we only flag +
  // timestamp the check so the tail-sweep keeps watching it until it resolves.
  if (ageDays > cutoffDays) {
    res.unsettledOld++
    if (apply) {
      await supabase
        .from('razorpay_pos_transactions')
        .update({ last_reconciled_at: new Date().toISOString() })
        .eq('id', row.id)
    }
    return
  }

  // ── Case 4: recent + unsettled → normal, just stamp the check ──
  if (apply) {
    await supabase
      .from('razorpay_pos_transactions')
      .update({ last_reconciled_at: new Date().toISOString() })
      .eq('id', row.id)
  }
}

/**
 * Straggler tail-sweep: re-checks captured Pine Labs rows that are OLDER than
 * the rolling window but still unresolved (not reversed, not yet settlement-
 * verified). Without this, a transaction that never settles (like the 4 old
 * unsettled ones) would fall out of the rolling window and stop being watched.
 *
 * Cost is bounded: only rows in the [lookback, maxTail] age band, capped per
 * run, prioritised by least-recently-checked (last_reconciled_at). We fetch
 * Pine Labs only for the DISTINCT days those stragglers fall on (cheap in the
 * steady state of a handful of stragglers). Settled ones get verified and leave
 * the watchlist; genuine failures get flipped; the rest keep being watched.
 */
async function reconcileStragglers(
  slug: string,
  config: PinelabMerchantConfig,
  lookbackDays: number,
  maxTailDays: number,
  cutoffDays: number,
  cap: number,
  apply: boolean
): Promise<ReconMerchantResult> {
  const supabase = getSupabaseAdmin()
  const res: ReconMerchantResult = {
    merchant: `${slug}:tail`,
    windowFrom: `${maxTailDays}d`,
    windowTo: `${lookbackDays}d`,
    checked: 0, flippedFailed: 0, flippedReversed: 0, verifiedSettled: 0,
    unsettledOld: 0, clawbackNeeded: 0, webhooksEmitted: 0, errors: [],
  }

  const nowMs = Date.now()
  const olderThan = new Date(nowMs - lookbackDays * 86400000).toISOString()
  const youngerThan = new Date(nowMs - maxTailDays * 86400000).toISOString()

  const { data, error } = await supabase
    .from('razorpay_pos_transactions')
    .select('id, txn_id, amount, tid, device_serial, mid_code, rrn, transaction_time, display_status, wallet_credited, partner_wallet_credited')
    .eq('merchant_slug', slug)
    .eq('display_status', 'SUCCESS')
    .is('reversed_at', null)
    .eq('pinelab_settlement_verified', false)
    .like('txn_id', 'PL\\_%')
    .lt('transaction_time', olderThan)
    .gte('transaction_time', youngerThan)
    .order('last_reconciled_at', { ascending: true, nullsFirst: true })
    .limit(cap)

  if (error) { res.errors.push(`db: ${error.message}`); return res }
  const rows = (data || []) as DbRow[]
  if (rows.length === 0) return res

  // Distinct IST days these stragglers fall on → fetch only those windows.
  const days = new Set<string>()
  for (const r of rows) {
    days.add(toIstString(new Date(r.transaction_time)).slice(0, 10))
  }

  const live = new Map<string, PinelabTxnLite>()
  for (const day of days) {
    try {
      const txns = await fetchPinelabTransactionsForMerchant(config, `${day}T00:00:00`, `${day}T23:59:59`)
      for (const t of txns as any[]) {
        if (t.transactionId && !live.has(String(t.transactionId))) live.set(String(t.transactionId), t as PinelabTxnLite)
      }
    } catch (err: any) {
      res.errors.push(`fetch ${day}: ${err?.message || err}`)
    }
  }

  for (const row of rows) {
    res.checked++
    const liveTxn = live.get(row.txn_id.replace(/^PL_/, ''))
    await processRow(supabase, slug, row, liveTxn, nowMs, cutoffDays, apply, res)
  }

  return res
}

export async function runPinelabReconcile(opts?: {
  merchants?: string[]
  fromDate?: string
  toDate?: string
  cutoffDays?: number
  /** When false, computes what WOULD change without writing (dry run). */
  apply?: boolean
}): Promise<ReconRunResult> {
  const config = getPinelabConfig()
  if (Object.keys(config).length === 0) {
    throw new Error('PINELAB_MERCHANTS_CONFIG not set or empty')
  }

  const apply = opts?.apply !== false // default: apply
  const cutoffDays = opts?.cutoffDays ?? parseFloat(process.env.PINELAB_RECON_UNSETTLED_CUTOFF_DAYS || '2')

  // Rolling window sized to the worst-case flip lag (observed ~14 days).
  const lookbackDays = parseInt(process.env.PINELAB_RECON_LOOKBACK_DAYS || '21', 10)
  const now = new Date()
  const fromIso = opts?.fromDate || toIstString(new Date(now.getTime() - lookbackDays * 86400000))
  const toIso = opts?.toDate || toIstString(new Date(now.getTime() + 6 * 60 * 60 * 1000))

  // Tail-sweep bounds: keep watching unresolved stragglers up to maxTailDays old.
  const maxTailDays = parseInt(process.env.PINELAB_RECON_MAX_TAIL_DAYS || '120', 10)
  const tailCap = parseInt(process.env.PINELAB_RECON_TAIL_CAP || '2000', 10)

  const results: ReconMerchantResult[] = []
  for (const [slug, merchantConfig] of Object.entries(config)) {
    if (opts?.merchants && !opts.merchants.includes(slug)) continue
    try {
      results.push(await reconcileMerchant(slug, merchantConfig, fromIso, toIso, cutoffDays, apply))
    } catch (err: any) {
      results.push({
        merchant: slug, windowFrom: fromIso, windowTo: toIso,
        checked: 0, flippedFailed: 0, flippedReversed: 0, verifiedSettled: 0,
        unsettledOld: 0, clawbackNeeded: 0, webhooksEmitted: 0,
        errors: [err?.message || String(err)],
      })
    }

    // Straggler tail-sweep (skip when caller pinned an explicit window).
    if (!opts?.fromDate && maxTailDays > lookbackDays) {
      try {
        results.push(await reconcileStragglers(slug, merchantConfig, lookbackDays, maxTailDays, cutoffDays, tailCap, apply))
      } catch (err: any) {
        results.push({
          merchant: `${slug}:tail`, windowFrom: `${maxTailDays}d`, windowTo: `${lookbackDays}d`,
          checked: 0, flippedFailed: 0, flippedReversed: 0, verifiedSettled: 0,
          unsettledOld: 0, clawbackNeeded: 0, webhooksEmitted: 0,
          errors: [err?.message || String(err)],
        })
      }
    }
  }

  return { success: true, apply, results }
}
