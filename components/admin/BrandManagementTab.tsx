'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'
import { useToast } from '@/components/Toast'
import { RefreshCw, Plus, Trash2, Pencil, Building2, Loader2, X, ChevronLeft, Percent } from 'lucide-react'

interface Brand {
  id: string
  key: string
  name: string
  short_name: string | null
  description: string | null
  active: boolean
  settlement_mode: 'INSTANT' | 'T1' | 'BOTH'
  t1_cutoff_hour: number | null
  rates: number
  machines: number
}

interface BrandRate {
  id: string
  brand_id: string
  provider: string
  mode: string
  card_type: string | null
  brand_type: string | null
  card_classification: string | null
  min_amount: number
  max_amount: number
  mdr_value: number
  mdr_value_t0: number
  min_mdr_value: number
  min_mdr_value_t0: number
  gst_inclusive: boolean
  active: boolean
}

const SETTLEMENT_MODES = ['INSTANT', 'T1', 'BOTH'] as const
const MODES = ['*', 'CARD', 'UPI'] as const
const CARD_TYPES = ['', 'CREDIT', 'DEBIT', 'PREPAID'] as const

const emptyBrand = { key: '', name: '', short_name: '', description: '', settlement_mode: 'T1' as const, t1_cutoff_hour: '' }
const emptyRate = {
  provider: '*', mode: '*', card_type: '', brand_type: '', card_classification: '',
  min_amount: 0, max_amount: 999999999,
  mdr_value: 0, mdr_value_t0: 0, min_mdr_value: 0, min_mdr_value_t0: 0, gst_inclusive: false,
}

const pctFmt = (n: number) => `${Number(n).toFixed(2)}%`

