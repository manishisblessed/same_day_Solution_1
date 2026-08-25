/**
 * Daily per-user report aggregation.
 *
 * Ported from NEXTGEN's lib/reports/daily.ts, adapted to same_day's
 * wallet_ledger (retailer_id owner key + reference_id push/pull prefixes).
 *
 * Primary path uses the daily_user_report() Postgres RPC (see
 * db/migrations/20260824_0003_daily_report_rpc.sql). If the RPC is not yet
 * deployed, it degrades to an in-process aggregation over the day's rows.
 */

export interface DailyUserRow {
  user_id: string
  user_role: string
  name: string
  opening: number
  push: number
  pull: number
  credit: number
  debit: number
  commission: number
  closing: number
  reconDelta: number
  txnCount: number
}

export interface DailyReportResult {
  date: string
  rows: DailyUserRow[]
  totals: {
    opening: number
    push: number
    pull: number
    credit: number
    debit: number
    commission: number
    closing: number
    reconDelta: number
    users: number
  }
  source: 'rpc' | 'fallback'
}

function istDayBounds(date: string): { start: string; end: string } {
  // date is YYYY-MM-DD (IST calendar day).
  const start = `${date}T00:00:00+05:30`
  const d = new Date(`${date}T00:00:00+05:30`)
  d.setDate(d.getDate() + 1)
  const nextDate = d.toISOString().slice(0, 10)
  const end = `${nextDate}T00:00:00+05:30`
  return { start, end }
}

async function resolveNames(
  supabase: any,
  ids: string[]
): Promise<Map<string, { name: string; role: string }>> {
  const map = new Map<string, { name: string; role: string }>()
  if (ids.length === 0) return map
  const tables: Array<[string, string]> = [
    ['retailers', 'retailer'],
    ['distributors', 'distributor'],
    ['master_distributors', 'master_distributor'],
  ]
  for (const [table, role] of tables) {
    const { data } = await supabase
      .from(table)
      .select('partner_id, name, business_name')
      .in('partner_id', ids)
    for (const r of data || []) {
      if (!map.has(r.partner_id)) {
        map.set(r.partner_id, { name: r.name || r.business_name || r.partner_id, role })
      }
    }
  }
  return map
}

function toRow(raw: any, names: Map<string, { name: string; role: string }>): DailyUserRow {
  const opening = Number(raw.opening) || 0
  const credit = Number(raw.credit_total ?? raw.credit) || 0
  const debit = Number(raw.debit_total ?? raw.debit) || 0
  const closing = Number(raw.closing) || 0
  const info = names.get(raw.user_id)
  return {
    user_id: raw.user_id,
    user_role: raw.user_role || info?.role || '',
    name: info?.name || raw.user_id,
    opening,
    push: Number(raw.push) || 0,
    pull: Number(raw.pull) || 0,
    credit,
    debit,
    commission: Number(raw.commission) || 0,
    closing,
    reconDelta: Number((closing - (opening + credit - debit)).toFixed(2)),
    txnCount: Number(raw.txn_count ?? raw.txnCount) || 0,
  }
}

function summarize(rows: DailyUserRow[]) {
  const totals = {
    opening: 0,
    push: 0,
    pull: 0,
    credit: 0,
    debit: 0,
    commission: 0,
    closing: 0,
    reconDelta: 0,
    users: rows.length,
  }
  for (const r of rows) {
    totals.opening += r.opening
    totals.push += r.push
    totals.pull += r.pull
    totals.credit += r.credit
    totals.debit += r.debit
    totals.commission += r.commission
    totals.closing += r.closing
    totals.reconDelta += r.reconDelta
  }
  for (const k of Object.keys(totals) as (keyof typeof totals)[]) {
    if (k !== 'users') totals[k] = Number(totals[k].toFixed(2))
  }
  return totals
}

/**
 * @param scopeIds  null = all users (admin); otherwise restrict to these ids.
 */
export async function getDailyUserReport(
  supabase: any,
  date: string,
  scopeIds: string[] | null
): Promise<DailyReportResult> {
  // ── Primary: RPC ──
  const { data, error } = await supabase.rpc('daily_user_report', {
    p_date: date,
    p_ids: scopeIds,
  })

  if (!error && Array.isArray(data)) {
    const ids = data.map((d: any) => d.user_id)
    const names = await resolveNames(supabase, ids)
    const rows = data.map((d: any) => toRow(d, names)).sort((a: DailyUserRow, b: DailyUserRow) => b.closing - a.closing)
    return { date, rows, totals: summarize(rows), source: 'rpc' }
  }

  // ── Fallback: aggregate the day's rows in-process ──
  console.warn('[daily report] RPC unavailable, using fallback:', error?.message)
  const { start, end } = istDayBounds(date)
  let query = supabase
    .from('wallet_ledger')
    .select('retailer_id, user_role, wallet_type, fund_category, service_type, transaction_type, credit, debit, opening_balance, closing_balance, balance_after, reference_id, created_at')
    .gte('created_at', start)
    .lt('created_at', end)
    .order('created_at', { ascending: true })
    .limit(50000)
  if (scopeIds) query = query.in('retailer_id', scopeIds)

  const { data: ledger, error: ledgerErr } = await query
  if (ledgerErr) throw new Error(ledgerErr.message)

  const byUser = new Map<string, any>()
  for (const r of ledger || []) {
    if (r.wallet_type && r.wallet_type !== 'primary') continue
    const id = r.retailer_id
    if (!id) continue
    let agg = byUser.get(id)
    if (!agg) {
      agg = {
        user_id: id,
        user_role: r.user_role || '',
        opening: Number(r.opening_balance) || 0,
        closing: 0,
        credit_total: 0,
        debit_total: 0,
        push: 0,
        pull: 0,
        commission: 0,
        txn_count: 0,
      }
      byUser.set(id, agg)
    }
    const credit = Number(r.credit) || 0
    const debit = Number(r.debit) || 0
    agg.credit_total += credit
    agg.debit_total += debit
    agg.closing = Number(r.closing_balance ?? r.balance_after ?? agg.closing) || agg.closing
    const ref = String(r.reference_id || '')
    if (/^(ADMIN_PUSH_|DIST_PUSH_)/i.test(ref)) agg.push += credit
    if (/^(ADMIN_PULL_|DIST_PULL_)/i.test(ref)) agg.pull += debit
    if (/COMMISSION/i.test(String(r.transaction_type || '')) || /commission/i.test(String(r.fund_category || ''))) {
      agg.commission += credit
    }
    agg.txn_count += 1
  }

  const ids = Array.from(byUser.keys())
  const names = await resolveNames(supabase, ids)
  const rows = Array.from(byUser.values())
    .map((d) => toRow(d, names))
    .sort((a, b) => b.closing - a.closing)
  return { date, rows, totals: summarize(rows), source: 'fallback' }
}
