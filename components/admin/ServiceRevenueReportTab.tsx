'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'
import { useToast } from '@/components/Toast'
import { RefreshCw, TrendingUp, Loader2, IndianRupee, ChevronLeft, ChevronRight } from 'lucide-react'

interface SummaryRow {
  service_type: string
  txns: number
  gross: number
  reversed: number
  net: number
}
interface Entry {
  id: string
  service_type: string
  transaction_id: string | null
  reference_id: string
  revenue: number
  description: string | null
  created_at: string
}

const SERVICE_LABELS: Record<string, string> = {
  bbps: 'BBPS',
  pay2new: 'Pay2New (CC Bill)',
  shadval_settlement: 'Settlement-2 (Account Transfer)',
}
const SERVICE_FILTERS = [
  { id: 'all', label: 'All Services' },
  { id: 'pay2new', label: 'Pay2New (BBPS)' },
  { id: 'bbps', label: 'BBPS' },
  { id: 'shadval_settlement', label: 'Settlement-2 (Account Transfer)' },
]

const inr = (n: number) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (s: string) => {
  const d = new Date(s)
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
const todayStr = () => new Date().toISOString().slice(0, 10)
const daysAgoStr = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)

export default function ServiceRevenueReportTab() {
  const { showToast } = useToast()
  const [service, setService] = useState('all')
  const [dateFrom, setDateFrom] = useState(daysAgoStr(30))
  const [dateTo, setDateTo] = useState(todayStr())
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const limit = 25

  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<Entry[]>([])
  const [summary, setSummary] = useState<SummaryRow[]>([])
  const [grand, setGrand] = useState<SummaryRow | null>(null)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const params = new URLSearchParams({
        service, date_from: dateFrom, date_to: dateTo, page: String(page), limit: String(limit),
      })
      if (q.trim()) params.set('q', q.trim())
      const res = await apiFetch(`/api/admin/reports/revenue?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load revenue')
      setEntries(data.entries || [])
      setSummary(data.summary || [])
      setGrand(data.grand || null)
      setTotal(data.total || 0)
      setTotalPages(data.totalPages || 1)
      if (data.message) setMessage(data.message)
    } catch (e: any) {
      showToast(e.message || 'Failed to load revenue', 'error')
    } finally {
      setLoading(false)
    }
  }, [service, dateFrom, dateTo, q, page, showToast])

  useEffect(() => { load() }, [load])

  // Reset to page 1 when filters change.
  useEffect(() => { setPage(1) }, [service, dateFrom, dateTo])

  const inputCls = 'text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2.5 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white'

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Per-Transaction Revenue</h2>
        </div>
        <button onClick={load} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        Company revenue booked per transaction = customer charge − ex-GST vendor cost, net of downline commissions.
        <strong> Net</strong> = revenue earned − reversals. Sourced from the platform revenue wallet.
      </p>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Service</label>
          <select className={inputCls} value={service} onChange={(e) => setService(e.target.value)}>
            {SERVICE_FILTERS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">From</label>
          <input type="date" className={inputCls} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">To</label>
          <input type="date" className={inputCls} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Search (reference / note)</label>
          <input className={`${inputCls} w-full`} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { setPage(1); load() } }} placeholder="P2N-REV-… / SHADVAL-REV-…" />
        </div>
      </div>

      {message && (
        <div className="mb-4 text-sm px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
          {message}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {grand && (
          <SummaryCard label="All Selected" sub="net revenue" row={grand} highlight />
        )}
        {summary.map((s) => (
          <SummaryCard key={s.service_type} label={SERVICE_LABELS[s.service_type] || s.service_type} sub={`${s.txns} txns`} row={s} />
        ))}
      </div>

      {/* Detail table */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-500"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-500 dark:text-gray-400">No revenue in this range.</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Service</th>
                  <th className="py-2 pr-3">Reference</th>
                  <th className="py-2 pr-3 text-right">Revenue</th>
                  <th className="py-2 pr-3">Breakdown</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-gray-100 dark:border-gray-700/50 align-top">
                    <td className="py-2 pr-3 whitespace-nowrap text-xs">{fmtDate(e.created_at)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">{SERVICE_LABELS[e.service_type] || e.service_type}</span>
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{e.reference_id}</td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap font-medium text-green-700 dark:text-green-400">{inr(e.revenue)}</td>
                    <td className="py-2 pr-3 text-xs text-gray-500 dark:text-gray-400 max-w-md">{e.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-4 text-sm text-gray-600 dark:text-gray-300">
            <span>{total.toLocaleString('en-IN')} transactions</span>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
              <span>Page {page} / {totalPages}</span>
              <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function SummaryCard({ label, sub, row, highlight }: { label: string; sub: string; row: SummaryRow; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50/50 dark:bg-indigo-900/20' : 'border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-700/30'}`}>
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1 truncate">{label}</div>
      <div className="flex items-center gap-1 text-xl font-semibold text-gray-900 dark:text-white">
        <IndianRupee className="w-4 h-4" />{Number(row.net || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
      <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
        {sub} · gross {inr(row.gross)}{row.reversed > 0 ? ` · −${inr(row.reversed)} rev` : ''}
      </div>
    </div>
  )
}
