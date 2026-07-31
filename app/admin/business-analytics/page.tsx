'use client'

import { useState, useEffect, useCallback, useMemo, Suspense, Fragment } from 'react'
import Link from 'next/link'
import AdminSidebar from '@/components/AdminSidebar'
import ExportDropdown, { type ExportFormat, downloadBlob } from '@/components/ExportDropdown'
import { apiFetchJson } from '@/lib/api-client'
import {
  BarChart3, TrendingUp, Wallet, Users, Percent, RefreshCw, Loader2,
  Search, ChevronDown, ChevronUp, ChevronRight, Coins, Banknote, ArrowUp, ArrowDown, Minus, X,
} from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'

interface ServiceCell { volume: number; txns: number; charges: number }
interface UserRow {
  user_id: string
  user_role: string
  services: Record<string, ServiceCell>
  total_volume: number
  total_txns: number
  total_charges: number
  total_commission: number
  last_used: string | null
}
interface Analytics {
  summary: {
    totalRevenue: number; companyRevenue: number; subscriptionRevenue: number; settlementFees: number
    chargesCollected: number
    commissionPaid: number; netMargin: number; marginPct: number; usageVolume: number; txns: number
    activeUsers: number; totalOnboarded: number
    currentMonth: { revenue: number; commissionPaid: number; netMargin: number; usageVolume: number } | null
  }
  monthlyPnl: any[]
  serviceBreakdown: any[]
  roleBreakdown: any[]
  services: string[]
  users: UserRow[]
  userGrowth: any[]
}

const SERVICE_LABEL: Record<string, string> = {
  bbps: 'BBPS', settlement: 'Settlement', recharge: 'Credit Card',
}
const ROLE_LABEL: Record<string, string> = {
  retailer: 'Retailer', distributor: 'Distributor', master_distributor: 'Master Distributor',
  partner: 'Partner', unknown: 'Unknown',
}
const ROLE_DETAIL_HREF: Record<string, string> = {
  retailer: '/admin?tab=retailers',
  distributor: '/admin?tab=distributors',
  master_distributor: '/admin?tab=master-distributors',
  partner: '/admin?tab=partners',
}
const ROLE_COLOR: Record<string, string> = {
  retailer: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  distributor: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  master_distributor: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  partner: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  unknown: 'bg-gray-100 text-gray-700',
}

const fmt = (n: number) => `₹${(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const fmt2 = (n: number) => `₹${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const compact = (n: number) => {
  const a = Math.abs(n)
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`
  if (a >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`
  return `₹${n.toFixed(0)}`
}

export default function BusinessAnalyticsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>}>
      <BusinessAnalyticsContent />
    </Suspense>
  )
}

