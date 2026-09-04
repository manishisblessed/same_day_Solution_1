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
  /** Total of ALL credits for the day (drives reconciliation). */
  credit: number
  /** Refund credits (subset of credit), shown as its own column. */
  refunds: number
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
    refunds: number
    debit: number
    commission: number
    closing: number
    reconDelta: number
    users: number
  }
  source: 'rpc' | 'fallback'
}

function istDayBounds(date: string): { start: string; end: string } {
  // date is YYYY-MM-DD (IST calendar day). Compute next day purely from the
  // calendar parts via UTC math — using new Date(...+05:30).toISOString() shifts
  // the date back into the previous UTC day and cancels the +1, making end==start.
  const start = `${date}T00:00:00+05:30`
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d))
  next.setUTCDate(next.getUTCDate() + 1)
  const nextDate = next.toISOString().slice(0, 10)
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
  // Partners share one table (PK `id` = uuid); is_master_partner splits the role.
  // Only pass UUID-shaped ids — retailer/distributor ids (e.g. RET123) would make
  // Postgres reject the whole `.in('id', …)` query as invalid uuid syntax.
  const uuidIds = ids.filter((id) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
  if (uuidIds.length > 0) {
    const { data: partners } = await supabase
      .from('partners')
      .select('id, name, business_name, is_master_partner')
      .in('id', uuidIds)
    for (const r of partners || []) {
      if (!map.has(r.id)) {
        map.set(r.id, {
          name: r.name || r.business_name || r.id,
          role: r.is_master_partner ? 'master_partner' : 'partner',
        })
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
    // Prefer the source-table role (authoritative; splits partner vs
    // master_partner via is_master_partner). Ledger writes both as 'partner'.
    user_role: info?.role || raw.user_role || '',
    name: info?.name || raw.user_id,
    opening,
    push: Number(raw.push) || 0,
    pull: Number(raw.pull) || 0,
    credit,
    refunds: Number(raw.refunds) || 0,
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
    refunds: 0,
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
    totals.refunds += r.refunds
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
 * Partners keep their balance in a separate ledger (partner_wallet_ledger,
 * keyed by partners.id) — the main wallet_ledger / daily_user_report RPC never
 * sees them. Aggregate that table for the day so partner + master_partner rows
 * appear in the report with the same columns.
 *
 * Each row carries opening_balance / closing_balance, so opening = first row's
 * opening and closing = last row's closing (rows ordered by created_at). Admin
 * push/pull reuse the ADMIN_PUSH_ / ADMIN_PULL_ reference prefixes. Commission is
 * ONLY the master-partner POS override (service_type pos_master_override / MCP-*);
 * PARTNER-T1 / PARTNER-INSTANT settlement credits are the partner's own proceeds
 * and stay in the Credit column, not Commission.
 */
async function getPartnerWalletRows(
  supabase: any,
  date: string,
  scopeIds: string[] | null
): Promise<any[]> {
  const { start, end } = istDayBounds(date)
  let q = supabase
    .from('partner_wallet_ledger')
    .select('partner_id, transaction_type, credit, debit, opening_balance, closing_balance, reference_id, service_type, created_at')
    .gte('created_at', start)
    .lt('created_at', end)
    .order('created_at', { ascending: true })
    .limit(50000)
  if (scopeIds) q = q.in('partner_id', scopeIds)

  const { data, error } = await q
  if (error) {
    console.warn('[daily report] partner_wallet_ledger unavailable:', error.message)
    return []
  }

  const byPartner = new Map<string, any>()
  for (const r of data || []) {
    const id = r.partner_id
    if (!id) continue
    let agg = byPartner.get(id)
    if (!agg) {
      agg = {
        user_id: id,
        opening: Number(r.opening_balance) || 0,
        closing: 0,
        credit_total: 0,
        debit_total: 0,
        push: 0,
        pull: 0,
        refunds: 0,
        commission: 0,
        txn_count: 0,
      }
      byPartner.set(id, agg)
    }
    const credit = Number(r.credit) || 0
    const debit = Number(r.debit) || 0
    agg.credit_total += credit
    agg.debit_total += debit
    agg.closing = Number(r.closing_balance) || agg.closing
    const ref = String(r.reference_id || '')
    const service = String(r.service_type || '').toLowerCase()
    const ttype = String(r.transaction_type || '').toUpperCase()
    // Money-in buckets are mutually exclusive so they sum to credit_total:
    //   push (admin) | commission (master override) | refunds | settlement (residual).
    if (/^ADMIN_PUSH_/i.test(ref)) agg.push += credit
    else if (/^ADMIN_PULL_/i.test(ref)) agg.pull += debit
    else if (service === 'pos_master_override' || /^MCP-/i.test(ref)) agg.commission += credit
    else if (ttype === 'REFUND' || /^REFUND/i.test(ref)) agg.refunds += credit
    agg.txn_count += 1
  }
  return Array.from(byPartner.values())
}

/**
 * @param scopeIds  null = all users (admin); otherwise restrict to these ids.
 */
export async function getDailyUserReport(
  supabase: any,
  date: string,
  scopeIds: string[] | null
): Promise<DailyReportResult> {
  const partnerRaw = await getPartnerWalletRows(supabase, date, scopeIds)

  // ── Primary: RPC ──
  const { data, error } = await supabase.rpc('daily_user_report', {
    p_date: date,
    p_ids: scopeIds,
  })

  if (!error && Array.isArray(data)) {
    const raw = [...data, ...partnerRaw]
    const ids = raw.map((d: any) => d.user_id)
    const names = await resolveNames(supabase, ids)
    const rows = raw.map((d: any) => toRow(d, names)).sort((a: DailyUserRow, b: DailyUserRow) => b.closing - a.closing)
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

  const raw = [...Array.from(byUser.values()), ...partnerRaw]
  const ids = raw.map((d) => d.user_id)
  const names = await resolveNames(supabase, ids)
  const rows = raw
    .map((d) => toRow(d, names))
    .sort((a, b) => b.closing - a.closing)
  return { date, rows, totals: summarize(rows), source: 'fallback' }
}
