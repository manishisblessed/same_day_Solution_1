import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { isAdminOrFinance } from '@/lib/auth-roles'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type AnyRow = Record<string, any>

// Page past the 1000-row PostgREST cap for any query builder.
async function fetchAllPaged(makeQuery: (from: number, to: number) => any): Promise<AnyRow[]> {
  const pageSize = 1000
  let from = 0
  const out: AnyRow[] = []
  for (let i = 0; i < 500; i++) {
    const { data, error } = await makeQuery(from, from + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    out.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return out
}

// Resolve display names server-side (service role — not affected by RLS)
async function attachNames(supabase: any, users: AnyRow[]) {
  const byRole: Record<string, string[]> = {}
  for (const u of users) (byRole[u.user_role] = byRole[u.user_role] || []).push(u.user_id)
  const names: Record<string, string> = {}
  const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n))
  const jobs: Promise<any>[] = []
  const collect = (table: string, idCol: string, ids: string[]) => {
    for (const ids500 of chunk(Array.from(new Set(ids)), 500)) {
      jobs.push(
        supabase.from(table).select(`${idCol}, name, business_name`).in(idCol, ids500)
          .then(({ data }: any) => data?.forEach((x: any) => { names[x[idCol]] = x.business_name || x.name }))
      )
    }
  }
  if (byRole.retailer?.length) collect('retailers', 'partner_id', byRole.retailer)
  if (byRole.distributor?.length) collect('distributors', 'partner_id', byRole.distributor)
  if (byRole.master_distributor?.length) collect('master_distributors', 'partner_id', byRole.master_distributor)
  if (byRole.partner?.length) collect('partners', 'id', byRole.partner)
  await Promise.all(jobs)
  for (const u of users) u.name = names[u.user_id] || null
}

const num = (v: any) => (typeof v === 'number' ? v : parseFloat(v) || 0)
const monthKey = (iso: string) => (iso ? String(iso).slice(0, 7) : '')

// Pivot per-(user, service) rows into one row per user with a service map.
function pivotUsers(rows: AnyRow[]) {
  const userMap = new Map<string, AnyRow>()
  for (const r of rows) {
    const key = `${r.user_id}__${r.user_role}`
    if (!userMap.has(key)) {
      userMap.set(key, {
        user_id: r.user_id, user_role: r.user_role, services: {},
        total_volume: 0, total_txns: 0, total_charges: 0, total_commission: 0, last_used: r.last_used,
      })
    }
    const u = userMap.get(key)!
    const vol = num(r.volume)
    const ch = num(r.charges_paid)
    u.services[r.service || 'other'] = { volume: vol, txns: num(r.txns), charges: ch }
    u.total_volume += vol
    u.total_txns += num(r.txns)
    u.total_charges += ch
    u.total_commission += num(r.commission_earned)
    if (r.last_used && (!u.last_used || r.last_used > u.last_used)) u.last_used = r.last_used
  }
  const users = Array.from(userMap.values()).sort((a, b) => b.total_volume - a.total_volume)
  const services = Array.from(new Set(rows.map((r) => r.service || 'other'))).sort()
  return { users, services }
}

