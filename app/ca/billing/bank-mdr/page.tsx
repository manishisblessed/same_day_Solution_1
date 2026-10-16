'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  Plus, Pencil, Trash2, Loader2, AlertCircle,
  CheckCircle, Building2, Terminal, Calendar,
} from 'lucide-react'
import { apiFetch } from '@/lib/api-client'

interface Brand { id: string; key: string; name: string; short_name: string }
interface Config {
  id: string; brand_id: string; tid: string | null; payment_mode: string; card_type: string
  card_brand: string | null
  bank_mdr_percent: number; effective_from: string; effective_to: string | null
  notes: string | null; is_active: boolean
  brands?: { id: string; key: string; name: string; short_name: string }
}

const CARD_BRAND_OPTIONS = ['VISA', 'MASTER', 'AMEX', 'DINERS', 'RUPAY'] as const
type CardBrand = typeof CARD_BRAND_OPTIONS[number]

const EMPTY_FORM: {
  brand_id: string; tid: string; payment_mode: string; card_type: string
  card_brands: CardBrand[]
  bank_mdr_percent: string; effective_from: string; effective_to: string; notes: string
} = {
  brand_id: '', tid: '', payment_mode: '*', card_type: '*',
  card_brands: [],
  bank_mdr_percent: '', effective_from: new Date().toISOString().split('T')[0],
  effective_to: '', notes: '',
}

