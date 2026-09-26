/**
 * Partner rolling reserve (Phase 3).
 *
 * A configurable % of each POS settlement to a partner is held back into the
 * `partner_reserve_ledger` for `reserve_hold_days`. Matured holds are released
 * back to the partner wallet; reversal losses are covered automatically from
 * the held balance instead of a manual clawback. This is the financial backstop
 * for the residual tail of Pine Labs successes that auto-reverse AFTER a partner
 * has already been settled (and, for instant-settling partners, already paid
 * their own end-user).
 *
 * NO-OP by default: a partner's `reserve_percent` is 0 until an admin sets it,
 * so none of this changes settlement amounts until explicitly enabled.
 *
 * Ledger model (append-only; balance = SUM(balance_delta)):
 *   HOLD    +amount   held back at settlement time (not yet in partner wallet)
 *   RELEASE -amount   matured hold returned to the partner wallet
 *   LOSS    -amount   reversal loss drawn down from the reserve
 *
 * All writes are idempotent via the unique `reference_id`. Never throws.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export interface PartnerReserveConfig {
  percent: number
  holdDays: number
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Read a partner's reserve config. Returns zeros (disabled) on any miss. */
export async function getPartnerReserveConfig(
  supabase: SupabaseClient,
  partnerId: string
): Promise<PartnerReserveConfig> {
  try {
    const { data } = await supabase
      .from('partners')
      .select('reserve_percent, reserve_hold_days')
      .eq('id', partnerId)
      .maybeSingle()
    const percent = Number((data as any)?.reserve_percent ?? 0) || 0
    const holdDays = Number((data as any)?.reserve_hold_days ?? 7) || 7
    return { percent: percent > 0 ? percent : 0, holdDays: holdDays > 0 ? holdDays : 7 }
  } catch {
    return { percent: 0, holdDays: 7 }
  }
}

/** Reserve amount to hold back from a net settlement, given a percent. */
export function computeReserveHold(net: number, percent: number): number {
  if (!(net > 0) || !(percent > 0)) return 0
  return round2((net * percent) / 100)
}

/** Live reserve balance for a partner (SUM of signed deltas). */
export async function getReserveBalance(
  supabase: SupabaseClient,
  partnerId: string
): Promise<number> {
  try {
    const { data } = await supabase
      .from('partner_reserve_ledger')
      .select('balance_delta')
      .eq('partner_id', partnerId)
    if (!data) return 0
    return round2((data as any[]).reduce((s, r) => s + Number(r.balance_delta || 0), 0))
  } catch {
    return 0
  }
}

/**
 * Record a HOLD for a settlement. Call AFTER the (reduced) wallet credit
 * succeeds. Idempotent on `${referencePrefix}` derived from the settlement ref.
 * Returns the amount actually held (0 if disabled / duplicate / error).
 */
export async function recordReserveHold(opts: {
  supabase?: SupabaseClient
  partnerId: string
  txnId: string
  settlementReference: string
  holdAmount: number
  holdDays: number
  description?: string
}): Promise<number> {
  const { partnerId, txnId, settlementReference, holdAmount, holdDays } = opts
  if (!(holdAmount > 0)) return 0
  const supabase = opts.supabase ?? getSupabaseAdmin()
  const reference = `RESV-HOLD-${settlementReference}`
  const releaseAt = new Date(Date.now() + holdDays * 86400000).toISOString()
  try {
    const { error } = await supabase.from('partner_reserve_ledger').insert({
      partner_id: partnerId,
      txn_id: txnId,
      entry_type: 'HOLD',
      amount: holdAmount,
      balance_delta: holdAmount,
      reference_id: reference,
      description: opts.description || `Reserve hold for ${txnId}`,
      hold_release_at: releaseAt,
      consumed: false,
    })
    if (error) {
      if (/duplicate/i.test(error.message)) return 0
      console.error(`[PartnerReserve] HOLD insert failed txn=${txnId}: ${error.message}`)
      return 0
    }
    return holdAmount
  } catch (err: any) {
    console.error(`[PartnerReserve] HOLD threw txn=${txnId}: ${err?.message || err}`)
    return 0
  }
}

/**
 * Cover a reversal loss from the partner's reserve. Draws down FIFO across
 * unconsumed HOLD rows (splitting a partially-consumed hold so its remainder can
 * still be released later), and posts a LOSS entry. Never draws more than the
 * available balance. Returns how much was covered and any uncovered shortfall
 * (which needs a manual/finance follow-up).
 */
export async function coverReversalFromReserve(opts: {
  supabase?: SupabaseClient
  partnerId: string
  txnId: string
  lossAmount: number
  reason?: string
}): Promise<{ covered: number; shortfall: number }> {
  const { partnerId, txnId, lossAmount } = opts
  if (!(lossAmount > 0)) return { covered: 0, shortfall: 0 }
  const supabase = opts.supabase ?? getSupabaseAdmin()

  try {
    const balance = await getReserveBalance(supabase, partnerId)
    const covered = round2(Math.min(lossAmount, Math.max(0, balance)))
    const shortfall = round2(lossAmount - covered)

    if (covered > 0) {
      const { error: lossErr } = await supabase.from('partner_reserve_ledger').insert({
        partner_id: partnerId,
        txn_id: txnId,
        entry_type: 'LOSS',
        amount: covered,
        balance_delta: -covered,
        reference_id: `RESV-LOSS-${txnId}`,
        description: opts.reason || `Reversal loss covered from reserve for ${txnId}`,
        hold_release_at: null,
        consumed: true,
      })
      if (lossErr && !/duplicate/i.test(lossErr.message)) {
        console.error(`[PartnerReserve] LOSS insert failed txn=${txnId}: ${lossErr.message}`)
        return { covered: 0, shortfall: lossAmount }
      }
      if (lossErr) {
        // Already posted for this txn — treat as fully covered idempotently.
        return { covered, shortfall }
      }

      // Draw down HOLD rows FIFO so matured releases don't double-return money.
      await consumeHoldsFifo(supabase, partnerId, covered)
    }

    if (shortfall > 0) {
      console.warn(`[PartnerReserve] RESERVE SHORTFALL — manual clawback needed partner=${partnerId} txn=${txnId} shortfall=₹${shortfall} (covered=₹${covered})`)
    } else {
      console.log(`[PartnerReserve] Covered reversal from reserve partner=${partnerId} txn=${txnId} amount=₹${covered}`)
    }
    return { covered, shortfall }
  } catch (err: any) {
    console.error(`[PartnerReserve] coverReversal threw txn=${txnId}: ${err?.message || err}`)
    return { covered: 0, shortfall: lossAmount }
  }
}

