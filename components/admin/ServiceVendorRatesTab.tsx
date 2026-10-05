'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'
import { useToast } from '@/components/Toast'
import { RefreshCw, Plus, Trash2, Pencil, Layers, Loader2, X, Save } from 'lucide-react'

type ServiceKind = 'BBPS' | 'PAYOUT'
type RateType = 'PERCENT' | 'FLAT'

interface ServiceVendorRate {
  id: string
  service_kind: ServiceKind
  scope_key: string
  category: string | null
  min_amount: number
  max_amount: number
  vendor_rate_type: RateType
  vendor_rate: number
  min_charge_type: RateType
  min_charge: number
  gst_inclusive: boolean
  active: boolean
}

const BBPS_CATEGORIES = [
  'Credit Card', 'Electricity', 'Gas', 'Water', 'Insurance',
  'Mobile Postpaid', 'DTH', 'Broadband', 'EMI', 'Education',
  'Loan', 'FASTag', 'Municipal Taxes',
]
const TRANSFER_MODES = ['IMPS']
const BBPS_BANDS: { min: number; max: number }[] = [
  { min: 100, max: 49999 },
  { min: 50000, max: 100000 },
  { min: 100001, max: 200000 },
]
const PAYOUT_BANDS: { min: number; max: number }[] = [
  { min: 100, max: 1000 },
  { min: 1001, max: 25000 },
  { min: 25001, max: 50000 },
  { min: 50001, max: 100000 },
]

const KINDS: { id: ServiceKind; label: string; hasCategory: boolean }[] = [
  { id: 'BBPS', label: 'BBPS', hasCategory: true },
  { id: 'PAYOUT', label: 'Settlement (Account Transfer)', hasCategory: false },
]

const emptyRate = (kind: ServiceKind) => {
  const band = kind === 'BBPS' ? BBPS_BANDS[0] : PAYOUT_BANDS[0]
  return {
    scope_key: kind === 'PAYOUT' ? 'IMPS' : '*',
    category: kind === 'BBPS' ? '*' : '',
    min_amount: band.min,
    max_amount: band.max,
    vendor_rate_type: 'FLAT' as RateType,
    vendor_rate: 0,
    min_charge_type: 'FLAT' as RateType,
    min_charge: 0,
    gst_inclusive: false,
  }
}

const fmtVal = (v: number, t: RateType) => (t === 'PERCENT' ? `${Number(v).toFixed(2)}%` : `₹${Number(v).toFixed(2)}`)

