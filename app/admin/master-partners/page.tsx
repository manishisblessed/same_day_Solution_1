'use client'

import { useCallback, useEffect, useState, Suspense } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import AdminSidebar from '@/components/AdminSidebar'
import { apiFetch } from '@/lib/api-client'
import { useToast } from '@/components/Toast'
import {
  Network, Plus, X, ChevronDown, ChevronUp, Link2, ArrowUpCircle, ArrowDownCircle, Loader2,
} from 'lucide-react'

// ============================================================================
// Types
// ============================================================================
interface Assignment { id: string; status: string }
interface ChildPartner { id: string; name: string; business_name?: string; email?: string; phone?: string; status?: string; assignment: Assignment | null }
interface MasterPartner { id: string; name: string; business_name?: string; email?: string; phone?: string; status?: string; children: ChildPartner[] }
interface SimplePartner { id: string; name: string; business_name?: string; email?: string }

export default function MasterPartnersPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>}>
      <MasterPartnersContent />
    </Suspense>
  )
}

function MasterPartnersContent() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [masters, setMasters] = useState<MasterPartner[]>([])
  const [unassigned, setUnassigned] = useState<SimplePartner[]>([])
  const [loading, setLoading] = useState(true)

  const [showCreate, setShowCreate] = useState(false)
  const [showPromote, setShowPromote] = useState(false)
  const [assignFor, setAssignFor] = useState<MasterPartner | null>(null)
  const [expandedMaster, setExpandedMaster] = useState<string | null>(null)

  const loadMasters = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/admin/master-partners').then((r) => r.json())
      if (res.success) {
        setMasters(res.data.masters || [])
        setUnassigned(res.data.unassignedPartners || [])
      } else showToast(res.error || 'Failed to load', 'error')
    } catch { showToast('Failed to load master partners', 'error') }
    finally { setLoading(false) }
  }, [showToast])

  useEffect(() => { loadMasters() }, [loadMasters])

  const post = async (body: any, okMsg: string) => {
    const res = await apiFetch('/api/admin/master-partners', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json())
    if (res.success) { showToast(okMsg, 'success'); loadMasters() }
    else showToast(res.error || 'Action failed', 'error')
    return res.success
  }

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-950">
      <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="flex-1 lg:ml-56 p-4 md:p-6 pt-20">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Network className="w-7 h-7 text-primary-600" /> Master Channel Partners
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Onboard master partners and assign child partners. The master&apos;s POS commission is set on the child&apos;s Partner Plan MDR rate in Scheme Management.
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex gap-2">
            <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary-600 to-secondary-600 text-white rounded-lg hover:opacity-90 text-sm font-medium">
              <Plus className="w-4 h-4" /> Create Master Partner
            </button>
            <button onClick={() => setShowPromote(true)} className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 text-sm font-medium">
              <ArrowUpCircle className="w-4 h-4" /> Promote Existing Partner
            </button>
          </div>

          {loading ? (
            <div className="py-12 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
          ) : masters.length === 0 ? (
            <div className="py-12 text-center text-gray-400 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
              No master partners yet. Create one or promote an existing partner.
            </div>
          ) : masters.map((m) => (
            <div key={m.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between p-4">
                <button className="flex items-center gap-3 text-left" onClick={() => setExpandedMaster(expandedMaster === m.id ? null : m.id)}>
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white">
                    <Network className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900 dark:text-white">{m.business_name || m.name}</div>
                    <div className="text-xs text-gray-500">{m.email} · {m.children.length} partner(s)</div>
                  </div>
                  {expandedMaster === m.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </button>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${m.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{m.status}</span>
                  <button onClick={() => setAssignFor(m)} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-primary-50 text-primary-700 rounded-lg hover:bg-primary-100">
                    <Link2 className="w-3.5 h-3.5" /> Assign Partner
                  </button>
                  {m.children.length === 0 && (
                    <button onClick={() => post({ action: 'demote', partner_id: m.id }, 'Demoted to normal partner')} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">
                      <ArrowDownCircle className="w-3.5 h-3.5" /> Demote
                    </button>
                  )}
                </div>
              </div>

              {expandedMaster === m.id && (
                <div className="border-t border-gray-100 dark:border-gray-700 p-4">
                  {m.children.length === 0 ? (
                    <p className="text-sm text-gray-400">No child partners assigned.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-700">
                          <th className="py-2 pr-3 font-medium">Partner</th>
                          <th className="py-2 px-3 font-medium">Commission</th>
                          <th className="py-2 pl-3 font-medium text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {m.children.map((c) => (
                          <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700 last:border-0">
                            <td className="py-2 pr-3">
                              <div className="font-medium text-gray-800 dark:text-gray-200">{c.business_name || c.name}</div>
                              <div className="text-xs text-gray-400">{c.email}</div>
                            </td>
                            <td className="py-2 px-3 text-xs text-gray-500 dark:text-gray-400">Set on Partner Plan MDR (Scheme Management)</td>
                            <td className="py-2 pl-3 text-right">
                              <button onClick={() => post({ action: 'unassign', partner_id: c.id }, 'Partner unassigned')} className="text-xs text-red-600 hover:underline">Unassign</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </main>

      {showCreate && <CreateMasterModal onClose={() => setShowCreate(false)} onDone={() => { setShowCreate(false); loadMasters() }} post={post} />}
      {showPromote && <PromoteModal unassigned={unassigned} onClose={() => setShowPromote(false)} onDone={() => { setShowPromote(false); loadMasters() }} post={post} />}
      {assignFor && <AssignModal master={assignFor} unassigned={unassigned} onClose={() => setAssignFor(null)} onDone={() => { setAssignFor(null); loadMasters() }} post={post} />}
    </div>
  )
}

// ============================================================================
// Sub-components
// ============================================================================
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-800">
          <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"><X className="w-5 h-5 text-gray-500" /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

const inputCls = 'w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none'

function CreateMasterModal({ onClose, onDone, post }: { onClose: () => void; onDone: () => void; post: (b: any, m: string) => Promise<boolean> }) {
  const [form, setForm] = useState({ name: '', business_name: '', email: '', phone: '', password: '' })
  const [saving, setSaving] = useState(false)
  const submit = async () => {
    setSaving(true)
    const ok = await post({ action: 'create', ...form }, 'Master partner created')
    setSaving(false)
    if (ok) onDone()
  }
  return (
    <Modal title="Create Master Partner" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Contact Name"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Business Name"><input className={inputCls} value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} /></Field>
        <Field label="Email (login)"><input type="email" className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Phone"><input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Password (min 8 chars)"><input type="password" className={inputCls} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
        <button disabled={saving} onClick={submit} className="w-full py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create
        </button>
      </div>
    </Modal>
  )
}

function PromoteModal({ unassigned, onClose, onDone, post }: { unassigned: SimplePartner[]; onClose: () => void; onDone: () => void; post: (b: any, m: string) => Promise<boolean> }) {
  const [partnerId, setPartnerId] = useState('')
  const submit = async () => {
    if (!partnerId) return
    const ok = await post({ action: 'promote', partner_id: partnerId }, 'Partner promoted to master')
    if (ok) onDone()
  }
  return (
    <Modal title="Promote Partner to Master" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-gray-500">Only partners not already under a master partner can be promoted.</p>
        <Field label="Select Partner">
          <select className={inputCls} value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
            <option value="">— select —</option>
            {unassigned.map((p) => <option key={p.id} value={p.id}>{p.business_name || p.name} ({p.email})</option>)}
          </select>
        </Field>
        <button disabled={!partnerId} onClick={submit} className="w-full py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium disabled:opacity-60">Promote</button>
      </div>
    </Modal>
  )
}

function AssignModal({ master, unassigned, onClose, onDone, post }: { master: MasterPartner; unassigned: SimplePartner[]; onClose: () => void; onDone: () => void; post: (b: any, m: string) => Promise<boolean> }) {
  const [partnerId, setPartnerId] = useState('')
  const submit = async () => {
    if (!partnerId) return
    const ok = await post({ action: 'assign', master_partner_id: master.id, partner_id: partnerId }, 'Partner assigned')
    if (ok) onDone()
  }
  return (
    <Modal title={`Assign Partner → ${master.business_name || master.name}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Child Partner">
          <select className={inputCls} value={partnerId} onChange={(e) => setPartnerId(e.target.value)}>
            <option value="">— select unassigned partner —</option>
            {unassigned.map((p) => <option key={p.id} value={p.id}>{p.business_name || p.name} ({p.email})</option>)}
          </select>
        </Field>
        <p className="text-xs text-gray-500">
          The master partner earns POS commission per the child&apos;s <strong>Partner Plan</strong> MDR rate. Set the commission % + TDS on that rate in <strong>Scheme Management</strong>.
        </p>
        <button disabled={!partnerId} onClick={submit} className="w-full py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium disabled:opacity-60">Assign</button>
      </div>
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">{label}</label>
      {children}
    </div>
  )
}
