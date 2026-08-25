'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import ExportDropdown, { type ExportFormat, downloadBlob, getExportExtension } from '@/components/ExportDropdown'
import { Loader2, Search, RefreshCw } from 'lucide-react'

interface ReconRow {
  date: string | null
  amount: number
  mdr_rate: number | null
  charges: number | null
  net_pay: number | null
  currency: string
  payment_mode: string
  consumer_name: string
  company_name: string
  holder_name: string
  tid: string
  mid: string
  card_number: string
  card_brand: string
  card_type: string
  rrn: string
  auth_code: string
  device_serial: string
}

interface Summary {
  total_transactions: number
  total_amount: number
  total_charges: number
  total_net: number
  unpriced: number
}

const COMPANY_OPTIONS = [
  { value: 'all', label: 'All companies' },
  { value: 'ashvam', label: 'Ashvam' },
  { value: 'teachway', label: 'Teachway' },
  { value: 'newscenaric', label: 'New Scenaric' },
  { value: 'lagoon', label: 'Lagoon' },
  { value: 'avika', label: 'Avika' },
]
const BRAND_OPTIONS = ['all', 'VISA', 'MASTER_CARD', 'RUPAY', 'AMEX', 'MAESTRO']
const MODE_OPTIONS = ['all', 'CARD', 'UPI']
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active (excl. failed)' },
  { value: 'CAPTURED', label: 'Captured only' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'FAILED', label: 'Failed' },
]

const PAGE_SIZE = 50