export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Supabase configuration missing' }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { user: admin } = await getCurrentUserWithFallback(request)
    if (!admin) {
      return NextResponse.json({ error: 'Session expired. Please log in again.', code: 'SESSION_EXPIRED' }, { status: 401 })
    }
    if (!isAdminOrFinance(admin)) {
      return NextResponse.json({ error: 'Unauthorized: Admin or finance access required' }, { status: 403 })
    }

    // Date-range report: computed live by the same SQL function the all-time view uses
    const from = request.nextUrl.searchParams.get('from')
    const to = request.nextUrl.searchParams.get('to')
    if (from && to) {
      const rows = await fetchAllPaged((a, b) =>
        supabase
          .rpc('ba_user_service_usage', { p_from: `${from}T00:00:00`, p_to: `${to}T23:59:59.999` })
          .range(a, b)
      )
      const { users, services } = pivotUsers(rows)
      await attachNames(supabase, users)
      return NextResponse.json({ range: { from, to }, services, users })
    }

    // Optional manual refresh of the materialized views
    if (request.nextUrl.searchParams.get('refresh') === '1') {
      const { error: refreshErr } = await supabase.rpc('refresh_business_analytics')
      if (refreshErr) {
        return NextResponse.json({ error: `Refresh failed: ${refreshErr.message}` }, { status: 500 })
      }
    }

    const [pnl, partner, userService, growth] = await Promise.all([
      fetchAllPaged((a, b) => supabase.from('mv_ba_pnl_monthly').select('month, service, user_role, company_revenue, subscription_revenue, settlement_fees, commission_paid, usage_volume, txns').range(a, b)),
      fetchAllPaged((a, b) => supabase.from('mv_ba_partner_monthly').select('month, service, usage_volume, txns').range(a, b)),
      fetchAllPaged((a, b) => supabase.from('mv_ba_user_service').select('user_id, user_role, service, volume, txns, charges_paid, commission_earned, last_used').range(a, b)),
      fetchAllPaged((a, b) => supabase.from('mv_ba_user_growth_monthly').select('month, user_role, onboarded').range(a, b)),
    ])

    // ---- Monthly P&L trend (network + partner usage merged by month) ----
    const monthMap = new Map<string, AnyRow>()
    const ensureMonth = (m: string) => {
      if (!monthMap.has(m)) {
        monthMap.set(m, {
          month: m, company_revenue: 0, subscription_revenue: 0, settlement_fees: 0,
          commission_paid: 0, usage_volume: 0, txns: 0, partner_volume: 0,
        })
      }
      return monthMap.get(m)!
    }
    for (const r of pnl) {
      const m = ensureMonth(monthKey(r.month))
      m.company_revenue += num(r.company_revenue)
      m.subscription_revenue += num(r.subscription_revenue)
      m.settlement_fees += num(r.settlement_fees)
      m.commission_paid += num(r.commission_paid)
      m.usage_volume += num(r.usage_volume)
      m.txns += num(r.txns)
    }
    for (const r of partner) {
      const m = ensureMonth(monthKey(r.month))
      m.partner_volume += num(r.usage_volume)
      m.usage_volume += num(r.usage_volume)
      m.txns += num(r.txns)
    }
    const monthlyPnl = Array.from(monthMap.values())
      .map((m) => ({
        ...m,
        revenue: m.company_revenue + m.subscription_revenue + m.settlement_fees,
        net_margin: m.company_revenue + m.subscription_revenue + m.settlement_fees - m.commission_paid,
      }))
      .sort((a, b) => a.month.localeCompare(b.month))

    // ---- Service breakdown ----
    const serviceMap = new Map<string, AnyRow>()
    const ensureService = (s: string) => {
      if (!serviceMap.has(s)) {
        serviceMap.set(s, { service: s, revenue: 0, commission_paid: 0, usage_volume: 0, txns: 0 })
      }
      return serviceMap.get(s)!
    }
    for (const r of pnl) {
      const s = ensureService(r.service || 'other')
      s.revenue += num(r.company_revenue) + num(r.subscription_revenue) + num(r.settlement_fees)
      s.commission_paid += num(r.commission_paid)
      s.usage_volume += num(r.usage_volume)
      s.txns += num(r.txns)
    }
    for (const r of partner) {
      const s = ensureService(r.service || 'other')
      s.usage_volume += num(r.usage_volume)
      s.txns += num(r.txns)
    }
    const serviceBreakdown = Array.from(serviceMap.values())
      .filter((s) => s.usage_volume > 0 || s.revenue !== 0)
      .sort((a, b) => b.usage_volume - a.usage_volume)

    // ---- Role breakdown ----
    const roleMap = new Map<string, AnyRow>()
    for (const r of pnl) {
      const key = r.user_role || 'unknown'
      const row = roleMap.get(key) || { user_role: key, revenue: 0, commission_paid: 0, usage_volume: 0, txns: 0 }
      row.revenue += num(r.company_revenue) + num(r.subscription_revenue) + num(r.settlement_fees)
      row.commission_paid += num(r.commission_paid)
      row.usage_volume += num(r.usage_volume)
      row.txns += num(r.txns)
      roleMap.set(key, row)
    }
    const partnerUsage = partner.reduce((s, r) => s + num(r.usage_volume), 0)
    const partnerTxns = partner.reduce((s, r) => s + num(r.txns), 0)
    if (partnerUsage > 0 || partnerTxns > 0) {
      roleMap.set('partner', { user_role: 'partner', revenue: 0, commission_paid: 0, usage_volume: partnerUsage, txns: partnerTxns })
    }
    const roleBreakdown = Array.from(roleMap.values()).sort((a, b) => b.usage_volume - a.usage_volume)

    // ---- Per-user service usage matrix ----
    const { users, services } = pivotUsers(userService)
    await attachNames(supabase, users)

    // ---- User growth (cumulative by role) ----
    const growthMonthMap = new Map<string, AnyRow>()
    for (const r of growth) {
      const m = monthKey(r.month)
      if (!growthMonthMap.has(m)) growthMonthMap.set(m, { month: m, retailer: 0, distributor: 0, master_distributor: 0, partner: 0 })
      growthMonthMap.get(m)![r.user_role] = num(r.onboarded)
    }
    const growthSorted = Array.from(growthMonthMap.values()).sort((a, b) => a.month.localeCompare(b.month))
    let cumRT = 0, cumDT = 0, cumMD = 0, cumPT = 0
    const userGrowth = growthSorted.map((g) => {
      cumRT += g.retailer; cumDT += g.distributor; cumMD += g.master_distributor; cumPT += g.partner
      return {
        month: g.month,
        retailer: cumRT, distributor: cumDT, master_distributor: cumMD, partner: cumPT,
        total: cumRT + cumDT + cumMD + cumPT,
      }
    })

    // ---- Headline KPIs ----
    const totalCompanyRevenue = pnl.reduce((s, r) => s + num(r.company_revenue), 0)
    const totalSubscriptionRevenue = pnl.reduce((s, r) => s + num(r.subscription_revenue), 0)
    const totalSettlementFees = pnl.reduce((s, r) => s + num(r.settlement_fees), 0)
    const totalRevenue = totalCompanyRevenue + totalSubscriptionRevenue + totalSettlementFees
    const totalCommissionPaid = pnl.reduce((s, r) => s + num(r.commission_paid), 0)
    const totalUsageVolume = pnl.reduce((s, r) => s + num(r.usage_volume), 0) + partnerUsage
    const totalTxns = pnl.reduce((s, r) => s + num(r.txns), 0) + partnerTxns
    const totalChargesCollected = users.reduce((s, u) => s + u.total_charges, 0)
    const netMargin = totalRevenue - totalCommissionPaid

    const thisMonth = new Date().toISOString().slice(0, 7)
    const curr = monthlyPnl.find((m) => m.month === thisMonth)

    return NextResponse.json({
      summary: {
        totalRevenue,
        companyRevenue: totalCompanyRevenue,
        subscriptionRevenue: totalSubscriptionRevenue,
        settlementFees: totalSettlementFees,
        chargesCollected: totalChargesCollected,
        commissionPaid: totalCommissionPaid,
        netMargin,
        marginPct: totalRevenue > 0 ? (netMargin / totalRevenue) * 100 : 0,
        usageVolume: totalUsageVolume,
        txns: totalTxns,
        activeUsers: users.length,
        totalOnboarded: userGrowth.length ? userGrowth[userGrowth.length - 1].total : 0,
        currentMonth: curr
          ? { revenue: curr.revenue, commissionPaid: curr.commission_paid, netMargin: curr.net_margin, usageVolume: curr.usage_volume }
          : null,
      },
      monthlyPnl,
      serviceBreakdown,
      roleBreakdown,
      services,
      users,
      userGrowth,
    })
  } catch (err: any) {
    console.error('[Business Analytics] error:', err)
    return NextResponse.json({ error: err?.message || 'Failed to build analytics' }, { status: 500 })
  }
}