/** Mark unconsumed HOLD rows consumed FIFO for `amount`, splitting the remainder. */
async function consumeHoldsFifo(
  supabase: SupabaseClient,
  partnerId: string,
  amount: number
): Promise<void> {
  let need = round2(amount)
  const { data: holds } = await supabase
    .from('partner_reserve_ledger')
    .select('id, amount, reference_id, hold_release_at')
    .eq('partner_id', partnerId)
    .eq('entry_type', 'HOLD')
    .eq('consumed', false)
    .order('created_at', { ascending: true })

  for (const h of (holds || []) as any[]) {
    if (need <= 0) break
    const rowAmt = Number(h.amount || 0)
    await supabase.from('partner_reserve_ledger').update({ consumed: true }).eq('id', h.id)
    if (rowAmt <= need) {
      need = round2(need - rowAmt)
    } else {
      // Partial consumption: re-tag the leftover as a fresh releasable hold.
      const residual = round2(rowAmt - need)
      await supabase.from('partner_reserve_ledger').insert({
        partner_id: partnerId,
        txn_id: h.txn_id ?? null,
        entry_type: 'HOLD',
        amount: residual,
        balance_delta: 0, // not new money — carries the un-consumed remainder of h
        reference_id: `${h.reference_id}:resid`,
        description: 'Residual reserve hold after partial loss draw-down',
        hold_release_at: h.hold_release_at,
        consumed: false,
      })
      need = 0
    }
  }
}

/**
 * Release matured HOLD rows back to the partner wallet. Call periodically (e.g.
 * from the partner T+1 settlement cron). Idempotent per hold via its RELEASE
 * reference; a HOLD is marked consumed once released so it never double-credits.
 * Returns the number of holds released and the total rupees returned.
 */
export async function releaseMatureReserve(opts?: {
  supabase?: SupabaseClient
  partnerId?: string
  limit?: number
}): Promise<{ released: number; amount: number }> {
  const supabase = opts?.supabase ?? getSupabaseAdmin()
  const limit = opts?.limit ?? 500
  const nowIso = new Date().toISOString()

  let query = supabase
    .from('partner_reserve_ledger')
    .select('id, partner_id, amount, reference_id, txn_id')
    .eq('entry_type', 'HOLD')
    .eq('consumed', false)
    .lte('hold_release_at', nowIso)
    .order('hold_release_at', { ascending: true })
    .limit(limit)
  if (opts?.partnerId) query = query.eq('partner_id', opts.partnerId)

  const { data: matured, error } = await query
  if (error) {
    console.error(`[PartnerReserve] release scan failed: ${error.message}`)
    return { released: 0, amount: 0 }
  }
  if (!matured || matured.length === 0) return { released: 0, amount: 0 }

  const { creditPartnerWallet } = await import('@/lib/mdr-scheme/settlement.service')
  let released = 0
  let total = 0

  for (const h of matured as any[]) {
    const amt = Number(h.amount || 0)
    if (!(amt > 0)) {
      await supabase.from('partner_reserve_ledger').update({ consumed: true }).eq('id', h.id)
      continue
    }

    // Claim the hold first (atomic) so a concurrent run can't double-release it.
    const { data: claimed } = await supabase
      .from('partner_reserve_ledger')
      .update({ consumed: true })
      .eq('id', h.id)
      .eq('consumed', false)
      .select('id')
      .maybeSingle()
    if (!claimed) continue

    const releaseRef = `${h.reference_id}:release`
    const credit = await creditPartnerWallet(
      h.partner_id,
      amt,
      releaseRef,
      `Rolling reserve release${h.txn_id ? ` for ${h.txn_id}` : ''}: ₹${amt.toFixed(2)}`
    )

    if (!credit.success && !/duplicate/i.test(credit.error || '')) {
      // Roll the claim back so a later run retries this hold.
      await supabase.from('partner_reserve_ledger').update({ consumed: false }).eq('id', h.id)
      console.error(`[PartnerReserve] release credit failed hold=${h.id}: ${credit.error}`)
      continue
    }

    await supabase.from('partner_reserve_ledger').insert({
      partner_id: h.partner_id,
      txn_id: h.txn_id ?? null,
      entry_type: 'RELEASE',
      amount: amt,
      balance_delta: -amt,
      reference_id: releaseRef,
      description: `Reserve hold released to wallet${h.txn_id ? ` for ${h.txn_id}` : ''}`,
      hold_release_at: null,
      consumed: true,
    })
    released++
    total = round2(total + amt)
  }

  if (released > 0) {
    console.log(`[PartnerReserve] Released ${released} matured hold(s), ₹${total.toFixed(2)} returned to wallets.`)
  }
  return { released, amount: total }
}
