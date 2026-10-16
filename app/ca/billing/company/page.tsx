'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  Loader2, CheckCircle, AlertCircle, Building2, Plus, Trash2, Save, ShieldCheck, ShieldAlert,
} from 'lucide-react'
import { apiFetch } from '@/lib/api-client'

interface Brand { id: string; key: string; name: string; short_name: string }
interface ServiceLine { description: string; sac: string; percent: number }
interface Completeness { complete: boolean; missing: string[] }
interface Config {
  id?: string; brand_id: string
  legal_name?: string | null; address?: string | null; gstin?: string | null; pan?: string | null
  email?: string | null; phone?: string | null; state_code?: string | null; cin?: string | null
  place_of_supply?: string | null; jurisdiction?: string | null; reverse_charge?: string | null
  margin_percent?: number | null; gst_percent?: number | null
  service_lines?: ServiceLine[] | null; terms?: string[] | null
  bank_account_number?: string | null; bank_account_type?: string | null; bank_holder_name?: string | null
  bank_name?: string | null; bank_branch?: string | null; bank_ifsc?: string | null
  authorized_signatory_name?: string | null; signature_image?: string | null
  completeness?: Completeness
  brands?: Brand
}

const emptyCfg = (brand_id: string): Config => ({
  brand_id, legal_name: '', address: '', gstin: '', pan: '', email: '', phone: '',
  state_code: '', cin: '', place_of_supply: '', jurisdiction: '', reverse_charge: 'NO',
  margin_percent: 20, gst_percent: 18, service_lines: [], terms: [],
  bank_account_number: '', bank_account_type: '', bank_holder_name: '', bank_name: '',
  bank_branch: '', bank_ifsc: '', authorized_signatory_name: '', signature_image: '',
})