export default function BankMdrPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [configs, setConfigs] = useState<Config[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [fetching, setFetching] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [brandFilter, setBrandFilter] = useState('')

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
      const [cfgRes, bRes] = await Promise.all([
        apiFetch('/api/ca/bank-mdr'),
        apiFetch('/api/ca/brands'),
      ])
      const [cfgData, bData] = await Promise.all([cfgRes.json(), bRes.json()])
      setConfigs(cfgData.configs || [])
      setBrands(bData.brands || [])
    } catch {
      showToast('Failed to load data', 'error')
    } finally {
      setFetching(false)
    }
  }, [])

  useEffect(() => {
    if (user?.role === 'ca_executive') load()
  }, [user, load])

  const openCreate = () => {
    setEditingId(null)
    setForm({ ...EMPTY_FORM })
    setShowForm(true)
  }

  const openEdit = (c: Config) => {
    setEditingId(c.id)
    const existingBrand = (c.card_brand || '*').toUpperCase()
    setForm({
      brand_id: c.brand_id,
      tid: c.tid || '',
      payment_mode: c.payment_mode,
      card_type: c.card_type,
      card_brands: existingBrand === '*'
        ? []
        : (CARD_BRAND_OPTIONS as readonly string[]).includes(existingBrand)
          ? [existingBrand as CardBrand]
          : [],
      bank_mdr_percent: String(c.bank_mdr_percent),
      effective_from: c.effective_from,
      effective_to: c.effective_to || '',
      notes: c.notes || '',
    })
    setShowForm(true)
  }

  const toggleBrand = (b: CardBrand) => {
    setForm((f) => ({
      ...f,
      card_brands: f.card_brands.includes(b)
        ? f.card_brands.filter((x) => x !== b)
        : [...f.card_brands, b],
    }))
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      // When editing, backend expects a single card_brand; send the first
      // selected or '*'. When creating, send the full list — one row per brand.
      const brandsForPayload = form.card_brands.length === 0 ? ['*'] : form.card_brands
      const body = {
        ...form,
        card_brands: editingId ? [brandsForPayload[0]] : brandsForPayload,
        bank_mdr_percent: parseFloat(form.bank_mdr_percent),
        tid: form.tid.trim() || null,
        effective_to: form.effective_to.trim() || null,
        notes: form.notes.trim() || null,
        ...(editingId ? { id: editingId } : {}),
      }
      const res = await apiFetch(`/api/ca/bank-mdr`, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!data.success) { showToast(data.error || 'Save failed', 'error'); return }
      const createdMsg = data.created > 1
        ? `Created ${data.created} rates (one per card brand)`
        : (editingId ? 'Updated successfully' : 'Created successfully')
      const repricedMsg = data.repriced > 0 ? ` · repriced ${data.repriced} reimbursement(s)` : ''
      showToast(createdMsg + repricedMsg)
      setShowForm(false)
      load()
    } catch {
      showToast('Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    setDeleteId(id)
    try {
      const res = await apiFetch(`/api/ca/bank-mdr?id=${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!data.success) { showToast(data.error || 'Delete failed', 'error'); return }
      showToast('Deactivated successfully')
      load()
    } catch {
      showToast('Delete failed', 'error')
    } finally {
      setDeleteId(null)
    }
  }

  const filtered = brandFilter
    ? configs.filter((c) => c.brand_id === brandFilter)
    : configs

  if (loading || !user || user.role !== 'ca_executive') {
    return <div className="flex justify-center mt-16"><Loader2 className="w-8 h-8 animate-spin text-violet-600" /></div>
  }

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-6xl space-y-6">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-20 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium transition-all ${toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
          {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Bank MDR Rates</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
            Configure what the bank charges per TID, brand, payment mode, and card type.
          </p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> Add Rate
        </button>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <label className="text-sm text-gray-600 dark:text-gray-400">Filter by brand:</label>
        <select
          value={brandFilter}
          onChange={(e) => setBrandFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-violet-500 outline-none"
        >
          <option value="">All brands</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {/* Table */}
      {fetching ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-violet-500" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <Terminal className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p>No MDR rates configured yet.</p>
          <button onClick={openCreate} className="mt-3 text-sm text-violet-600 hover:underline">Add your first rate →</button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                {['Brand', 'TID', 'Mode', 'Card Type', 'Card Brand', 'Bank MDR %', 'Effective From', 'Effective To', 'Notes', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/30">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                    <span className="flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-violet-400" />
                      {c.brands?.short_name || c.brands?.name || c.brand_id.slice(0, 8)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300 font-mono">{c.tid || <span className="text-gray-400 italic">All (brand)</span>}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.payment_mode === '*' ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'}`}>{c.payment_mode}</span></td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${c.card_type === '*' ? 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400' : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'}`}>{c.card_type}</span></td>
                  <td className="px-4 py-3">
                    {(() => {
                      const cb = (c.card_brand || '*').toUpperCase()
                      const styles: Record<string, string> = {
                        '*':     'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
                        VISA:    'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
                        MASTER:  'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
                        AMEX:    'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300',
                        DINERS:  'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300',
                        RUPAY:   'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
                      }
                      return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[cb] || styles['*']}`}>{cb}</span>
                    })()}
                  </td>
                  <td className="px-4 py-3 font-semibold text-violet-700 dark:text-violet-300">{Number(c.bank_mdr_percent).toFixed(4)}%</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{c.effective_from}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{c.effective_to || <span className="text-gray-400">—</span>}</td>
                  <td className="px-4 py-3 text-gray-500 max-w-[160px] truncate">{c.notes || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(c)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-violet-600">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => { if (confirm('Deactivate this rate?')) handleDelete(c.id) }}
                        disabled={deleteId === c.id}
                        className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-500 hover:text-red-600 disabled:opacity-40"
                      >
                        {deleteId === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-gray-700"
          >
            <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                {editingId ? 'Edit Bank MDR Rate' : 'Add Bank MDR Rate'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Brand (Company) *</label>
                  <select required value={form.brand_id} onChange={(e) => setForm({ ...form, brand_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none">
                    <option value="">Select brand...</option>
                    {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">TID (Terminal ID)</label>
                  <input type="text" value={form.tid} onChange={(e) => setForm({ ...form, tid: e.target.value })}
                    placeholder="Leave blank = all TIDs"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none font-mono" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bank MDR % *</label>
                  <input type="number" required step="0.0001" min="0" max="100"
                    value={form.bank_mdr_percent} onChange={(e) => setForm({ ...form, bank_mdr_percent: e.target.value })}
                    placeholder="e.g. 1.8000"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Payment Mode</label>
                  <select value={form.payment_mode} onChange={(e) => setForm({ ...form, payment_mode: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none">
                    <option value="*">* (Any)</option>
                    <option value="CARD">CARD</option>
                    <option value="UPI">UPI</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Card Type</label>
                  <select value={form.card_type} onChange={(e) => setForm({ ...form, card_type: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none">
                    <option value="*">* (Any)</option>
                    <option value="CREDIT">CREDIT</option>
                    <option value="DEBIT">DEBIT</option>
                    <option value="PREPAID">PREPAID</option>
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Card Brand {editingId ? '' : <span className="text-xs text-gray-500 font-normal">— select multiple to create one rate per brand</span>}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {CARD_BRAND_OPTIONS.map((b) => {
                      const active = form.card_brands.includes(b)
                      return (
                        <button
                          key={b}
                          type="button"
                          onClick={() => {
                            if (editingId) {
                              // single-select behaviour when editing
                              setForm({ ...form, card_brands: active ? [] : [b] })
                            } else {
                              toggleBrand(b)
                            }
                          }}
                          className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                            active
                              ? 'bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white border-transparent shadow-sm'
                              : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-violet-400'
                          }`}
                        >
                          {b}
                        </button>
                      )
                    })}
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, card_brands: [] })}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                        form.card_brands.length === 0
                          ? 'bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900 border-transparent'
                          : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-500 hover:border-gray-400'
                      }`}
                    >
                      * Any
                    </button>
                  </div>
                  {!editingId && form.card_brands.length > 1 && (
                    <p className="mt-1.5 text-xs text-violet-600 dark:text-violet-400">
                      ✦ Will create {form.card_brands.length} rows (one per selected brand)
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    <Calendar className="inline w-3.5 h-3.5 mr-1" />Effective From *
                  </label>
                  <input type="date" required value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Effective To (optional)</label>
                  <input type="date" value={form.effective_to} onChange={(e) => setForm({ ...form, effective_to: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none" />
                </div>

                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes (optional)</label>
                  <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder="Any notes about this rate"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none" />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg disabled:opacity-60 transition-colors flex items-center justify-center gap-2">
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {saving ? 'Saving...' : editingId ? 'Update Rate' : 'Create Rate'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </motion.div>
  )
}