function inr(n: number | null | undefined): string {
  if (n == null) return '—'
  return `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })
  } catch { return '—' }
}

export default function PosReconciliationReport() {
  const today = new Date().toISOString().split('T')[0]
  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)
  const [company, setCompany] = useState('all')
  const [brand, setBrand] = useState('all')
  const [mode, setMode] = useState('all')
  const [status, setStatus] = useState('active')
  const [search, setSearch] = useState('')

  const [rows, setRows] = useState<ReconRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState<ExportFormat | null>(null)

  const buildParams = useCallback((extra?: Record<string, string>) => {
    const p = new URLSearchParams()
    if (dateFrom) p.set('date_from', dateFrom)
    if (dateTo) p.set('date_to', dateTo)
    if (company !== 'all') p.set('merchant_slug', company)
    if (brand !== 'all') p.set('card_brand', brand)
    if (mode !== 'all') p.set('payment_mode', mode)
    if (status && status !== 'active') p.set('status', status)
    if (search.trim()) p.set('search', search.trim())
    for (const [k, v] of Object.entries(extra || {})) p.set(k, v)
    return p
  }, [dateFrom, dateTo, company, brand, mode, status, search])

  const fetchData = useCallback(async (pageArg: number) => {
    setLoading(true)
    setError(null)
    try {
      const params = buildParams({ limit: String(PAGE_SIZE), offset: String((pageArg - 1) * PAGE_SIZE) })
      const res = await apiFetch(`/api/finance/pos-reconciliation?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load reconciliation')
      setRows(data.data || [])
      setSummary(data.summary || null)
      setTotal(data.pagination?.total || 0)
      setPage(pageArg)
    } catch (e: any) {
      setError(e.message || 'Failed to load reconciliation')
      setRows([])
      setSummary(null)
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [buildParams])

  useEffect(() => {
    fetchData(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleExport = async (format: ExportFormat) => {
    setExporting(format)
    try {
      const params = buildParams({ format })
      const res = await apiFetch(`/api/finance/pos-reconciliation?${params.toString()}`)
      if (!res.ok) throw new Error('Export failed')
      const contentType = res.headers.get('content-type') || ''
      const ext = getExportExtension(format, contentType)
      const blob = await res.blob()
      downloadBlob(blob, `pos_reconciliation_${Date.now()}.${ext}`)
    } catch (e: any) {
      alert(e.message || 'Export failed')
    } finally {
      setExporting(null)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Company</label>
            <select value={company} onChange={(e) => setCompany(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
              {COMPANY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Card brand</label>
            <select value={brand} onChange={(e) => setBrand(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
              {BRAND_OPTIONS.map((b) => <option key={b} value={b}>{b === 'all' ? 'All brands' : b}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Payment mode</label>
            <select value={mode} onChange={(e) => setMode(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
              {MODE_OPTIONS.map((m) => <option key={m} value={m}>{m === 'all' ? 'All modes' : m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
              {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div className="lg:col-span-2">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Search (TID / MID / RRN / consumer / card)</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') fetchData(1) }}
                placeholder="Type and press Enter…"
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between mt-3">
          <button onClick={() => fetchData(1)} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Apply
          </button>
          <ExportDropdown onExport={handleExport} exporting={exporting} disabled={loading || total === 0} />
        </div>
      </div>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard label="Transactions" value={summary.total_transactions.toLocaleString('en-IN')} />
          <SummaryCard label="Gross Amount" value={inr(summary.total_amount)} />
          <SummaryCard label="Charges (MDR)" value={inr(summary.total_charges)} accent="text-amber-600 dark:text-amber-400" />
          <SummaryCard label="Net Pay" value={inr(summary.total_net)} accent="text-emerald-600 dark:text-emerald-400" />
        </div>
      )}
      {summary && summary.unpriced > 0 && (
        <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          {summary.unpriced} transaction(s) have no scheme rate resolved and are shown with “—” for MDR/Charges/Net Pay.
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-600 dark:text-gray-300">
              <tr>
                {['Date & Time','Amount','MDR %','Charges','Net Pay','Curr','Mode','Consumer','Company','Partner/Retailer','TID','MID','Card Number','Brand','Type','RRN','Auth','Device'].map((h) => (
                  <th key={h} className="text-left font-semibold px-3 py-2">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700 text-gray-800 dark:text-gray-200">
              {loading ? (
                <tr><td colSpan={18} className="px-3 py-10 text-center text-gray-500"><Loader2 className="w-6 h-6 animate-spin inline" /></td></tr>
              ) : error ? (
                <tr><td colSpan={18} className="px-3 py-10 text-center text-red-600">{error}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={18} className="px-3 py-10 text-center text-gray-500">No transactions for the selected filters.</td></tr>
              ) : rows.map((r, i) => (
                <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-900/40">
                  <td className="px-3 py-2">{fmtDate(r.date)}</td>
                  <td className="px-3 py-2 text-right font-medium">{inr(r.amount)}</td>
                  <td className="px-3 py-2 text-right">{r.mdr_rate != null ? `${r.mdr_rate}%` : '—'}</td>
                  <td className="px-3 py-2 text-right text-amber-600 dark:text-amber-400">{inr(r.charges)}</td>
                  <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-400 font-medium">{inr(r.net_pay)}</td>
                  <td className="px-3 py-2">{r.currency}</td>
                  <td className="px-3 py-2">{r.payment_mode}</td>
                  <td className="px-3 py-2">{r.consumer_name || '—'}</td>
                  <td className="px-3 py-2 max-w-[180px] truncate" title={r.company_name}>{r.company_name || '—'}</td>
                  <td className="px-3 py-2 max-w-[180px] truncate" title={r.holder_name}>{r.holder_name || '—'}</td>
                  <td className="px-3 py-2">{r.tid || '—'}</td>
                  <td className="px-3 py-2">{r.mid || '—'}</td>
                  <td className="px-3 py-2 font-mono">{r.card_number || '—'}</td>
                  <td className="px-3 py-2">{r.card_brand || '—'}</td>
                  <td className="px-3 py-2">{r.card_type || '—'}</td>
                  <td className="px-3 py-2">{r.rrn || '—'}</td>
                  <td className="px-3 py-2">{r.auth_code || '—'}</td>
                  <td className="px-3 py-2">{r.device_serial || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700 text-sm">
            <span className="text-gray-500 dark:text-gray-400">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString('en-IN')}
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => fetchData(page - 1)} disabled={page <= 1 || loading}
                className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-40">Prev</button>
              <span className="text-gray-600 dark:text-gray-300">Page {page} / {totalPages}</span>
              <button onClick={() => fetchData(page + 1)} disabled={page >= totalPages || loading}
                className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-bold mt-1 ${accent || 'text-gray-900 dark:text-white'}`}>{value}</div>
    </div>
  )
}
