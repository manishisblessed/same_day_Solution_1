'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  Plus, RefreshCw, Loader2, FileText, Eye,
  CheckCircle, AlertCircle, Settings,
} from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import Link from 'next/link'

interface Invoice {
  id: string; invoice_number: string; period_start: string; period_end: string
  txn_count: number; total_transaction_value: number; bank_mdr_total: number
  margin_percent: number; service_charge_total: number; gst_amount: number
  total_with_gst: number; status: string; generated_at: string
  brands?: { id: string; name: string; short_name: string }
}

interface Brand { id: string; name: string; short_name: string }
interface Config { id: string; brand_id: string; margin_percent: number; gst_percent: number }

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  issued: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  filed: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  void: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
}

const INR = (n: number) =>
  '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function TransactionInvoicesPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [configs, setConfigs] = useState<Config[]>([])
  const [fetching, setFetching] = useState(true)
  const [brandFilter, setBrandFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  // Generate form
  const [showGenerate, setShowGenerate] = useState(false)
  const [genBrand, setGenBrand] = useState('')
  const [genYear, setGenYear] = useState(new Date().getFullYear())
  const [genMonth, setGenMonth] = useState(new Date().getMonth() + 1)
  const [genNotes, setGenNotes] = useState('')
  const [genLoading, setGenLoading] = useState(false)

  // Company config modal
  const [showConfig, setShowConfig] = useState(false)
  const [cfgBrand, setCfgBrand] = useState('')
  const [cfgMargin, setCfgMargin] = useState('20')
  const [cfgGst, setCfgGst] = useState('18')
  const [cfgGstin, setCfgGstin] = useState('')
  const [cfgLegal, setCfgLegal] = useState('')
  const [cfgSaving, setCfgSaving] = useState(false)

  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  useEffect(() => {
    if (!loading && user?.role !== 'ca_executive') router.push('/ca/login')
  }, [user, loading, router])

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const load = useCallback(async () => {
    setFetching(true)
    try {
      const p = new URLSearchParams()
      if (brandFilter) p.set('brand_id', brandFilter)
      if (statusFilter) p.set('status', statusFilter)
      const [invRes, brandRes, cfgRes] = await Promise.all([
        apiFetch(`/api/ca/transaction-invoices?${p}`),
        apiFetch('/api/ca/brands'),
        apiFetch('/api/ca/company-config'),
      ])
      const [invData, brandData, cfgData] = await Promise.all([invRes.json(), brandRes.json(), cfgRes.json()])
      setInvoices(invData.invoices || [])
      setBrands(brandData.brands || [])
      setConfigs(cfgData.configs || [])
    } catch { /* ignore */ }
    finally { setFetching(false) }
  }, [brandFilter, statusFilter])

  useEffect(() => {
    if (user?.role === 'ca_executive') load()
  }, [user, load])

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!genBrand) { showToast('Select a brand', 'error'); return }
    setGenLoading(true)
    try {
      const res = await apiFetch('/api/ca/transaction-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand_id: genBrand, year: genYear, month: genMonth, notes: genNotes, regenerate: true }),
      })
      const data = await res.json()
      if (!data.success) { showToast(data.error || 'Generation failed', 'error'); return }
      showToast('Invoice generated successfully')
      setShowGenerate(false)
      load()
    } catch {
      showToast('Generation failed', 'error')
    } finally {
      setGenLoading(false)
    }
  }

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cfgBrand) { showToast('Select a brand', 'error'); return }
    setCfgSaving(true)
    try {
      const res = await apiFetch('/api/ca/company-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand_id: cfgBrand, margin_percent: parseFloat(cfgMargin), gst_percent: parseFloat(cfgGst), gstin: cfgGstin, legal_name: cfgLegal }),
      })
      const data = await res.json()
      if (!data.success) { showToast(data.error || 'Save failed', 'error'); return }
      showToast('Company config saved')
      setShowConfig(false)
      load()
    } catch {
      showToast('Save failed', 'error')
    } finally {
      setCfgSaving(false)
    }
  }

  const openConfig = (brandId?: string) => {
    const existing = configs.find((c) => c.brand_id === (brandId || cfgBrand))
    setCfgBrand(brandId || '')
    setCfgMargin(String(existing?.margin_percent ?? 20))
    setCfgGst(String(existing?.gst_percent ?? 18))
    setCfgGstin('')
    setCfgLegal('')
    setShowConfig(true)
  }

  const handleStatusChange = async (id: string, status: string) => {
    try {
      const res = await apiFetch(`/api/ca/transaction-invoices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const data = await res.json()
      if (!data.success) { showToast(data.error || 'Update failed', 'error'); return }
      showToast(`Status updated to ${status}`)
      load()
    } catch {
      showToast('Update failed', 'error')
    }
  }

  if (loading || !user || user.role !== 'ca_executive') {
    return <div className="flex justify-center mt-16"><Loader2 className="w-8 h-8 animate-spin text-violet-600" /></div>
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-7xl space-y-6">
      {toast && (
        <div className={`fixed top-20 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium ${toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
          {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">GST Transaction Invoices</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">Monthly invoices for GSTR-1 output tax filing per brand.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => openConfig()} className="flex items-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
            <Settings className="w-4 h-4" /> Company Config
          </button>
          <button onClick={() => setShowGenerate(true)} className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg shadow-sm">
            <Plus className="w-4 h-4" /> Generate Invoice
          </button>
          <button onClick={load} disabled={fetching} className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40">
            <RefreshCw className={`w-4 h-4 text-gray-500 ${fetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none">
          <option value="">All brands</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none">
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="issued">Issued</option>
          <option value="filed">Filed</option>
          <option value="void">Void</option>
        </select>
      </div>

      {/* Table */}
      {fetching ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-violet-500" /></div>
      ) : invoices.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p>No transaction invoices yet.</p>
          <button onClick={() => setShowGenerate(true)} className="mt-3 text-sm text-violet-600 hover:underline">Generate your first invoice →</button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                {['Invoice No', 'Brand', 'Period', 'Txns', 'Txn Value', 'Bank MDR', 'Margin %', 'Service Charge', 'GST', 'Total w/ GST', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                  <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400">{inv.invoice_number}</td>
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{inv.brands?.short_name || '—'}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{inv.period_start} – {inv.period_end}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{inv.txn_count.toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{INR(inv.total_transaction_value)}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{INR(inv.bank_mdr_total)}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{Number(inv.margin_percent).toFixed(1)}%</td>
                  <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white">{INR(inv.service_charge_total)}</td>
                  <td className="px-4 py-3 font-semibold text-violet-700 dark:text-violet-300">{INR(inv.gst_amount)}</td>
                  <td className="px-4 py-3 font-bold text-gray-900 dark:text-white">{INR(inv.total_with_gst)}</td>
                  <td className="px-4 py-3">
                    <select
                      value={inv.status}
                      onChange={(e) => handleStatusChange(inv.id, e.target.value)}
                      className={`text-xs font-semibold rounded-full px-2 py-1 border-0 outline-none cursor-pointer ${STATUS_COLORS[inv.status] || 'bg-gray-100'}`}
                    >
                      <option value="draft">Draft</option>
                      <option value="issued">Issued</option>
                      <option value="filed">Filed</option>
                      <option value="void">Void</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/ca/billing/transaction-invoices/${inv.id}`}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-violet-600 inline-flex">
                      <Eye className="w-4 h-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Generate Modal */}
      {showGenerate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md border border-gray-200 dark:border-gray-700">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Generate Transaction Invoice</h2>
              <button onClick={() => setShowGenerate(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <form onSubmit={handleGenerate} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Brand (Company) *</label>
                <select required value={genBrand} onChange={(e) => setGenBrand(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none">
                  <option value="">Select brand...</option>
                  {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Year *</label>
                  <input type="number" required min="2020" max="2099" value={genYear}
                    onChange={(e) => setGenYear(parseInt(e.target.value, 10))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Month *</label>
                  <select required value={genMonth} onChange={(e) => setGenMonth(parseInt(e.target.value, 10))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none">
                    {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                  </select>
                </div>
              </div>

              {genBrand && (
                <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-lg p-3 text-xs text-violet-800 dark:text-violet-300">
                  {(() => {
                    const cfg = configs.find((c) => c.brand_id === genBrand)
                    if (!cfg) return <span>⚠ No company config found — using defaults (margin 20%, GST 18%). <button type="button" onClick={() => openConfig(genBrand)} className="underline">Configure now →</button></span>
                    return <span>✓ Margin: {cfg.margin_percent}% · GST: {cfg.gst_percent}%</span>
                  })()}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes (optional)</label>
                <input type="text" value={genNotes} onChange={(e) => setGenNotes(e.target.value)}
                  placeholder="e.g. October 2026 GSTR-1"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none" />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowGenerate(false)} className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">Cancel</button>
                <button type="submit" disabled={genLoading} className="flex-1 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg disabled:opacity-60 flex items-center justify-center gap-2">
                  {genLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {genLoading ? 'Generating...' : 'Generate'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Company Config Modal */}
      {showConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md border border-gray-200 dark:border-gray-700">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Company Config</h2>
              <button onClick={() => setShowConfig(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <form onSubmit={handleSaveConfig} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Brand *</label>
                <select required value={cfgBrand} onChange={(e) => {
                  setCfgBrand(e.target.value)
                  const existing = configs.find((c) => c.brand_id === e.target.value)
                  if (existing) { setCfgMargin(String(existing.margin_percent)); setCfgGst(String(existing.gst_percent)) }
                }}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none">
                  <option value="">Select brand...</option>
                  {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Margin % *</label>
                  <input type="number" required step="0.01" min="0" value={cfgMargin}
                    onChange={(e) => setCfgMargin(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none" />
                  <p className="text-xs text-gray-500 mt-1">Markup % on top of bank MDR</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">GST %</label>
                  <input type="number" step="0.01" min="0" value={cfgGst}
                    onChange={(e) => setCfgGst(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">GSTIN</label>
                <input type="text" value={cfgGstin} onChange={(e) => setCfgGstin(e.target.value)}
                  placeholder="e.g. 27AABCS1429B1ZB"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none font-mono" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Legal Name</label>
                <input type="text" value={cfgLegal} onChange={(e) => setCfgLegal(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowConfig(false)} className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300">Cancel</button>
                <button type="submit" disabled={cfgSaving} className="flex-1 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg disabled:opacity-60 flex items-center justify-center gap-2">
                  {cfgSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {cfgSaving ? 'Saving...' : 'Save Config'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </motion.div>
  )
}