export default function ServiceVendorRatesTab() {
  const { showToast } = useToast()
  const [kind, setKind] = useState<ServiceKind>('BBPS')
  const meta = KINDS.find((k) => k.id === kind)!

  const [rates, setRates] = useState<ServiceVendorRate[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [showRateForm, setShowRateForm] = useState(false)
  const [editingRate, setEditingRate] = useState<ServiceVendorRate | null>(null)
  const [rateForm, setRateForm] = useState<any>(emptyRate('BBPS'))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/admin/service-vendor-rates?service_kind=${kind}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load rates')
      setRates(data.rates || [])
    } catch (e: any) {
      showToast(e.message || 'Failed to load', 'error')
    } finally {
      setLoading(false)
    }
  }, [kind, showToast])

  useEffect(() => { load() }, [load])

  const bands = kind === 'BBPS' ? BBPS_BANDS : PAYOUT_BANDS
  const selectedBand = bands.find(b => b.max === Number(rateForm.max_amount)) || bands[0]

  function openCreateRate() {
    setEditingRate(null)
    setRateForm(emptyRate(kind))
    setShowRateForm(true)
  }
  function openEditRate(r: ServiceVendorRate) {
    setEditingRate(r)
    setRateForm({
      scope_key: r.scope_key,
      category: r.category || (kind === 'BBPS' ? '*' : ''),
      min_amount: r.min_amount,
      max_amount: r.max_amount,
      vendor_rate_type: 'FLAT',
      vendor_rate: r.vendor_rate,
      min_charge_type: 'FLAT',
      min_charge: r.min_charge,
      gst_inclusive: !!r.gst_inclusive,
    })
    setShowRateForm(true)
  }

  async function saveRate() {
    if (kind === 'BBPS' && !rateForm.category?.trim() && rateForm.category !== '*') {
      showToast('Category is required for BBPS', 'error')
      return
    }
    setSaving(true)
    try {
      const payload = {
        service_kind: kind,
        scope_key: kind === 'BBPS' ? '*' : (rateForm.scope_key?.trim() || '*'),
        category: kind === 'BBPS' ? (rateForm.category === '*' ? null : (rateForm.category?.trim() || null)) : null,
        min_amount: selectedBand.min,
        max_amount: Number(rateForm.max_amount),
        vendor_rate_type: 'FLAT',
        vendor_rate: Number(rateForm.vendor_rate),
        min_charge_type: 'FLAT',
        min_charge: Number(rateForm.min_charge),
        gst_inclusive: !!rateForm.gst_inclusive,
      }
      const res = editingRate
        ? await apiFetch('/api/admin/service-vendor-rates', { method: 'PUT', body: JSON.stringify({ id: editingRate.id, ...payload }) })
        : await apiFetch('/api/admin/service-vendor-rates', { method: 'POST', body: JSON.stringify(payload) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to save rate')
      showToast(editingRate ? 'Rate updated' : 'Rate added', 'success')
      setShowRateForm(false)
      load()
    } catch (e: any) {
      showToast(e.message || 'Failed to save rate', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function toggleRate(r: ServiceVendorRate) {
    try {
      const res = await apiFetch('/api/admin/service-vendor-rates', {
        method: 'PUT',
        body: JSON.stringify({ ...r, active: !r.active }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      load()
    } catch (e: any) {
      showToast(e.message || 'Failed to update', 'error')
    }
  }

  async function deleteRate(r: ServiceVendorRate) {
    if (!window.confirm('Delete this vendor rate?')) return
    try {
      const res = await apiFetch(`/api/admin/service-vendor-rates?id=${r.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete')
      showToast('Rate deleted', 'success')
      load()
    } catch (e: any) {
      showToast(e.message || 'Failed to delete', 'error')
    }
  }

  const inputCls = 'w-full text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2.5 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white'
  const labelCls = 'block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1'

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Layers className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Service Vendor & Minimum Rates</h2>
        </div>
        <button onClick={load} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Service-kind selector */}
      <div className="flex flex-wrap gap-2 mb-4">
        {KINDS.map((k) => (
          <button
            key={k.id}
            onClick={() => setKind(k.id)}
            className={`text-sm px-3 py-1.5 rounded-md border ${kind === k.id ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
          >
            {k.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        <strong>Vendor rate (₹)</strong> = cost the company pays upstream per transaction for {meta.label}. <strong>Minimum (₹)</strong> = lowest
        customer charge a scheme may offer (vendor + guaranteed margin). Revenue per txn = customer charge − ex-GST vendor cost.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-500"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
      ) : (
        <>
          <div className="flex justify-end mb-3">
            <button onClick={openCreateRate} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700">
              <Plus className="w-4 h-4" /> Add Rate
            </button>
          </div>
          {rates.length === 0 ? (
            <div className="text-center py-12 text-sm text-gray-500 dark:text-gray-400">No vendor rates yet for {meta.label}.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    {kind === 'BBPS' ? (
                      <th className="py-2 pr-3">Category</th>
                    ) : (
                      <th className="py-2 pr-3">Transfer Mode</th>
                    )}
                    <th className="py-2 pr-3">Band (₹)</th>
                    <th className="py-2 pr-3">Vendor (₹)</th>
                    <th className="py-2 pr-3">Minimum (₹)</th>
                    <th className="py-2 pr-3">GST</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rates.map((r) => (
                    <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700/50">
                      <td className="py-2 pr-3">{kind === 'BBPS' ? (r.category || 'All') : r.scope_key}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{Number(r.min_amount)}–{Number(r.max_amount)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{fmtVal(r.vendor_rate, r.vendor_rate_type)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{r.min_charge > 0 ? fmtVal(r.min_charge, r.min_charge_type) : '—'}</td>
                      <td className="py-2 pr-3">{r.gst_inclusive ? <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">incl</span> : <span className="text-xs text-gray-400">excl</span>}</td>
                      <td className="py-2 pr-3">
                        <button onClick={() => toggleRate(r)} className={`text-xs px-2 py-0.5 rounded-full ${r.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{r.active ? 'active' : 'inactive'}</button>
                      </td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">
                        <button onClick={() => openEditRate(r)} className="p-1.5 text-gray-500 hover:text-indigo-600"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => deleteRate(r)} className="p-1.5 text-gray-500 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Rate modal */}
      {showRateForm && (
        <Modal title={editingRate ? 'Edit Vendor Rate' : 'Add Vendor Rate'} onClose={() => setShowRateForm(false)}>
          <div className="grid grid-cols-2 gap-3">
            {kind === 'BBPS' ? (
              <div className="col-span-2">
                <label className={labelCls}>Category <span className="text-red-500">*</span></label>
                <select className={inputCls} value={rateForm.category} onChange={(e) => setRateForm({ ...rateForm, category: e.target.value })}>
                  <option value="*">All Categories</option>
                  {BBPS_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            ) : (
              <div className="col-span-2">
                <label className={labelCls}>Transfer Mode <span className="text-red-500">*</span></label>
                <select className={inputCls} value={rateForm.scope_key} onChange={(e) => setRateForm({ ...rateForm, scope_key: e.target.value })}>
                  {TRANSFER_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className={labelCls}>Min Amount (₹)</label>
              <input type="number" className={`${inputCls} bg-gray-100 dark:bg-gray-600`} value={selectedBand.min} disabled />
            </div>
            <div>
              <label className={labelCls}>Max Amount (₹)</label>
              <select className={inputCls} value={rateForm.max_amount} onChange={(e) => setRateForm({ ...rateForm, max_amount: e.target.value })}>
                {bands.map((b) => <option key={b.max} value={b.max}>₹{b.max.toLocaleString('en-IN')}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Vendor Rate (₹ per txn)</label>
              <input type="number" step="0.01" className={inputCls} value={rateForm.vendor_rate} onChange={(e) => setRateForm({ ...rateForm, vendor_rate: e.target.value })} placeholder="e.g. 3.50" />
            </div>
            <div>
              <label className={labelCls}>Minimum Charge (₹ per txn)</label>
              <input type="number" step="0.01" className={inputCls} value={rateForm.min_charge} onChange={(e) => setRateForm({ ...rateForm, min_charge: e.target.value })} placeholder="0 = unset" />
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
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
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