export default function BrandManagementTab() {
  const { showToast } = useToast()
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [showBrandForm, setShowBrandForm] = useState(false)
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null)
  const [brandForm, setBrandForm] = useState<any>(emptyBrand)
  const [saving, setSaving] = useState(false)

  // Rate-card drill-in
  const [selected, setSelected] = useState<Brand | null>(null)
  const [rates, setRates] = useState<BrandRate[]>([])
  const [ratesLoading, setRatesLoading] = useState(false)
  const [showRateForm, setShowRateForm] = useState(false)
  const [editingRate, setEditingRate] = useState<BrandRate | null>(null)
  const [rateForm, setRateForm] = useState<any>(emptyRate)

  const loadBrands = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/admin/brands')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load brands')
      setBrands(data.brands || [])
    } catch (e: any) {
      showToast(e.message || 'Failed to load brands', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { loadBrands() }, [loadBrands])

  const loadRates = useCallback(async (brand: Brand) => {
    setRatesLoading(true)
    try {
      const res = await apiFetch(`/api/admin/brands/${brand.id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load rate card')
      setRates(data.rates || [])
    } catch (e: any) {
      showToast(e.message || 'Failed to load rate card', 'error')
    } finally {
      setRatesLoading(false)
    }
  }, [showToast])

  function openCreateBrand() {
    setEditingBrand(null)
    setBrandForm(emptyBrand)
    setShowBrandForm(true)
  }
  function openEditBrand(b: Brand) {
    setEditingBrand(b)
    setBrandForm({
      key: b.key, name: b.name, short_name: b.short_name || '', description: b.description || '',
      settlement_mode: b.settlement_mode, t1_cutoff_hour: b.t1_cutoff_hour ?? '',
    })
    setShowBrandForm(true)
  }

  async function saveBrand() {
    setSaving(true)
    try {
      const res = editingBrand
        ? await apiFetch(`/api/admin/brands/${editingBrand.id}`, { method: 'PATCH', body: JSON.stringify(brandForm) })
        : await apiFetch('/api/admin/brands', { method: 'POST', body: JSON.stringify(brandForm) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save brand')
      showToast(editingBrand ? 'Brand updated' : 'Brand created', 'success')
      setShowBrandForm(false)
      loadBrands()
    } catch (e: any) {
      showToast(e.message || 'Failed to save brand', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function toggleBrandActive(b: Brand) {
    try {
      const res = await apiFetch(`/api/admin/brands/${b.id}`, { method: 'PATCH', body: JSON.stringify({ active: !b.active }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      loadBrands()
    } catch (e: any) {
      showToast(e.message || 'Failed to update', 'error')
    }
  }

  async function deleteBrand(b: Brand) {
    if (!window.confirm(`Delete brand "${b.name}" and its rate card? This cannot be undone.`)) return
    try {
      const res = await apiFetch(`/api/admin/brands/${b.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete')
      showToast('Brand deleted', 'success')
      loadBrands()
    } catch (e: any) {
      showToast(e.message || 'Failed to delete', 'error')
    }
  }

  function openRateCard(b: Brand) {
    setSelected(b)
    loadRates(b)
  }

  function openCreateRate() {
    setEditingRate(null)
    setRateForm(emptyRate)
    setShowRateForm(true)
  }
  function openEditRate(r: BrandRate) {
    setEditingRate(r)
    setRateForm({
      provider: r.provider, mode: r.mode, card_type: r.card_type || '', brand_type: r.brand_type || '',
      card_classification: r.card_classification || '', min_amount: r.min_amount, max_amount: r.max_amount,
      mdr_value: r.mdr_value, mdr_value_t0: r.mdr_value_t0, min_mdr_value: r.min_mdr_value, min_mdr_value_t0: r.min_mdr_value_t0,
      gst_inclusive: !!r.gst_inclusive,
    })
    setShowRateForm(true)
  }

  async function saveRate() {
    if (!selected) return
    setSaving(true)
    try {
      const payload = {
        ...rateForm,
        min_amount: Number(rateForm.min_amount),
        max_amount: Number(rateForm.max_amount),
        mdr_value: Number(rateForm.mdr_value),
        mdr_value_t0: Number(rateForm.mdr_value_t0),
        min_mdr_value: Number(rateForm.min_mdr_value),
        min_mdr_value_t0: Number(rateForm.min_mdr_value_t0),
        gst_inclusive: !!rateForm.gst_inclusive,
      }
      const res = editingRate
        ? await apiFetch(`/api/admin/brands/${selected.id}/rates`, { method: 'PATCH', body: JSON.stringify({ rateId: editingRate.id, ...payload }) })
        : await apiFetch(`/api/admin/brands/${selected.id}/rates`, { method: 'POST', body: JSON.stringify(payload) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save rate')
      showToast(editingRate ? 'Rate updated' : 'Rate added', 'success')
      setShowRateForm(false)
      loadRates(selected)
      loadBrands()
    } catch (e: any) {
      showToast(e.message || 'Failed to save rate', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function deleteRate(r: BrandRate) {
    if (!selected) return
    if (!window.confirm('Delete this rate?')) return
    try {
      const res = await apiFetch(`/api/admin/brands/${selected.id}/rates?rateId=${r.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete')
      showToast('Rate deleted', 'success')
      loadRates(selected)
      loadBrands()
    } catch (e: any) {
      showToast(e.message || 'Failed to delete', 'error')
    }
  }

  const inputCls = 'w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2.5 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white'
  const labelCls = 'block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1'

  // ── Rate-card view ──────────────────────────────────────────────────────────
  if (selected) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <button onClick={() => setSelected(null)} className="inline-flex items-center gap-1 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900">
              <ChevronLeft className="w-4 h-4" /> Brands
            </button>
            <span className="text-gray-400">/</span>
            <Building2 className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{selected.name} — Rate Card</h2>
          </div>
          <button onClick={openCreateRate} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700">
            <Plus className="w-4 h-4" /> Add Rate
          </button>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          <strong>Vendor</strong> = acquirer cost the company pays upstream. <strong>Min</strong> = minimum MDR offered
          downstream (vendor + guaranteed margin); schemes can never be priced below it. Company margin per txn = Min − Vendor.
        </p>

        {ratesLoading ? (
          <div className="flex items-center justify-center py-12 text-gray-500"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
        ) : rates.length === 0 ? (
          <div className="text-center py-12 text-sm text-gray-500 dark:text-gray-400">No rates yet. Add the first vendor cost + minimum.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-2 pr-3">Provider</th>
                  <th className="py-2 pr-3">Mode</th>
                  <th className="py-2 pr-3">Card / Network / Tier</th>
                  <th className="py-2 pr-3">Band (₹)</th>
                  <th className="py-2 pr-3">Vendor T1 / T0</th>
                  <th className="py-2 pr-3">Min T1 / T0</th>
                  <th className="py-2 pr-3">Margin</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rates.map((r) => {
                  const margin = r.min_mdr_value > 0 ? r.min_mdr_value - r.mdr_value : 0
                  const dims = [r.card_type, r.brand_type, r.card_classification].filter(Boolean).join(' / ') || '—'
                  return (
                    <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700/50">
                      <td className="py-2 pr-3 font-mono text-xs">{r.provider}</td>
                      <td className="py-2 pr-3">{r.mode}</td>
                      <td className="py-2 pr-3">{dims}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{Number(r.min_amount)}–{Number(r.max_amount)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{pctFmt(r.mdr_value)} / {r.mdr_value_t0 > 0 ? pctFmt(r.mdr_value_t0) : '—'}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{r.min_mdr_value > 0 ? pctFmt(r.min_mdr_value) : '—'} / {r.min_mdr_value_t0 > 0 ? pctFmt(r.min_mdr_value_t0) : '—'}</td>
                      <td className="py-2 pr-3 whitespace-nowrap font-medium text-green-700 dark:text-green-400">{margin > 0 ? pctFmt(margin) : '—'}</td>
                      <td className="py-2 pr-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${r.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{r.active ? 'active' : 'inactive'}</span>
                      </td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">
                        <button onClick={() => openEditRate(r)} className="p-1.5 text-gray-500 hover:text-indigo-600"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => deleteRate(r)} className="p-1.5 text-gray-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {showRateForm && (
          <Modal title={editingRate ? 'Edit Rate' : 'Add Rate'} onClose={() => setShowRateForm(false)}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Provider</label>
                <input className={inputCls} value={rateForm.provider} onChange={(e) => setRateForm({ ...rateForm, provider: e.target.value })} placeholder="* or RAZORPAY" />
              </div>
              <div>
                <label className={labelCls}>Mode</label>
                <select className={inputCls} value={rateForm.mode} onChange={(e) => setRateForm({ ...rateForm, mode: e.target.value })}>
                  {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Card Type</label>
                <select className={inputCls} value={rateForm.card_type} onChange={(e) => setRateForm({ ...rateForm, card_type: e.target.value })}>
                  {CARD_TYPES.map((c) => <option key={c} value={c}>{c || 'Any'}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Network (brand_type)</label>
                <input className={inputCls} value={rateForm.brand_type} onChange={(e) => setRateForm({ ...rateForm, brand_type: e.target.value })} placeholder="Any · VISA · RUPAY" />
              </div>
              <div>
                <label className={labelCls}>Classification</label>
                <input className={inputCls} value={rateForm.card_classification} onChange={(e) => setRateForm({ ...rateForm, card_classification: e.target.value })} placeholder="Any · PLATINUM" />
              </div>
              <div />
              <div>
                <label className={labelCls}>Min Amount (₹)</label>
                <input type="number" className={inputCls} value={rateForm.min_amount} onChange={(e) => setRateForm({ ...rateForm, min_amount: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>Max Amount (₹)</label>
                <input type="number" className={inputCls} value={rateForm.max_amount} onChange={(e) => setRateForm({ ...rateForm, max_amount: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>Vendor Cost T+1 (%)</label>
                <input type="number" step="0.0001" className={inputCls} value={rateForm.mdr_value} onChange={(e) => setRateForm({ ...rateForm, mdr_value: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>Vendor Cost T+0 (%)</label>
                <input type="number" step="0.0001" className={inputCls} value={rateForm.mdr_value_t0} onChange={(e) => setRateForm({ ...rateForm, mdr_value_t0: e.target.value })} placeholder="0 = same as T+1" />
              </div>
              <div>
                <label className={labelCls}>Minimum MDR T+1 (%)</label>
                <input type="number" step="0.0001" className={inputCls} value={rateForm.min_mdr_value} onChange={(e) => setRateForm({ ...rateForm, min_mdr_value: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>Minimum MDR T+0 (%)</label>
                <input type="number" step="0.0001" className={inputCls} value={rateForm.min_mdr_value_t0} onChange={(e) => setRateForm({ ...rateForm, min_mdr_value_t0: e.target.value })} placeholder="0 = same as T+1" />
              </div>
              <div className="col-span-2">
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
                  <input type="checkbox" checked={!!rateForm.gst_inclusive} onChange={(e) => setRateForm({ ...rateForm, gst_inclusive: e.target.checked })} />
                  Vendor cost includes GST (18%) — ex-GST cost = value ÷ 1.18 is used for revenue
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowRateForm(false)} className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200">Cancel</button>
              <button onClick={saveRate} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Percent className="w-4 h-4" />} Save
              </button>
            </div>
          </Modal>
        )}
      </div>
    )
  }

  // ── Brands list view ────────────────────────────────────────────────────────
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Building2 className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Brands & Vendor Rates</h2>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadBrands} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          <button onClick={openCreateBrand} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700">
            <Plus className="w-4 h-4" /> New Brand
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        A brand is a vendor/acquiring identity that owns a rate card. The rate card is the authoritative vendor cost and
        minimum MDR floor used to price POS schemes and compute exact per-transaction revenue.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-500"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
      ) : brands.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-500 dark:text-gray-400">No brands yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                <th className="py-2 pr-3">Brand</th>
                <th className="py-2 pr-3">Key</th>
                <th className="py-2 pr-3">Settlement</th>
                <th className="py-2 pr-3">Cutoff</th>
                <th className="py-2 pr-3">Rates</th>
                <th className="py-2 pr-3">Machines</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {brands.map((b) => (
                <tr key={b.id} className="border-b border-gray-100 dark:border-gray-700/50">
                  <td className="py-2 pr-3">
                    <button onClick={() => openRateCard(b)} className="font-medium text-indigo-600 hover:underline text-left">{b.name}</button>
                    {b.short_name && <div className="text-xs text-gray-400">{b.short_name}</div>}
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">{b.key}</td>
                  <td className="py-2 pr-3">{b.settlement_mode}</td>
                  <td className="py-2 pr-3">{b.t1_cutoff_hour != null ? `${b.t1_cutoff_hour}:00` : '—'}</td>
                  <td className="py-2 pr-3">
                    <button onClick={() => openRateCard(b)} className="text-indigo-600 hover:underline">{b.rates}</button>
                  </td>
                  <td className="py-2 pr-3">{b.machines}</td>
                  <td className="py-2 pr-3">
                    <button onClick={() => toggleBrandActive(b)} className={`text-xs px-2 py-0.5 rounded-full ${b.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{b.active ? 'active' : 'inactive'}</button>
                  </td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap">
                    <button onClick={() => openEditBrand(b)} className="p-1.5 text-gray-500 hover:text-indigo-600"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => deleteBrand(b)} className="p-1.5 text-gray-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showBrandForm && (
        <Modal title={editingBrand ? 'Edit Brand' : 'New Brand'} onClose={() => setShowBrandForm(false)}>
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Key (slug)</label>
              <input className={inputCls} value={brandForm.key} disabled={!!editingBrand} onChange={(e) => setBrandForm({ ...brandForm, key: e.target.value })} placeholder="teachway" />
              {editingBrand && <p className="text-xs text-gray-400 mt-1">Key is immutable (used as merchant_slug).</p>}
            </div>
            <div>
              <label className={labelCls}>Name</label>
              <input className={inputCls} value={brandForm.name} onChange={(e) => setBrandForm({ ...brandForm, name: e.target.value })} placeholder="Teachway Education Private Limited" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Short Name</label>
                <input className={inputCls} value={brandForm.short_name} onChange={(e) => setBrandForm({ ...brandForm, short_name: e.target.value })} placeholder="Teachway" />
              </div>
              <div>
                <label className={labelCls}>Settlement Mode</label>
                <select className={inputCls} value={brandForm.settlement_mode} onChange={(e) => setBrandForm({ ...brandForm, settlement_mode: e.target.value })}>
                  {SETTLEMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>T+1 Cutoff Hour (IST 0–23, optional)</label>
              <input type="number" min={0} max={23} className={inputCls} value={brandForm.t1_cutoff_hour} onChange={(e) => setBrandForm({ ...brandForm, t1_cutoff_hour: e.target.value })} placeholder="e.g. 18" />
            </div>
            <div>
              <label className={labelCls}>Description</label>
              <input className={inputCls} value={brandForm.description} onChange={(e) => setBrandForm({ ...brandForm, description: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => setShowBrandForm(false)} className="px-3 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200">Cancel</button>
            <button onClick={saveBrand} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Building2 className="w-4 h-4" />} Save
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-lg p-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