function BusinessAnalyticsContent() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<Analytics | null>(null)
  const [nameCache, setNameCache] = useState<Record<string, string>>({})

  // per-user table controls
  const [roleFilter, setRoleFilter] = useState('')
  const [serviceFilter, setServiceFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(50)

  // date-range report (recomputed from raw ledger)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [ranged, setRanged] = useState<{ from: string; to: string; users: UserRow[]; services: string[] } | null>(null)
  const [rangeLoading, setRangeLoading] = useState(false)
  const [exporting, setExporting] = useState<ExportFormat | null>(null)

  // Names come pre-resolved from the API (server-side, service role)
  const seedNames = useCallback((users: (UserRow & { name?: string | null })[]) => {
    const names: Record<string, string> = {}
    for (const u of users) if (u.name) names[u.user_id] = u.name
    if (Object.keys(names).length) setNameCache(prev => ({ ...prev, ...names }))
  }, [])

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true)
    setError(null)
    try {
      const json = await apiFetchJson(`/api/admin/business-analytics${refresh ? '?refresh=1' : ''}`)
      setData(json)
      seedNames(json.users || [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load analytics')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [seedNames])

  useEffect(() => { load(false) }, [load])

  const applyRange = useCallback(async () => {
    if (!dateFrom || !dateTo) return
    setRangeLoading(true)
    setError(null)
    try {
      const json = await apiFetchJson(`/api/admin/business-analytics?from=${dateFrom}&to=${dateTo}`)
      setRanged({ from: dateFrom, to: dateTo, users: json.users || [], services: json.services || [] })
      setVisibleCount(50)
      seedNames(json.users || [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load ranged report')
    } finally {
      setRangeLoading(false)
    }
  }, [dateFrom, dateTo, seedNames])

  const clearRange = useCallback(() => {
    setRanged(null); setDateFrom(''); setDateTo(''); setVisibleCount(50)
  }, [])

  const s = data?.summary

  // current vs previous month deltas (from all-time monthly P&L)
  const deltas = useMemo(() => {
    const mp = data?.monthlyPnl || []
    if (mp.length < 1) return null
    const now = new Date()
    const curKey = now.toISOString().slice(0, 7)
    const prevKey = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7)
    const cur = mp.find((m) => m.month === curKey)
    const prev = mp.find((m) => m.month === prevKey)
    const pct = (c: number, p: number) => (p > 0 ? ((c - p) / p) * 100 : c > 0 ? 100 : 0)
    return {
      revenue: pct(cur?.revenue || 0, prev?.revenue || 0),
      commission: pct(cur?.commission_paid || 0, prev?.commission_paid || 0),
      margin: pct(cur?.net_margin || 0, prev?.net_margin || 0),
      gtv: pct(cur?.usage_volume || 0, prev?.usage_volume || 0),
      hasPrev: !!prev,
    }
  }, [data])

  const activeUsers = ranged?.users ?? data?.users ?? []
  const cols = ranged?.services ?? data?.services ?? []

  const filteredUsers = useMemo(() => {
    let rows = activeUsers
    if (roleFilter) rows = rows.filter(u => u.user_role === roleFilter)
    if (serviceFilter) rows = rows.filter(u => (u.services[serviceFilter]?.volume || 0) > 0)
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      rows = rows.filter(u => u.user_id.toLowerCase().includes(q) || (nameCache[u.user_id] || '').toLowerCase().includes(q))
    }
    if (serviceFilter) rows = [...rows].sort((a, b) => (b.services[serviceFilter]?.volume || 0) - (a.services[serviceFilter]?.volume || 0))
    return rows
  }, [activeUsers, roleFilter, serviceFilter, searchQuery, nameCache])

  const periodLabel = ranged ? `${ranged.from} to ${ranged.to}` : 'All-time'

  // compact=true → fewer columns (fits PDF landscape); false → full detail for CSV
  const buildReport = (compactCols: boolean) => {
    const headers = compactCols
      ? ['User ID', 'Name', 'Role', ...cols.map(c => `${SERVICE_LABEL[c] || c} ₹`), 'Total ₹', 'Charges ₹', 'Comm ₹']
      : ['User ID', 'Name', 'Role',
         ...cols.map(c => `${SERVICE_LABEL[c] || c} Volume`),
         ...cols.map(c => `${SERVICE_LABEL[c] || c} Charges`),
         'Total Volume', 'Total Charges', 'Total Txns', 'Commission Earned']
    const rows = filteredUsers.map(u => compactCols
      ? [u.user_id, nameCache[u.user_id] || '', ROLE_LABEL[u.user_role] || u.user_role,
         ...cols.map(c => (u.services[c]?.volume || 0).toFixed(2)),
         u.total_volume.toFixed(2), u.total_charges.toFixed(2), u.total_commission.toFixed(2)]
      : [u.user_id, nameCache[u.user_id] || '', ROLE_LABEL[u.user_role] || u.user_role,
         ...cols.map(c => (u.services[c]?.volume || 0).toFixed(2)),
         ...cols.map(c => (u.services[c]?.charges || 0).toFixed(2)),
         u.total_volume.toFixed(2), u.total_charges.toFixed(2), String(u.total_txns), u.total_commission.toFixed(2)])
    return { headers, rows }
  }

  const buildCsv = () => {
    const { headers, rows } = buildReport(false)
    const escapeCSV = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
    const meta = `Per-User Service Usage,Period: ${periodLabel},Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`
    return '\uFEFF' + [meta, headers.join(','), ...rows.map(r => r.map(escapeCSV).join(','))].join('\n')
  }

  const buildPdf = async () => {
    const { jsPDF } = await import('jspdf')
    const { headers, rows } = buildReport(true)
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
    const ps: any = doc.internal.pageSize
    const pageW = typeof ps.getWidth === 'function' ? ps.getWidth() : ps.width
    const pageH = typeof ps.getHeight === 'function' ? ps.getHeight() : ps.height
    const marginX = 8
    const usableW = pageW - marginX * 2
    // widen the name column, distribute the rest
    const weights = headers.map((_, i) => (i === 1 ? 3 : i === 0 ? 2.2 : 1))
    const wsum = weights.reduce((a, b) => a + b, 0)
    const colW = weights.map(w => (w / wsum) * usableW)
    let y = 14
    doc.setFontSize(13); doc.text('Per-User Service Usage', marginX, y)
    doc.setFontSize(8); y += 5
    doc.text(`Period: ${periodLabel}   |   Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}   |   ${rows.length} users`, marginX, y)
    y += 4
    const drawHeader = () => {
      doc.setFillColor(79, 70, 229); doc.setTextColor(255); doc.setFontSize(7)
      doc.rect(marginX, y, usableW, 6, 'F')
      let x = marginX
      headers.forEach((h, i) => { doc.text(String(h).slice(0, 22), x + 1, y + 4); x += colW[i] })
      y += 6
      doc.setTextColor(30)
    }
    drawHeader()
    doc.setFontSize(6.5)
    for (const r of rows) {
      if (y > pageH - 10) { doc.addPage(); y = 12; drawHeader(); doc.setFontSize(6.5) }
      let x = marginX
      r.forEach((c, i) => { doc.text(String(c).slice(0, i === 1 ? 34 : 20), x + 1, y + 3.5); x += colW[i] })
      y += 5
      doc.setDrawColor(230); doc.line(marginX, y, pageW - marginX, y)
    }
    return doc.output('blob')
  }

  const handleExport = async (format: ExportFormat) => {
    if (!filteredUsers.length) return
    setExporting(format)
    try {
      const base = `user-service-usage-${ranged ? `${ranged.from}_to_${ranged.to}` : 'all-time'}`
      if (format === 'csv') {
        downloadBlob(new Blob([buildCsv()], { type: 'text/csv;charset=utf-8' }), `${base}.csv`)
      } else if (format === 'pdf') {
        downloadBlob(await buildPdf(), `${base}.pdf`)
      } else if (format === 'zip') {
        const JSZip = (await import('jszip')).default
        const zip = new JSZip()
        zip.file(`${base}.csv`, buildCsv())
        zip.file(`${base}.pdf`, await buildPdf())
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
        downloadBlob(blob, `${base}.zip`)
      }
    } catch (e) {
      console.error('Export failed:', e)
    } finally {
      setExporting(null)
    }
  }

  const DeltaBadge = ({ pct, invert }: { pct?: number; invert?: boolean }) => {
    if (pct == null || !deltas?.hasPrev) return null
    const flat = Math.abs(pct) < 0.05
    const up = pct > 0
    // invert=true means "up is bad" (e.g. commission paid)
    const good = flat ? false : invert ? !up : up
    const cls = flat ? 'text-gray-400 bg-gray-100 dark:bg-gray-800' : good ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20' : 'text-red-600 bg-red-50 dark:bg-red-900/20'
    const Icon = flat ? Minus : up ? ArrowUp : ArrowDown
    const a = Math.abs(pct)
    const label = a >= 1000 ? '999%+' : `${a.toFixed(a >= 100 ? 0 : 1)}%`
    return (
      <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap shrink-0 ${cls}`} title="This month vs previous month (MoM)">
        <Icon className="w-3 h-3 shrink-0" />{label}
      </span>
    )
  }

  const scrollToUsers = () => document.getElementById('per-user-usage')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const KPI = ({ icon: Icon, label, value, sub, color, delta, invertDelta, href, onClick }: any) => {
    const body = (
      <>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-500">{label}</span>
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
        <div className={`text-xl font-bold ${color}`}>{value}</div>
        <div className="flex items-center gap-1.5 mt-0.5 min-h-[18px]">
          {delta !== undefined && <DeltaBadge pct={delta} invert={invertDelta} />}
          {sub && <span className="text-[11px] text-gray-400 truncate">{sub}</span>}
        </div>
      </>
    )
    const cls = 'block bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 transition hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-md cursor-pointer'
    if (href) return <Link href={href} className={cls} title={`Open detailed view: ${label}`}>{body}</Link>
    if (onClick) return <div onClick={onClick} className={cls} title={`Jump to details: ${label}`}>{body}</div>
    return <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">{body}</div>
  }

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-950">
      <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="flex-1 lg:ml-56 p-4 md:p-6 pt-16 md:pt-16">
        {/* Sticky header: stays visible below the fixed navbar while scrolling */}
        <div className="sticky top-16 z-30 -mx-4 md:-mx-6 px-4 md:px-6 py-3 mb-4 bg-gray-50/95 dark:bg-gray-950/95 backdrop-blur border-b border-gray-200/60 dark:border-gray-800/60 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <BarChart3 className="w-6 h-6 text-primary-600" /> Business Analytics
            </h1>
            <p className="text-xs md:text-sm text-gray-500 mt-0.5">All-time platform profitability &amp; per-user service usage (RT / DT / MD / Partners)</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ExportDropdown onExport={handleExport} disabled={filteredUsers.length === 0} exporting={exporting} formats={['csv', 'pdf', 'zip']} />
            <button onClick={() => load(true)} disabled={refreshing || loading}
              className="px-3 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 text-sm font-medium flex items-center gap-2 disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh data
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-20 text-gray-500 flex items-center justify-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Building analytics...
          </div>
        ) : error ? (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 rounded-xl p-4 text-sm">
            {error}
            <div className="mt-2 text-xs text-red-600/80">If the materialized views are missing, run <code>BUSINESS-ANALYTICS-RUN-IN-SUPABASE.sql</code> in Supabase first.</div>
          </div>
        ) : s ? (
          <>
            {/* KPI row */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
              <KPI icon={Coins} label="Net Revenue" value={compact(s.totalRevenue)} sub="all-time" color="text-green-600" delta={deltas?.revenue} href="/admin/business-report" />
              <KPI icon={Banknote} label="Commission Paid" value={compact(s.commissionPaid)} sub="to network" color="text-orange-600" delta={deltas?.commission} invertDelta href="/admin/business-report" />
              <KPI icon={TrendingUp} label="Net Margin" value={compact(s.netMargin)} sub={`${s.marginPct.toFixed(1)}% of rev`} color="text-emerald-600" delta={deltas?.margin} href="/admin/business-report" />
              <KPI icon={Wallet} label="Total GTV" value={compact(s.usageVolume)} sub={`${s.txns.toLocaleString('en-IN')} txns`} color="text-blue-600" delta={deltas?.gtv} href="/admin?tab=reports" />
              <KPI icon={Users} label="Active Users" value={s.activeUsers.toLocaleString('en-IN')} sub={`${s.totalOnboarded.toLocaleString('en-IN')} onboarded`} color="text-indigo-600" onClick={scrollToUsers} />
              <KPI icon={Percent} label="Rev / User" value={compact(s.activeUsers ? s.totalRevenue / s.activeUsers : 0)} sub="avg lifetime" color="text-purple-600" onClick={scrollToUsers} />
            </div>

            {/* Revenue breakdown chips */}
            <div className="flex flex-wrap gap-3 mb-6 text-xs">
              <span className="px-3 py-1.5 rounded-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800">Company revenue: <b className="text-green-600">{fmt(s.companyRevenue)}</b></span>
              <span className="px-3 py-1.5 rounded-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800">Subscription: <b className="text-green-600">{fmt(s.subscriptionRevenue)}</b></span>
              <span className="px-3 py-1.5 rounded-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800">Settlement fees: <b className="text-green-600">{fmt(s.settlementFees)}</b></span>
              <span className="px-3 py-1.5 rounded-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800" title="Total service fees collected from users (BBPS charges, settlement charges, recharge GST, etc.)">Charges collected from users: <b className="text-amber-600">{fmt(s.chargesCollected)}</b></span>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Revenue vs Commission (monthly)</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={data.monthlyPnl}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="month" fontSize={11} />
                    <YAxis fontSize={11} tickFormatter={compact} width={60} />
                    <Tooltip formatter={(v: any) => fmt2(Number(v))} />
                    <Legend />
                    <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#16a34a" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="commission_paid" name="Commission" stroke="#ea580c" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="net_margin" name="Net margin" stroke="#4f46e5" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">GTV over time</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={data.monthlyPnl}>
                    <defs>
                      <linearGradient id="gtv" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="month" fontSize={11} />
                    <YAxis fontSize={11} tickFormatter={compact} width={60} />
                    <Tooltip formatter={(v: any) => fmt2(Number(v))} />
                    <Area type="monotone" dataKey="usage_volume" name="GTV" stroke="#3b82f6" fill="url(#gtv)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">User growth (cumulative)</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={data.userGrowth}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="month" fontSize={11} />
                    <YAxis fontSize={11} width={40} />
                    <Tooltip />
                    <Legend />
                    <Area type="monotone" dataKey="retailer" name="Retailers" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.5} />
                    <Area type="monotone" dataKey="distributor" name="Distributors" stackId="1" stroke="#14b8a6" fill="#14b8a6" fillOpacity={0.5} />
                    <Area type="monotone" dataKey="master_distributor" name="MDs" stackId="1" stroke="#6366f1" fill="#6366f1" fillOpacity={0.5} />
                    <Area type="monotone" dataKey="partner" name="Partners" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.5} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Volume by service</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.serviceBreakdown.filter((r: any) => r.usage_volume > 0)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="service" fontSize={11} interval={0} tickFormatter={(v) => SERVICE_LABEL[v] || v} />
                    <YAxis fontSize={11} tickFormatter={compact} width={60} />
                    <Tooltip formatter={(v: any) => fmt2(Number(v))} labelFormatter={(l) => SERVICE_LABEL[l] || l} />
                    <Bar dataKey="usage_volume" name="Volume" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Role breakdown */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              {data.roleBreakdown.map((r) => {
                const href = ROLE_DETAIL_HREF[r.user_role]
                const inner = (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${ROLE_COLOR[r.user_role] || ROLE_COLOR.unknown}`}>{ROLE_LABEL[r.user_role] || r.user_role}</span>
                      {href && <ChevronRight className="w-4 h-4 text-gray-300" />}
                    </div>
                    <div className="text-lg font-bold text-blue-600">{compact(r.usage_volume)}</div>
                    <div className="text-[11px] text-gray-400">{r.txns.toLocaleString('en-IN')} txns · comm {compact(r.commission_paid)}</div>
                  </>
                )
                return href ? (
                  <Link key={r.user_role} href={href} title={`Open ${ROLE_LABEL[r.user_role] || r.user_role} list`}
                    className="block bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 transition hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-md">
                    {inner}
                  </Link>
                ) : (
                  <div key={r.user_role} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">{inner}</div>
                )
              })}
            </div>

            {/* Per-user service usage */}
            <div id="per-user-usage" className="scroll-mt-40 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
              <div className="p-4 border-b border-gray-200 dark:border-gray-800 flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-[220px]">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Per-User Service Usage</h3>
                  <span className={`text-[11px] ${ranged ? 'text-primary-600 font-medium' : 'text-gray-400'}`}>
                    {ranged ? `Period: ${ranged.from} → ${ranged.to}` : 'All-time (set a date range to export a specific period)'}
                  </span>
                  <div className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                    <b className="text-gray-700 dark:text-gray-300">How to read:</b> each service column shows how much the user transacted in that service (net of refunds).
                    <b className="text-amber-600"> Charges</b> = fees they paid us. <b className="text-emerald-600">Comm</b> = commission they earned. Click a row for the full breakdown.
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-medium mb-1 text-gray-500">From</label>
                  <input type="date" value={dateFrom} max={dateTo || undefined} onChange={e => setDateFrom(e.target.value)}
                    className="px-2 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-sm" />
                </div>
                <div>
                  <label className="block text-[10px] font-medium mb-1 text-gray-500">To</label>
                  <input type="date" value={dateTo} min={dateFrom || undefined} onChange={e => setDateTo(e.target.value)}
                    className="px-2 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-sm" />
                </div>
                <button onClick={applyRange} disabled={!dateFrom || !dateTo || rangeLoading}
                  className="px-3 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium disabled:opacity-50 flex items-center gap-1.5">
                  {rangeLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />} Apply
                </button>
                {ranged && (
                  <button onClick={clearRange} className="px-2 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1">
                    <X className="w-4 h-4" /> Clear
                  </button>
                )}
                <select value={roleFilter} onChange={e => { setRoleFilter(e.target.value); setVisibleCount(50) }}
                  className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-sm">
                  <option value="">All Roles</option>
                  <option value="retailer">Retailer</option>
                  <option value="distributor">Distributor</option>
                  <option value="master_distributor">Master Distributor</option>
                  <option value="partner">Partner</option>
                </select>
                <select value={serviceFilter} onChange={e => { setServiceFilter(e.target.value); setVisibleCount(50) }}
                  className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-sm">
                  <option value="">All Services</option>
                  {cols.map(c => <option key={c} value={c}>{SERVICE_LABEL[c] || c}</option>)}
                </select>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="User ID or name..."
                    className="pl-9 pr-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-sm" />
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                      <th className="px-3 py-2 text-left">User</th>
                      <th className="px-3 py-2 text-left">Role</th>
                      {cols.map(c => <th key={c} className="px-3 py-2 text-right" title={`Amount transacted in ${SERVICE_LABEL[c] || c} (net of refunds)`}>{SERVICE_LABEL[c] || c}</th>)}
                      <th className="px-3 py-2 text-right" title="Total transacted across all services">Total</th>
                      <th className="px-3 py-2 text-right" title="Fees this user paid to the platform">Charges</th>
                      <th className="px-3 py-2 text-right" title="Number of transactions">Txns</th>
                      <th className="px-3 py-2 text-right" title="Commission this user earned">Comm</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.slice(0, visibleCount).map((u) => {
                      const key = `${u.user_id}__${u.user_role}`
                      const open = expanded === key
                      return (
                        <Fragment key={key}>
                          <tr className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
                            onClick={() => setExpanded(open ? null : key)}>
                            <td className="px-3 py-2">
                              <div className="font-medium text-gray-900 dark:text-white truncate max-w-[180px]">{nameCache[u.user_id] || u.user_id}</div>
                              <div className="text-[10px] text-gray-400 truncate max-w-[180px]">{u.user_id}</div>
                            </td>
                            <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${ROLE_COLOR[u.user_role] || ROLE_COLOR.unknown}`}>{ROLE_LABEL[u.user_role] || u.user_role}</span></td>
                            {cols.map(c => (
                              <td key={c} className="px-3 py-2 text-right tabular-nums">
                                {u.services[c]?.volume ? <span className="text-gray-900 dark:text-gray-200">{compact(u.services[c].volume)}</span> : <span className="text-gray-300">–</span>}
                              </td>
                            ))}
                            <td className="px-3 py-2 text-right font-semibold text-blue-600 tabular-nums">{compact(u.total_volume)}</td>
                            <td className="px-3 py-2 text-right text-amber-600 font-medium tabular-nums">{u.total_charges ? fmt2(u.total_charges) : '–'}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{u.total_txns.toLocaleString('en-IN')}</td>
                            <td className="px-3 py-2 text-right text-emerald-600 tabular-nums">{u.total_commission ? fmt2(u.total_commission) : '–'}</td>
                            <td className="px-3 py-2 text-right">{open ? <ChevronUp className="w-3.5 h-3.5 text-gray-400 inline" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400 inline" />}</td>
                          </tr>
                          {open && (
                            <tr className="bg-gray-50 dark:bg-gray-800/30">
                              <td colSpan={cols.length + 7} className="px-4 py-3">
                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                                  {cols.filter(c => u.services[c]?.volume || u.services[c]?.charges).map(c => (
                                    <div key={c} className="p-2.5 bg-white dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-700">
                                      <div className="text-[11px] font-medium text-gray-600 dark:text-gray-300 mb-1">{SERVICE_LABEL[c] || c}</div>
                                      <div className="text-sm font-semibold text-gray-900 dark:text-white">{fmt2(u.services[c].volume)}</div>
                                      <div className="text-[10px] text-gray-400 mt-0.5">{u.services[c].txns.toLocaleString('en-IN')} txns</div>
                                      <div className="text-[10px] text-amber-600 mt-0.5">Charges paid: {fmt2(u.services[c].charges || 0)}</div>
                                    </div>
                                  ))}
                                  <div className="p-2.5 bg-emerald-50 dark:bg-emerald-900/10 rounded-lg border border-emerald-100 dark:border-emerald-900/30">
                                    <div className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 mb-1">Summary</div>
                                    <div className="text-[10px] text-gray-500">Total charges paid: <b className="text-amber-600">{fmt2(u.total_charges)}</b></div>
                                    <div className="text-[10px] text-gray-500">Commission earned: <b className="text-emerald-600">{fmt2(u.total_commission)}</b></div>
                                    <div className="text-[10px] text-gray-500">Total txns: <b>{u.total_txns.toLocaleString('en-IN')}</b></div>
                                  </div>
                                </div>
                                {u.last_used && <div className="text-[10px] text-gray-400 mt-2">Last activity: {new Date(u.last_used).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</div>}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="p-3 flex items-center justify-between text-xs text-gray-500 border-t border-gray-100 dark:border-gray-800">
                <span>Showing {Math.min(visibleCount, filteredUsers.length)} of {filteredUsers.length.toLocaleString('en-IN')} users</span>
                {visibleCount < filteredUsers.length && (
                  <button onClick={() => { setVisibleCount(c => c + 100); fetchNames(filteredUsers.slice(visibleCount, visibleCount + 100)) }}
                    className="px-3 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700">Load more</button>
                )}
              </div>
            </div>
          </>
        ) : null}
      </main>
    </div>
  )
}