export default function CompanyDetailsPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [brands, setBrands] = useState<Brand[]>([])
  const [configs, setConfigs] = useState<Record<string, Config>>({})
  const [brandId, setBrandId] = useState('')
  const [form, setForm] = useState<Config | null>(null)
  const [fetching, setFetching] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  useEffect(() => {
    if (!loading && user?.role !== 'ca_executive') router.push('/ca/login')
  }, [user, loading, router])

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3800)
  }

  const load = useCallback(async () => {
    setFetching(true)
    try {
      const [bRes, cRes] = await Promise.all([apiFetch('/api/ca/brands'), apiFetch('/api/ca/company-config')])
      const [bData, cData] = await Promise.all([bRes.json(), cRes.json()])
      const bs: Brand[] = bData.brands || []
      setBrands(bs)
      const map: Record<string, Config> = {}
      for (const c of (cData.configs || [])) map[c.brand_id] = c
      setConfigs(map)
      const first = brandId || bs[0]?.id || ''
      setBrandId(first)
      if (first) setForm(map[first] ? { ...map[first] } : emptyCfg(first))
    } catch {
      showToast('Failed to load', 'error')
    } finally {
      setFetching(false)
    }
  }, [brandId])

  useEffect(() => { if (user?.role === 'ca_executive') load() }, [user]) // eslint-disable-line

  const selectBrand = (id: string) => {
    setBrandId(id)
    setForm(configs[id] ? { ...configs[id] } : emptyCfg(id))
  }

  const set = (k: keyof Config, v: any) => setForm((f) => (f ? { ...f, [k]: v } : f))

  const lines: ServiceLine[] = form?.service_lines || []
  const setLine = (i: number, k: keyof ServiceLine, v: any) => {
    const next = [...lines]; next[i] = { ...next[i], [k]: k === 'percent' ? Number(v) || 0 : v }; set('service_lines', next)
  }
  const addLine = () => set('service_lines', [...lines, { description: '', sac: '', percent: 0 }])
  const removeLine = (i: number) => set('service_lines', lines.filter((_, x) => x !== i))

  const onSignature = (file: File | null) => {
    if (!file) return
    if (file.size > 400 * 1024) { showToast('Signature image must be under 400 KB', 'error'); return }
    const reader = new FileReader()
    reader.onload = () => set('signature_image', String(reader.result))
    reader.readAsDataURL(file)
  }

  const save = async () => {
    if (!form) return
    setSaving(true)
    try {
      const res = await apiFetch('/api/ca/company-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!data.success) { showToast(data.error || 'Save failed', 'error'); return }
      showToast('Company details saved')
      await load()
    } catch {
      showToast('Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading || !user || user.role !== 'ca_executive') {
    return <div className="flex justify-center mt-16"><Loader2 className="w-8 h-8 animate-spin text-violet-600" /></div>
  }

  const comp = brandId ? configs[brandId]?.completeness : undefined
  const totalPct = lines.reduce((s, l) => s + (Number(l.percent) || 0), 0)

  const inputCls = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none'
  const labelCls = 'block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1'

  const Field = ({ label, k, req, placeholder, mono }: { label: string; k: keyof Config; req?: boolean; placeholder?: string; mono?: boolean }) => (
    <div>
      <label className={labelCls}>{label}{req && <span className="text-red-500"> *</span>}</label>
      <input value={(form?.[k] as string) ?? ''} onChange={(e) => set(k, e.target.value)}
        placeholder={placeholder} className={`${inputCls} ${mono ? 'font-mono' : ''}`} />
    </div>
  )

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-5xl space-y-6 pb-16">
      {toast && (
        <div className={`fixed top-20 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium ${toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
          {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><Building2 className="w-5 h-5 text-violet-500" /> Company Details</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">Issuer profile printed on every reimbursement &amp; GST invoice. Invoices generate only when complete.</p>
      </div>

      {/* Brand selector */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-gray-600 dark:text-gray-400">Company:</label>
        <select value={brandId} onChange={(e) => selectBrand(e.target.value)} className={`${inputCls} max-w-xs`}>
          {brands.map((b) => {
            const done = configs[b.id]?.completeness?.complete
            return <option key={b.id} value={b.id}>{b.name}{done ? '  ✓' : '  (incomplete)'}</option>
          })}
        </select>
        {comp && (
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${comp.complete ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
            {comp.complete ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
            {comp.complete ? 'Ready to generate invoices' : `Missing: ${comp.missing.join(', ')}`}
          </span>
        )}
      </div>

      {fetching || !form ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-violet-500" /></div>
      ) : (
        <>
          {/* Legal + tax */}
          <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 space-y-4">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">Legal &amp; Tax</h2>
            <Field label="Company Name" k="legal_name" req placeholder="LEGAL NAME PRIVATE LIMITED" />
            <div>
              <label className={labelCls}>Address <span className="text-red-500">*</span></label>
              <textarea value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} rows={2}
                placeholder="Full registered address" className={inputCls} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Field label="GSTIN" k="gstin" req mono placeholder="07XXXXX0000X1ZN" />
              <Field label="PAN" k="pan" req mono placeholder="XXXXX0000X" />
              <Field label="CIN" k="cin" mono placeholder="U00000XX0000XXX000000" />
              <Field label="Email" k="email" req placeholder="billing@company.com" />
              <Field label="Phone" k="phone" placeholder="+91 ..." />
              <Field label="State Code" k="state_code" mono placeholder="07" />
              <Field label="Place of Supply" k="place_of_supply" placeholder="Delhi" />
              <Field label="Jurisdiction" k="jurisdiction" placeholder="Delhi" />
              <div>
                <label className={labelCls}>Reverse Charge</label>
                <select value={form.reverse_charge ?? 'NO'} onChange={(e) => set('reverse_charge', e.target.value)} className={inputCls}>
                  <option value="NO">NO</option><option value="YES">YES</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Margin %</label>
                <input type="number" step="0.01" value={form.margin_percent ?? 20} onChange={(e) => set('margin_percent', Number(e.target.value))} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>GST %</label>
                <input type="number" step="0.01" value={form.gst_percent ?? 18} onChange={(e) => set('gst_percent', Number(e.target.value))} className={inputCls} />
              </div>
            </div>
          </section>

          {/* Service lines */}
          <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">Description of Service &amp; SAC/HSN <span className="text-red-500">*</span></h2>
              <span className={`text-xs font-semibold ${totalPct === 100 ? 'text-emerald-600' : 'text-amber-600'}`}>Split total: {totalPct}%</span>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <input value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} placeholder="Description of service" className={`${inputCls} flex-1`} />
                  <input value={l.sac} onChange={(e) => setLine(i, 'sac', e.target.value)} placeholder="SAC/HSN" className={`${inputCls} w-28 font-mono`} />
                  <input type="number" value={l.percent} onChange={(e) => setLine(i, 'percent', e.target.value)} placeholder="%" className={`${inputCls} w-20`} />
                  <button onClick={() => removeLine(i)} className="p-2 mt-0.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
            <button onClick={addLine} className="flex items-center gap-1.5 text-sm text-violet-600 hover:text-violet-700 font-medium"><Plus className="w-4 h-4" /> Add service line</button>
          </section>

          {/* Bank */}
          <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 space-y-4">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">Bank Details</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Field label="Bank Account Number" k="bank_account_number" req mono />
              <Field label="Particular of A/C" k="bank_account_type" placeholder="Current Account" />
              <Field label="A/C Holder's Name" k="bank_holder_name" req />
              <Field label="Bank Name" k="bank_name" req />
              <Field label="IFSC Code" k="bank_ifsc" req mono />
              <Field label="Branch Name" k="bank_branch" />
            </div>
          </section>

          {/* Signatory */}
          <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-5 space-y-4">
            <h2 className="text-sm font-bold text-gray-900 dark:text-white">Authorized Signatory</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              <Field label="Signatory Name" k="authorized_signatory_name" placeholder="Name of authorized signatory" />
              <div>
                <label className={labelCls}>Signature Image (optional, &lt; 400 KB)</label>
                <input type="file" accept="image/*" onChange={(e) => onSignature(e.target.files?.[0] || null)} className="text-sm" />
                {form.signature_image && (
                  <div className="mt-2 flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={form.signature_image} alt="signature" className="h-12 border border-gray-200 dark:border-gray-700 rounded bg-white p-1" />
                    <button onClick={() => set('signature_image', '')} className="text-xs text-red-600 hover:underline">Remove</button>
                  </div>
                )}
              </div>
            </div>
          </section>

          <div className="sticky bottom-0 flex justify-end gap-3 py-3 bg-gradient-to-t from-white dark:from-gray-900 to-transparent">
            <button onClick={save} disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-lg disabled:opacity-60 shadow-sm">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving...' : 'Save Company Details'}
            </button>
          </div>
        </>
      )}
    </motion.div>
  )
}
