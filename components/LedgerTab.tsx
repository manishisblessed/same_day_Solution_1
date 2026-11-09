'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { secureDb } from '@/lib/secure-db'
import { cleanDescription } from '@/lib/format'
import { derivePay2NewReportStatus, hasPay2NewOrderStamp } from '@/lib/pay2new/display-status'
import {
  RefreshCw, Download, Search,
  ArrowDownCircle, ArrowUpCircle,
  TrendingUp, TrendingDown, Wallet,
  Receipt, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { motion } from 'framer-motion'
import ExportDropdown, { type ExportFormat, downloadBlob } from '@/components/ExportDropdown'

// ─── Description parser (pay2new BBPS-2 CC format) ─────────────────────────
function parsePay2NewDesc(desc: string | null | undefined) {
  if (!desc) return { billAmt: null, charge: null, card: null, mobile: null, product: null }
  const billMatch   = desc.match(/₹([\d.]+)\s*\+\s*₹[\d.]+\s*charge/)
  const chargeMatch = desc.match(/\+\s*₹([\d.]+)\s*charge/)
  const parts       = desc.split('|')
  const productRaw  = parts[1]?.trim() ?? null
  return {
    billAmt: billMatch?.[1]  ?? null,
    charge:  chargeMatch?.[1] ?? null,
    card:    desc.match(/Card:(\*+\d+)/)?.[1]  ?? null,
    mobile:  desc.match(/Mob:(\d{10})/)?.[1]   ?? null,
    product: productRaw ? productRaw.replace(/\+/g, ' ').replace(/\s+/g, ' ').trim() : null,
  }
}

// ─── Smart status ───────────────────────────────────────────────────────────
const BADGE_CLS: Record<string, string> = {
  green:  'bg-green-100  text-green-800  dark:bg-green-900/30  dark:text-green-400',
  red:    'bg-red-100    text-red-800    dark:bg-red-900/30    dark:text-red-400',
  yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  purple: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  gray:   'bg-gray-100   text-gray-800   dark:bg-gray-700      dark:text-gray-300',
}

function getSmartStatus(e: { reference_id?: string | null; description?: string | null; transaction_type?: string | null; service_type?: string | null; status?: string | null }): { label: string; color: string } {
  const ref  = String(e.reference_id    || '')
  const desc = String(e.description     || '')
  const type = String(e.transaction_type || '')
  const svc  = String(e.service_type    || '')
  const raw  = String(e.status          || '')
  if (ref.startsWith('CLAWBACK_'))            return { label: 'CORRECTED', color: 'purple' }
  if (ref.startsWith('REFUND_') || type === 'REFUND') return { label: 'REFUNDED', color: 'orange' }
  if (svc === 'pay2new' && type === 'DEBIT') {
    const s = derivePay2NewReportStatus({ rawStatus: raw, hasOrderId: hasPay2NewOrderStamp(desc) })
    if (s === 'success')  return { label: 'SUCCESS',  color: 'green'  }
    if (s === 'failed')   return { label: 'FAILED',   color: 'red'    }
    if (s === 'pending')  return { label: 'PENDING',  color: 'yellow' }
    if (s === 'refunded') return { label: 'REFUNDED', color: 'orange' }
  }
  if (raw === 'completed' || raw === '') return { label: 'SUCCESS', color: 'green'  }
  if (raw === 'failed')                  return { label: 'FAILED',  color: 'red'    }
  if (raw === 'pending')                 return { label: 'PENDING', color: 'yellow' }
  return { label: raw.toUpperCase(), color: 'gray' }
}

// ─── Service options ────────────────────────────────────────────────────────
const SERVICE_OPTIONS = [
  { value: 'all',               label: 'All Services' },
  { value: 'pos',               label: 'POS' },
  { value: 'bbps',              label: 'BBPS' },
  { value: 'pay2new',           label: 'Pay2New (BBPS-2)' },
  { value: 'rechargekit',       label: 'RechargeKit (CC-2)' },
  { value: 'aeps',              label: 'AEPS' },
  { value: 'payout',            label: 'Payout / Settlement' },
  { value: 'subscription',      label: 'Subscription' },
  { value: 'admin',             label: 'Admin adjustment' },
]

interface LedgerTabProps { user: any }

const PAGE_SIZE = 25

export default function LedgerTab({ user }: LedgerTabProps) {
  const [ledgerEntries, setLedgerEntries] = useState<any[]>([])
  const [loading, setLoading]     = useState(true)
  const [page, setPage]           = useState(1)
  const [total, setTotal]         = useState(0)
  const [totalPages, setTotalPages] = useState(1)

  const [dateFilter, setDateFilter] = useState({ start: '', end: '' })
  const [timeFilter, setTimeFilter] = useState({ start: '', end: '' })
  const [filterType, setFilterType] = useState<'all' | 'credit' | 'debit'>('all')
  const [filterService, setFilterService] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')

  // ── Fetch (server-side: date, time, service pushed to DB) ─────────────────
  const fetchLedgerData = useCallback(async () => {
    if (!user?.partner_id) return
    setLoading(true)
    try {
      let query = secureDb
        .from('wallet_ledger')
        .select('*', { count: 'exact' })
        .eq('retailer_id', user.partner_id)
        .eq('wallet_type', 'primary')
        .order('created_at', { ascending: false })

      if (dateFilter.start) {
        const t = timeFilter.start || '00:00'
        query = query.gte('created_at', `${dateFilter.start}T${t}:00+05:30`)
      }
      if (dateFilter.end) {
        const t = timeFilter.end || '23:59'
        query = query.lte('created_at', `${dateFilter.end}T${t}:59+05:30`)
      }
      if (filterService !== 'all') {
        query = query.eq('service_type', filterService)
      }

      const { data, count, error } = await query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
      if (error) throw error
      setLedgerEntries(data || [])
      setTotal(count || 0)
      setTotalPages(Math.ceil((count || 0) / PAGE_SIZE))
    } catch (error) {
      console.error('Error fetching ledger data:', error)
    } finally {
      setLoading(false)
    }
  }, [user?.partner_id, page, dateFilter, timeFilter, filterService])

  useEffect(() => { fetchLedgerData() }, [fetchLedgerData])

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1) }, [dateFilter, timeFilter, filterService, searchQuery, filterType])

  // ── Client-side: search + credit/debit filter on fetched page ─────────────
  const filteredEntries = useMemo(() => {
    let filtered = ledgerEntries
    if (filterType === 'credit') filtered = filtered.filter(e => e.credit > 0)
    else if (filterType === 'debit') filtered = filtered.filter(e => e.debit > 0)
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(e =>
        e.description?.toLowerCase().includes(q) ||
        e.reference_id?.toLowerCase().includes(q) ||
        e.transaction_id?.toLowerCase().includes(q) ||
        e.transaction_type?.toLowerCase().includes(q)
      )
    }
    return filtered
  }, [ledgerEntries, filterType, searchQuery])

  // Page-level credit/debit totals
  const totals = useMemo(() => {
    const credits = filteredEntries.reduce((s, e) => s + (e.credit || 0), 0)
    const debits  = filteredEntries.reduce((s, e) => s + (e.debit  || 0), 0)
    return { credits, debits, net: credits - debits }
  }, [filteredEntries])

  // ── Export ────────────────────────────────────────────────────────────────
  const [exportingFmt, setExportingFmt] = useState<ExportFormat | null>(null)

  const handleExport = async (fmt: ExportFormat) => {
    setExportingFmt(fmt)
    try {
      // Fetch ALL matching rows (no pagination) for export
      let q = secureDb
        .from('wallet_ledger')
        .select('*')
        .eq('retailer_id', user.partner_id)
        .eq('wallet_type', 'primary')
        .order('created_at', { ascending: false })
        .limit(50000)

      if (dateFilter.start) q = q.gte('created_at', `${dateFilter.start}T${timeFilter.start || '00:00'}:00+05:30`)
      if (dateFilter.end)   q = q.lte('created_at', `${dateFilter.end}T${timeFilter.end   || '23:59'}:59+05:30`)
      if (filterService !== 'all') q = q.eq('service_type', filterService)

      const { data } = await q
      const headers = ['Date & Time', 'Type', 'Service', 'Request ID', 'Card', 'Mobile', 'Bill Amount', 'Charge', 'Credit', 'Debit', 'Balance', 'Status']
      const rows = (data || []).map((e: any) => {
        const p  = parsePay2NewDesc(e.description)
        const st = getSmartStatus(e)
        return [
          new Date(e.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
          (e.transaction_type || '-').replace(/_/g, ' '),
          e.service_type || '-',
          e.reference_id || '-',
          p.card   || '-',
          p.mobile || '-',
          p.billAmt ? `₹${Number(p.billAmt).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-',
          p.charge  ? `₹${Number(p.charge).toLocaleString('en-IN',  { minimumFractionDigits: 2 })}` : '-',
          Number(e.credit) > 0 ? Number(e.credit).toFixed(2) : '',
          Number(e.debit)  > 0 ? Number(e.debit).toFixed(2)  : '',
          Number(e.balance_after || e.closing_balance || 0).toFixed(2),
          st.label,
        ]
      })
      const datePart = new Date().toISOString().split('T')[0]
      if (fmt === 'csv') {
        const esc = (v: string) => v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v
        const csv = [headers.join(','), ...rows.map(r => r.map(esc).join(','))].join('\n')
        downloadBlob(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }), `wallet-ledger-${datePart}.csv`)
      } else if (fmt === 'excel') {
        const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        const hdr = `<Row>${headers.map(h => `<Cell><Data ss:Type="String">${esc(h)}</Data></Cell>`).join('')}</Row>`
        const xr  = rows.map(r => `<Row>${r.map(c => `<Cell><Data ss:Type="String">${esc(c)}</Data></Cell>`).join('')}</Row>`).join('\n')
        const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Wallet Ledger"><Table>${hdr}${xr}</Table></Worksheet></Workbook>`
        downloadBlob(new Blob([xml], { type: 'application/vnd.ms-excel' }), `wallet-ledger-${datePart}.xls`)
      } else if (fmt === 'pdf') {
        const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Wallet Ledger</title><style>body{font-family:Arial,sans-serif;padding:20px;font-size:11px}table{width:100%;border-collapse:collapse;margin-top:15px}th{background:#059669;color:#fff;padding:6px;text-align:left;font-size:9px}td{padding:5px;border-bottom:1px solid #E5E7EB;font-size:9px}tr:nth-child(even){background:#F9FAFB}</style></head><body><h1>Wallet Ledger</h1><p style="color:#666;font-size:11px">Generated: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p><table><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`
        const w = window.open('', '_blank')
        if (w) { w.document.write(html); w.document.close(); w.print() }
      }
    } finally {
      setExportingFmt(null)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Credits (page)', value: `₹${totals.credits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, icon: ArrowDownCircle, color: 'text-green-600 dark:text-green-400' },
          { label: 'Total Debits (page)',  value: `₹${totals.debits.toLocaleString('en-IN',  { minimumFractionDigits: 2 })}`, icon: ArrowUpCircle,   color: 'text-red-600 dark:text-red-400' },
          { label: 'Net (page)',           value: `₹${Math.abs(totals.net).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, icon: totals.net >= 0 ? TrendingUp : TrendingDown, color: totals.net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400' },
          { label: 'Total Transactions',   value: total.toLocaleString('en-IN'), icon: Wallet, color: 'text-blue-600 dark:text-blue-400' },
        ].map(({ label, value, icon: Icon, color }) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border border-gray-200 dark:border-gray-700"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-600 dark:text-gray-400">{label}</p>
                <p className={`text-xl font-bold ${color}`}>{value}</p>
              </div>
              <Icon className={`w-7 h-7 ${color}`} />
            </div>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border border-gray-200 dark:border-gray-700">
        <div className="flex flex-col gap-3">
          {/* Row 1: search + type + service */}
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[200px] relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search by Request ID, card, description…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              />
            </div>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as any)}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            >
              <option value="all">All Types</option>
              <option value="credit">Credits Only</option>
              <option value="debit">Debits Only</option>
            </select>
            <select
              value={filterService}
              onChange={(e) => setFilterService(e.target.value)}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
            >
              {SERVICE_OPTIONS.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          {/* Row 2: date + time range */}
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">From Date</label>
              <input
                type="date"
                value={dateFilter.start}
                onChange={(e) => setDateFilter({ ...dateFilter, start: e.target.value })}
                className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">From Time (IST)</label>
              <input
                type="time"
                value={timeFilter.start}
                onChange={(e) => setTimeFilter({ ...timeFilter, start: e.target.value })}
                disabled={!dateFilter.start}
                className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white disabled:opacity-40"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">To Date</label>
              <input
                type="date"
                value={dateFilter.end}
                onChange={(e) => setDateFilter({ ...dateFilter, end: e.target.value })}
                className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">To Time (IST)</label>
              <input
                type="time"
                value={timeFilter.end}
                onChange={(e) => setTimeFilter({ ...timeFilter, end: e.target.value })}
                disabled={!dateFilter.end}
                className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white disabled:opacity-40"
              />
            </div>
            <div className="flex gap-2 items-end">
              <button
                onClick={fetchLedgerData}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 text-sm"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <ExportDropdown onExport={handleExport} exporting={exportingFmt} size="sm" />
              {(dateFilter.start || dateFilter.end || filterService !== 'all' || filterType !== 'all' || searchQuery) && (
                <button
                  onClick={() => { setDateFilter({ start: '', end: '' }); setTimeFilter({ start: '', end: '' }); setFilterService('all'); setFilterType('all'); setSearchQuery('') }}
                  className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-300 dark:border-gray-600 rounded-lg"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date & Time</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type / Service</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Transaction Details</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Bill / Charge</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Credit</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Debit</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Balance</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                    Loading ledger entries…
                  </td>
                </tr>
              ) : filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                    No ledger entries found
                  </td>
                </tr>
              ) : (
                filteredEntries.map((entry) => {
                  const p  = parsePay2NewDesc(entry.description)
                  const st = getSmartStatus(entry)
                  return (
                    <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                      {/* Date & Time */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-sm text-gray-900 dark:text-white">
                          {new Date(entry.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {new Date(entry.created_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </div>
                      </td>
                      {/* Type + Service */}
                      <td className="px-4 py-3">
                        <div className="text-xs font-medium text-gray-900 dark:text-white">
                          {(entry.transaction_type || '').replace(/_/g, ' ')}
                        </div>
                        {entry.service_type && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded">
                            {entry.service_type.toUpperCase()}
                          </span>
                        )}
                      </td>
                      {/* Transaction Details */}
                      <td className="px-4 py-3 max-w-[220px]">
                        <div className="font-mono text-xs text-blue-700 dark:text-blue-400 font-semibold truncate" title={entry.reference_id || ''}>
                          {entry.reference_id || '—'}
                        </div>
                        {(p.card || p.mobile) && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {p.card   && <span className="font-mono mr-2">{p.card}</span>}
                            {p.mobile && <span>{p.mobile}</span>}
                          </div>
                        )}
                        <div className="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5" title={cleanDescription(entry.description) || ''}>
                          {p.product || cleanDescription(entry.description) || ''}
                        </div>
                      </td>
                      {/* Bill / Charge */}
                      <td className="px-4 py-3 text-right">
                        {p.billAmt ? (
                          <>
                            <div className="text-sm font-semibold text-gray-900 dark:text-white">
                              ₹{Number(p.billAmt).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                            </div>
                            {p.charge && (
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                +₹{Number(p.charge).toLocaleString('en-IN', { minimumFractionDigits: 2 })} charge
                              </div>
                            )}
                          </>
                        ) : <span className="text-gray-400 text-sm">—</span>}
                      </td>
                      {/* Credit */}
                      <td className="px-4 py-3 text-right">
                        {entry.credit > 0 ? (
                          <span className="text-sm font-medium text-green-600 dark:text-green-400">
                            +₹{Number(entry.credit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                        ) : <span className="text-sm text-gray-400">—</span>}
                      </td>
                      {/* Debit */}
                      <td className="px-4 py-3 text-right">
                        {entry.debit > 0 ? (
                          <span className="text-sm font-medium text-red-600 dark:text-red-400">
                            −₹{Number(entry.debit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </span>
                        ) : <span className="text-sm text-gray-400">—</span>}
                      </td>
                      {/* Balance */}
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">
                          ₹{Number(entry.balance_after || entry.closing_balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      </td>
                      {/* Smart Status */}
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${BADGE_CLS[st.color] ?? BADGE_CLS.gray}`}>
                          {st.label}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString('en-IN')} transactions
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="px-3 py-1 text-sm text-gray-700 dark:text-gray-300">
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
