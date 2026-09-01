'use client'

import React, { useState, useEffect, Suspense } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import AdminSidebar from '@/components/AdminSidebar'
import { Loader2, RefreshCw, Search, Plus, X, FileText, ChevronLeft, ChevronRight, Eye } from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { motion, AnimatePresence } from 'framer-motion'

interface Invoice {
  id: string
  invoice_number: string
  partner_id: string
  partner_name: string | null
  partner_business_name: string | null
  period_start: string
  period_end: string
  transaction_value: number
  txn_count: number
  service_charge: number
  net_payable: number
  amount_settled: number
  balance_due: number
  status: string
  created_at: string
}

interface PartnerOption {
  id: string
  name: string
  business_name: string
  status: string
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  issued: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  partially_settled: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  settled: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  void: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const money = (n: number | string) =>
  `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

const statusLabel = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export default function PartnerInvoicesPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary-600" /></div>}>
      <PartnerInvoicesContent />
    </Suspense>
  )
}

function PartnerInvoicesContent() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [stats, setStats] = useState({ net: 0, settled: 0, due: 0 })
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [showGenerate, setShowGenerate] = useState(false)

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'admin')) router.push('/admin/login')
  }, [user, authLoading, router])

  const fetchInvoices = async () => {
    if (!user || user.role !== 'admin') return
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      if (search) params.set('search', search)
      if (statusFilter) params.set('status', statusFilter)
      const res = await apiFetch(`/api/admin/partner-invoices?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load')
      setInvoices(json.data || [])
      setStats(json.stats || { net: 0, settled: 0, due: 0 })
      setTotalPages(json.pagination?.total_pages || 1)
      setTotal(json.pagination?.total || 0)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user && user.role === 'admin') fetchInvoices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, page, statusFilter])

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1)
      if (user && user.role === 'admin') fetchInvoices()
    }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="lg:pl-56 flex items-center justify-center min-h-screen">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="lg:pl-56">
        <div className="p-6 space-y-5">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <FileText className="w-6 h-6 text-primary-600" /> Partner Invoices
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                POS business statement · MDR service charge · settlement tracking
              </p>
            </div>
            <button
              onClick={() => setShowGenerate(true)}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
            >
              <Plus className="w-4 h-4" /> Generate Invoice
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 border border-blue-100 dark:border-blue-800">
              <p className="text-xs text-blue-600 dark:text-blue-400">Invoices</p>
              <p className="text-xl font-bold text-blue-900 dark:text-blue-100 mt-0.5">{total}</p>
            </div>
            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3 border border-purple-100 dark:border-purple-800">
              <p className="text-xs text-purple-600 dark:text-purple-400">Net Payable</p>
              <p className="text-xl font-bold text-purple-900 dark:text-purple-100 mt-0.5">{money(stats.net)}</p>
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 border border-green-100 dark:border-green-800">
              <p className="text-xs text-green-600 dark:text-green-400">Settled</p>
              <p className="text-xl font-bold text-green-900 dark:text-green-100 mt-0.5">{money(stats.settled)}</p>
            </div>
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 border border-amber-100 dark:border-amber-800">
              <p className="text-xs text-amber-600 dark:text-amber-400">Balance Due</p>
              <p className="text-xl font-bold text-amber-900 dark:text-amber-100 mt-0.5">{money(stats.due)}</p>
            </div>
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search invoice number..."
                className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            >
              <option value="">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="issued">Issued</option>
              <option value="partially_settled">Partially Settled</option>
              <option value="settled">Settled</option>
              <option value="void">Void</option>
            </select>
            <button
              onClick={fetchInvoices}
              disabled={loading}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>

          {/* Table */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                    <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Invoice</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Partner</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Period</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Txns</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Business</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase">MDR</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Net Payable</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Due</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Status</th>
                    <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {loading ? (
                    <tr><td colSpan={10} className="py-16 text-center"><Loader2 className="w-6 h-6 animate-spin text-primary-600 mx-auto" /></td></tr>
                  ) : invoices.length === 0 ? (
                    <tr><td colSpan={10} className="py-16 text-center text-gray-500 dark:text-gray-400">No invoices yet. Click "Generate Invoice" to create one.</td></tr>
                  ) : (
                    invoices.map((inv) => (
                      <tr
                        key={inv.id}
                        onClick={() => router.push(`/admin/partner-invoices/${inv.id}`)}
                        className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                      >
                        <td className="px-3 py-3 font-mono font-medium text-gray-900 dark:text-white whitespace-nowrap">{inv.invoice_number}</td>
                        <td className="px-3 py-3 max-w-[200px]">
                          <div className="font-medium text-gray-900 dark:text-white truncate">{inv.partner_name || '—'}</div>
                          <div className="text-xs text-gray-500 truncate">{inv.partner_business_name || ''}</div>
                        </td>
                        <td className="px-3 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap text-xs">
                          {fmtDate(inv.period_start)} – {fmtDate(inv.period_end)}
                        </td>
                        <td className="px-3 py-3 text-right text-gray-700 dark:text-gray-300">{inv.txn_count}</td>
                        <td className="px-3 py-3 text-right text-gray-900 dark:text-white whitespace-nowrap">{money(inv.transaction_value)}</td>
                        <td className="px-3 py-3 text-right text-gray-600 dark:text-gray-400 whitespace-nowrap">{money(inv.service_charge)}</td>
                        <td className="px-3 py-3 text-right font-semibold text-gray-900 dark:text-white whitespace-nowrap">{money(inv.net_payable)}</td>
                        <td className={`px-3 py-3 text-right font-semibold whitespace-nowrap ${Number(inv.balance_due) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
                          {money(inv.balance_due)}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[inv.status] || STATUS_STYLES.draft}`}>
                            {statusLabel(inv.status)}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <Eye className="w-4 h-4 text-gray-400 mx-auto" />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="bg-gray-50 dark:bg-gray-900 px-4 py-3 flex items-center justify-between border-t border-gray-200 dark:border-gray-700">
                <span className="text-sm text-gray-500">Page {page} / {totalPages}</span>
                <div className="flex gap-2">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1 || loading}
                    className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages || loading}
                    className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showGenerate && (
          <GenerateInvoiceModal
            onClose={() => setShowGenerate(false)}
            onCreated={(id) => { setShowGenerate(false); router.push(`/admin/partner-invoices/${id}`) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Generate Invoice Modal ──────────────────────────────────────────────────
function GenerateInvoiceModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [partners, setPartners] = useState<PartnerOption[]>([])
  const [partnerId, setPartnerId] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [preview, setPreview] = useState<any | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    // Default to last completed month
    const now = new Date()
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const last = new Date(now.getFullYear(), now.getMonth(), 0)
    setPeriodStart(first.toISOString().split('T')[0])
    setPeriodEnd(last.toISOString().split('T')[0])
    ;(async () => {
      try {
        const res = await apiFetch('/api/admin/partner-invoices/partners')
        const json = await res.json()
        if (res.ok) setPartners(json.data || [])
      } catch (e) { console.error(e) }
    })()
  }, [])

  const runPreview = async () => {
    setError('')
    if (!partnerId || !periodStart || !periodEnd) { setError('Select partner and period'); return }
    setLoadingPreview(true)
    setPreview(null)
    try {
      const res = await apiFetch('/api/admin/partner-invoices', {
        method: 'POST',
        body: JSON.stringify({ partner_id: partnerId, period_start: periodStart, period_end: periodEnd, preview: true }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Preview failed')
      setPreview(json.data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoadingPreview(false)
    }
  }

  const create = async () => {
    setError('')
    setCreating(true)
    try {
      const res = await apiFetch('/api/admin/partner-invoices', {
        method: 'POST',
        body: JSON.stringify({ partner_id: partnerId, period_start: periodStart, period_end: periodEnd }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to generate')
      onCreated(json.data.id)
    } catch (e: any) {
      setError(e.message)
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Generate Partner Invoice</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><X className="w-5 h-5 text-gray-500" /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Partner</label>
            <select value={partnerId} onChange={(e) => { setPartnerId(e.target.value); setPreview(null) }}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
              <option value="">Select partner...</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.business_name ? ` — ${p.business_name}` : ''}{p.status !== 'active' ? ` (${p.status})` : ''}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Period Start</label>
              <input type="date" value={periodStart} onChange={(e) => { setPeriodStart(e.target.value); setPreview(null) }}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Period End</label>
              <input type="date" value={periodEnd} onChange={(e) => { setPeriodEnd(e.target.value); setPreview(null) }}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
            </div>
          </div>

          <button onClick={runPreview} disabled={loadingPreview || !partnerId}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50">
            {loadingPreview ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />} Preview
          </button>

          {preview && (
            <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 border border-gray-200 dark:border-gray-700 space-y-3">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-xs text-gray-500">Business</p>
                  <p className="text-sm font-bold text-gray-900 dark:text-white">{money(preview.transaction_value)}</p>
                  <p className="text-[10px] text-gray-400">{preview.txn_count} txns</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">MDR</p>
                  <p className="text-sm font-bold text-gray-900 dark:text-white">{money(preview.service_charge)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Net Payable</p>
                  <p className="text-sm font-bold text-primary-600 dark:text-primary-400">{money(preview.net_payable)}</p>
                </div>
              </div>
              {preview.breakdown?.length > 0 && (
                <div className="max-h-40 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="text-gray-500">
                      <tr>
                        <th className="text-left py-1">Mode / Card</th>
                        <th className="text-right py-1">Txns</th>
                        <th className="text-right py-1">Gross</th>
                        <th className="text-right py-1">MDR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.breakdown.map((b: any, i: number) => (
                        <tr key={i} className="border-t border-gray-200 dark:border-gray-700">
                          <td className="py-1 text-gray-700 dark:text-gray-300">{b.payment_mode} · {b.card_type} · {b.card_brand}</td>
                          <td className="py-1 text-right">{b.txn_count}</td>
                          <td className="py-1 text-right">{money(b.gross)}</td>
                          <td className="py-1 text-right">{money(b.mdr)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
          <button onClick={create} disabled={creating || !partnerId}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Generate Invoice
          </button>
        </div>
      </motion.div>
    </div>
  )
}
