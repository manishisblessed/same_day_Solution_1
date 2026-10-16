'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter, useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  Search, RefreshCw, Download, ChevronLeft, ChevronRight,
  Loader2, AlertCircle, Receipt, Calendar, Wrench,
} from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { downloadBlob } from '@/components/ExportDropdown'

interface Invoice {
  id: string; invoice_number: string; transaction_date: string
  tid: string; transaction_amount: number; payment_mode: string | null
  card_type: string | null; card_brand: string | null
  bank_mdr_percent: number; bank_mdr_amount: number; status: string
  transaction_invoice_id: string | null
  ca_transaction_invoices?: { id: string; invoice_number: string } | null
  brands?: { name: string; short_name: string }
  partners?: { name: string }
}

interface Brand { id: string; name: string }

function ReimbursementPageInner() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [fetching, setFetching] = useState(true)
  const [brands, setBrands] = useState<Brand[]>([])

  // Filters
  const [brandFilter, setBrandFilter] = useState(searchParams.get('brand_id') || '')
  const [tidFilter, setTidFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statusFilter, setStatusFilter] = useState('issued')

  // Backfill
  const [showBackfill, setShowBackfill] = useState(false)
  const [bfDateFrom, setBfDateFrom] = useState('')
  const [bfDateTo, setBfDateTo] = useState('')
  const [bfLoading, setBfLoading] = useState(false)
  const [bfResult, setBfResult] = useState<string | null>(null)

  const [exporting, setExporting] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const LIMIT = 50

  useEffect(() => {
    if (!loading && user?.role !== 'ca_executive') router.push('/ca/login')
  }, [user, loading, router])

  const buildParams = useCallback(() => {
    const p = new URLSearchParams()
    p.set('limit', String(LIMIT))
    p.set('page', String(page))
    if (brandFilter) p.set('brand_id', brandFilter)
    if (tidFilter.trim()) p.set('tid', tidFilter.trim())
    if (dateFrom) p.set('date_from', dateFrom)
    if (dateTo) p.set('date_to', dateTo)
    if (statusFilter) p.set('status', statusFilter)
    return p
  }, [page, brandFilter, tidFilter, dateFrom, dateTo, statusFilter])

  const load = useCallback(async () => {
    setFetching(true)
    try {
      const res = await apiFetch(`/api/ca/reimbursement?${buildParams()}`)
      const data = await res.json()
      setInvoices(data.invoices || [])
      setTotal(data.total || 0)
      setTotalPages(data.total_pages || 1)
    } catch {
      // ignore
    } finally {
      setFetching(false)
    }
  }, [buildParams])

  useEffect(() => {
    if (user?.role === 'ca_executive') load()
  }, [user, load])

  useEffect(() => {
    const fetchBrands = async () => {
      try {
        const res = await apiFetch('/api/ca/brands')
        const data = await res.json()
        setBrands(data.brands || [])
      } catch { /* ignore */ }
    }
    if (user?.role === 'ca_executive') fetchBrands()
  }, [user])

  const handleDownloadZip = async () => {
    setExporting(true)
    try {
      const p = buildParams()
      p.set('format', 'zip')
      p.delete('page')
      p.delete('limit')
      const res = await apiFetch(`/api/ca/reimbursement?${p}`)
      if (!res.ok || res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json().catch(() => ({}))
        alert(data.error || 'Download failed')
        return
      }
      const blob = await res.blob()
      downloadBlob(blob, `reimbursement-invoices-${new Date().toISOString().split('T')[0]}.zip`)
    } catch {
      alert('Download failed')
    } finally {
      setExporting(false)
    }
  }

  const downloadInvoice = async (inv: Invoice) => {
    setDownloadingId(inv.id)
    try {
      const res = await apiFetch(`/api/ca/reimbursement/${inv.id}/invoice`)
      if (!res.ok || res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json().catch(() => ({}))
        alert(data.error || 'Could not generate invoice')
        return
      }
      const blob = await res.blob()
      const ext = res.headers.get('content-type')?.includes('pdf') ? 'pdf' : 'html'
      downloadBlob(blob, `${inv.invoice_number}.${ext}`)
    } catch {
      alert('Could not generate invoice')
    } finally {
      setDownloadingId(null)
    }
  }

  const handleBackfill = async () => {
    if (!bfDateFrom || !bfDateTo) { alert('Select date range'); return }
    setBfLoading(true)
    setBfResult(null)
    try {
      const res = await apiFetch('/api/ca/reimbursement/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date_from: bfDateFrom, date_to: bfDateTo }),
      })
      const data = await res.json()
      setBfResult(data.message || `Processed ${data.processed}, skipped ${data.skipped}`)
      if (data.success) load()
    } catch {
      setBfResult('Backfill failed')
    } finally {
      setBfLoading(false)
    }
  }

  const INR = (n: number) =>
    '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  if (loading || !user || user.role !== 'ca_executive') {
    return <div className="flex justify-center mt-16"><Loader2 className="w-8 h-8 animate-spin text-violet-600" /></div>
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Reimbursement Invoices</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
            Auto-generated per POS transaction. Internal CA records only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowBackfill(!showBackfill)} className="flex items-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
            <Wrench className="w-4 h-4" /> Backfill
          </button>
          <button
            onClick={handleDownloadZip}
            disabled={fetching || exporting}
            title="Download ZIP (CSV + PDF invoices) for the current filter"
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg disabled:opacity-60 shadow-sm"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {exporting ? 'Preparing ZIP...' : 'Download ZIP'}
          </button>
          <button onClick={load} disabled={fetching} className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40">
            <RefreshCw className={`w-4 h-4 text-gray-500 ${fetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Backfill panel */}
      {showBackfill && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 space-y-3">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-300">
            Backfill — generate reimbursement invoices for historical transactions missing them
          </p>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs text-amber-800 dark:text-amber-400 mb-1">Date from</label>
              <input type="date" value={bfDateFrom} onChange={(e) => setBfDateFrom(e.target.value)}
                className="px-3 py-1.5 text-sm border border-amber-300 dark:border-amber-700 rounded-lg bg-white dark:bg-gray-800 outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            <div>
              <label className="block text-xs text-amber-800 dark:text-amber-400 mb-1">Date to</label>
              <input type="date" value={bfDateTo} onChange={(e) => setBfDateTo(e.target.value)}
                className="px-3 py-1.5 text-sm border border-amber-300 dark:border-amber-700 rounded-lg bg-white dark:bg-gray-800 outline-none focus:ring-2 focus:ring-amber-500" />
            </div>
            <button onClick={handleBackfill} disabled={bfLoading}
              className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg disabled:opacity-60 flex items-center gap-2">
              {bfLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              {bfLoading ? 'Running...' : 'Run Backfill'}
            </button>
          </div>
          {bfResult && <p className="text-sm text-amber-800 dark:text-amber-300">{bfResult}</p>}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select value={brandFilter} onChange={(e) => { setBrandFilter(e.target.value); setPage(1) }}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none">
          <option value="">All brands</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input type="text" placeholder="TID filter" value={tidFilter}
          onChange={(e) => { setTidFilter(e.target.value); setPage(1) }}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none font-mono w-36" />
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-400" />
          <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none" />
          <span className="text-gray-400">—</span>
          <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none" />
        </div>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none">
          <option value="issued">Issued</option>
          <option value="void">Void</option>
          <option value="">All statuses</option>
        </select>
      </div>

      {/* Summary row */}
      <p className="text-sm text-gray-600 dark:text-gray-400">{total.toLocaleString('en-IN')} invoice(s) found</p>

      {/* Table */}
      {fetching ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-violet-500" /></div>
      ) : invoices.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <Receipt className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p>No invoices found for the selected filters.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                  {['Invoice No', 'Date', 'Brand', 'TID', 'Partner', 'Txn Amount', 'Mode', 'Card Type', 'Card Brand', 'Bank MDR %', 'Bank MDR ₹', 'GST Invoice', 'Status', 'Invoice'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                    <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400">{inv.invoice_number}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{inv.transaction_date}</td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{inv.brands?.short_name || '—'}</td>
                    <td className="px-4 py-3 font-mono text-gray-700 dark:text-gray-300">{inv.tid || <span className="text-gray-400">— QR —</span>}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{inv.partners?.name || '—'}</td>
                    <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white text-right">{INR(inv.transaction_amount)}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{inv.payment_mode || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{inv.card_type || '—'}</td>
                    <td className="px-4 py-3">
                      {(() => {
                        const cb = (inv.card_brand || '').toUpperCase()
                        if (!cb || cb === '*') return <span className="text-gray-400">—</span>
                        const styles: Record<string, string> = {
                          VISA:    'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
                          MASTER:  'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
                          AMEX:    'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300',
                          DINERS:  'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300',
                          RUPAY:   'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
                        }
                        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[cb] || 'bg-gray-100 text-gray-600'}`}>{cb}</span>
                      })()}
                    </td>
                    <td className="px-4 py-3 text-violet-700 dark:text-violet-300 font-medium">{Number(inv.bank_mdr_percent).toFixed(2)}%</td>
                    <td className="px-4 py-3 font-semibold text-red-600 dark:text-red-400 text-right">{INR(inv.bank_mdr_amount)}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {inv.ca_transaction_invoices?.invoice_number ? (
                        <a
                          href={`/ca/billing/transaction-invoices/${inv.transaction_invoice_id}`}
                          className="text-violet-600 dark:text-violet-300 hover:underline"
                          title="Open linked GST invoice"
                        >
                          {inv.ca_transaction_invoices.invoice_number}
                        </a>
                      ) : (
                        <span className="text-gray-400">— pending —</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${inv.status === 'issued' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => downloadInvoice(inv)}
                        disabled={downloadingId === inv.id}
                        title="Download Tax Invoice (PDF)"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/30 disabled:opacity-50"
                      >
                        {downloadingId === inv.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                        PDF
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(page - 1)}
                className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}
                className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </motion.div>
  )
}

export default function ReimbursementPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-violet-500" /></div>}>
      <ReimbursementPageInner />
    </Suspense>
  )
}
