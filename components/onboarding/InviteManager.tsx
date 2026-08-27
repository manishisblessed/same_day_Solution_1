'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { useAuth } from '@/contexts/AuthContext'
import {
  UserPlus, Send, Loader2, RefreshCw, Pencil, Link2, Share2, Copy,
  CheckCircle2, XCircle, X, Search, ExternalLink, Clock,
} from 'lucide-react'
import { useToast } from '@/components/Toast'

interface InviteRow {
  id: string
  email: string
  phone: string
  name?: string
  target_role: string
  status: string
  created_at: string
  created_partner_id?: string | null
  onboardingLink?: string | null
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  registered: 'bg-blue-100 text-blue-800',
  verified: 'bg-indigo-100 text-indigo-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-rose-100 text-rose-800',
  expired: 'bg-gray-100 text-gray-600',
  resubmit: 'bg-purple-100 text-purple-800',
}

const ROLE_LABEL: Record<string, string> = {
  master_distributor: 'Master Distributor',
  distributor: 'Distributor',
  retailer: 'Retailer',
}

const ACTIVE_LINK_STATUSES = ['pending', 'registered', 'verified', 'resubmit']

async function copyLink(link: string, showToast: (m: string, t?: any) => void) {
  try {
    await navigator.clipboard.writeText(link)
    showToast('Onboarding link copied', 'success')
  } catch {
    showToast('Could not copy link', 'error')
  }
}

async function shareLink(link: string, name: string | undefined, showToast: (m: string, t?: any) => void) {
  if (typeof navigator !== 'undefined' && 'share' in navigator) {
    try {
      await navigator.share({
        title: 'Same Day Solution Onboarding',
        text: name ? `Onboarding link for ${name}` : 'Complete your onboarding',
        url: link,
      })
      return
    } catch {
      /* dismissed / unsupported — fall back to copy */
    }
  }
  await copyLink(link, showToast)
}

/**
 * Reusable onboarding invite manager. Behaviour adapts to the current role:
 *  - admin: choose any target role + parent picker; can approve/reject KYC.
 *  - MD/DT: single fixed target role; approve/reject hidden.
 */
export default function InviteManager({ adminMode = false }: { adminMode?: boolean }) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [invites, setInvites] = useState<InviteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editing, setEditing] = useState<InviteRow | null>(null)

  const [role, setRole] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [parents, setParents] = useState<{ partner_id: string; name: string }[]>([])
  const [parentId, setParentId] = useState('')
  const [parentSearch, setParentSearch] = useState('')
  const [parentsLoading, setParentsLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [err, setErr] = useState('')
  const [lastLink, setLastLink] = useState('')

  const isAdmin = user?.role === 'admin' || user?.role === 'finance_executive'

  const defaultTargetRole =
    user?.role === 'master_distributor' ? 'distributor' : user?.role === 'distributor' ? 'retailer' : ''

  const targetRole = isAdmin ? role : defaultTargetRole
  const needsParent = isAdmin && (targetRole === 'distributor' || targetRole === 'retailer')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/onboarding/invite?pageSize=100')
      const data = await res.json()
      if (data.success) setInvites(data.invites)
    } catch (e: any) {
      showToast(e?.message || 'Failed to load invites', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    load()
  }, [load])

  // Load parent options for the admin picker when target role is DT/RT.
  useEffect(() => {
    if (!needsParent) {
      setParents([])
      setParentId('')
      return
    }
    setParentsLoading(true)
    apiFetch(`/api/onboarding/invite/parents?role=${targetRole}`)
      .then((r) => r.json())
      .then((d) => setParents(d.parents || []))
      .catch(() => setParents([]))
      .finally(() => setParentsLoading(false))
  }, [targetRole, needsParent])

  const filteredParents = useMemo(() => {
    if (!parentSearch) return parents
    const q = parentSearch.toLowerCase()
    return parents.filter((p) => p.name.toLowerCase().includes(q) || p.partner_id.toLowerCase().includes(q))
  }, [parents, parentSearch])

  async function createInvite() {
    setErr('')
    setLastLink('')
    if (needsParent && !parentId) {
      setErr(`Select the ${targetRole === 'distributor' ? 'Master Distributor' : 'Distributor'} to place this partner under.`)
      return
    }
    setCreating(true)
    try {
      const body: any = { email, phone, name, role: targetRole }
      if (isAdmin && targetRole === 'distributor') body.parent_master_distributor_id = parentId
      if (isAdmin && targetRole === 'retailer') body.parent_distributor_id = parentId
      const res = await apiFetch('/api/onboarding/invite', { method: 'POST', body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create invite')
      showToast('Invite created and link sent', 'success')
      setLastLink(data.link)
      setEmail('')
      setPhone('')
      setName('')
      setParentId('')
      setParentSearch('')
      await load()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setCreating(false)
    }
  }

  async function act(id: string, action: string, extra?: Record<string, any>) {
    setBusyId(id)
    try {
      const body: any = { action, ...(extra || {}) }
      if (action === 'reject') {
        const reason = prompt('Reason for rejection?')
        if (reason === null) return
        body.reason = reason || 'Rejected'
      }
      const res = await apiFetch(`/api/onboarding/invite/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Action failed')

      if ((action === 'resend' || action === 'reshare') && data.onboardingLink) {
        await copyLink(data.onboardingLink, showToast)
        showToast(data.emailSent ? 'Fresh link sent & copied' : 'Link generated & copied (email failed)', data.emailSent ? 'success' : 'info')
      } else if (action === 'approve') {
        showToast('Invite approved', 'success')
      } else if (action === 'reject') {
        showToast('Invite rejected', 'info')
      }
      await load()
    } catch (e: any) {
      showToast(e.message, 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Create invite */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100 dark:bg-gray-800 dark:ring-gray-700">
        <h3 className="mb-4 flex items-center gap-2 text-base font-bold text-gray-900 dark:text-white">
          <UserPlus className="h-5 w-5 text-indigo-600" /> Invite a New Partner
        </h3>
        {err && <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
        {lastLink && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
            <span className="min-w-0 flex-1 truncate">{lastLink}</span>
            <button onClick={() => copyLink(lastLink, showToast)} className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-white px-2 py-1 font-semibold hover:bg-indigo-50">
              <Copy className="h-3 w-3" /> Copy
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {isAdmin ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Role *</label>
              <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:bg-gray-900 dark:border-gray-600 dark:text-white">
                <option value="">Select role…</option>
                <option value="master_distributor">Master Distributor</option>
                <option value="distributor">Distributor</option>
                <option value="retailer">Retailer</option>
              </select>
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Onboarding</label>
              <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:bg-gray-900 dark:text-gray-300">
                <strong>{ROLE_LABEL[defaultTargetRole] || defaultTargetRole}</strong>
              </div>
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:bg-gray-900 dark:border-gray-600 dark:text-white" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Email *</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:bg-gray-900 dark:border-gray-600 dark:text-white" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Phone (10-digit) *</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="9876543210" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:bg-gray-900 dark:border-gray-600 dark:text-white" />
          </div>
        </div>

        {/* Parent picker — always visible for admin creating DT/RT */}
        {needsParent && (
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Assign under * <span className="font-normal text-gray-400">(the {targetRole === 'distributor' ? 'Master Distributor' : 'Distributor'} this partner works under)</span>
            </label>
            {parentsLoading ? (
              <div className="flex items-center gap-2 py-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
            ) : parents.length === 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                No active {targetRole === 'distributor' ? 'Master Distributors' : 'Distributors'} found. Create one first.
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input value={parentSearch} onChange={(e) => setParentSearch(e.target.value)} placeholder="Search by name or ID…" className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm dark:bg-gray-900 dark:border-gray-600 dark:text-white" />
                </div>
                <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
                  {filteredParents.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-gray-500">No match found.</p>
                  ) : (
                    filteredParents.map((p) => (
                      <label key={p.partner_id} className={`flex cursor-pointer items-center gap-2 border-b border-gray-50 px-3 py-2 text-sm last:border-0 hover:bg-indigo-50/50 dark:border-gray-700 ${parentId === p.partner_id ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''}`}>
                        <input type="radio" name="parentId" checked={parentId === p.partner_id} onChange={() => setParentId(p.partner_id)} className="h-4 w-4 text-indigo-600" />
                        <span className="truncate font-medium text-gray-800 dark:text-gray-200">{p.name}</span>
                        <span className="ml-auto shrink-0 text-xs text-gray-400">{p.partner_id}</span>
                      </label>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <button
          onClick={createInvite}
          disabled={creating || !email || !phone || (isAdmin && !role) || (needsParent && !parentId)}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-gray-300"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {creating ? 'Sending…' : 'Send Invite'}
        </button>
      </div>

      {/* Invites list */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100 dark:bg-gray-800 dark:ring-gray-700">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">Invites</h3>
          <button onClick={load} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : invites.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">No invites yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase text-gray-400 dark:border-gray-700">
                  <th className="py-2 pr-3">Name / Email</th>
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Partner ID</th>
                  <th className="py-2 pl-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => {
                  const rowBusy = busyId === inv.id
                  const canEdit = inv.status === 'pending'
                  const canReshare = inv.status === 'expired' && !inv.created_partner_id
                  const canApprove = adminMode && isAdmin && ['registered', 'verified'].includes(inv.status)
                  return (
                    <tr key={inv.id} className="border-b last:border-0 dark:border-gray-700">
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-gray-800 dark:text-gray-200">{inv.name || '—'}</div>
                        <div className="text-xs text-gray-400">{inv.email}</div>
                        <div className="text-xs text-gray-400">{inv.phone}</div>
                      </td>
                      <td className="py-2.5 pr-3 text-gray-600 dark:text-gray-300">{ROLE_LABEL[inv.target_role] || inv.target_role}</td>
                      <td className="py-2.5 pr-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[inv.status] || 'bg-gray-100'}`}>{inv.status}</span>
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-gray-500">{inv.created_partner_id || '—'}</td>
                      <td className="py-2.5 pl-3">
                        <div className="flex items-center justify-end gap-1">
                          {inv.onboardingLink && ACTIVE_LINK_STATUSES.includes(inv.status) && (
                            <>
                              <IconBtn title="Copy link" onClick={() => copyLink(inv.onboardingLink!, showToast)}><Link2 className="h-4 w-4" /></IconBtn>
                              <IconBtn title="Share link" onClick={() => shareLink(inv.onboardingLink!, inv.name, showToast)}><Share2 className="h-4 w-4" /></IconBtn>
                              <a href={inv.onboardingLink} target="_blank" rel="noopener noreferrer" title="Open link" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-700"><ExternalLink className="h-4 w-4" /></a>
                            </>
                          )}
                          {canEdit && (
                            <>
                              <IconBtn title="Edit email / phone / name" onClick={() => setEditing(inv)}><Pencil className="h-4 w-4" /></IconBtn>
                              <IconBtn title="Resend link" tone="indigo" disabled={rowBusy} onClick={() => act(inv.id, 'resend')}>
                                {rowBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                              </IconBtn>
                            </>
                          )}
                          {canReshare && (
                            <IconBtn title="Generate a fresh link & reshare" tone="amber" disabled={rowBusy} onClick={() => act(inv.id, 'reshare')}>
                              {rowBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            </IconBtn>
                          )}
                          {canApprove && (
                            <>
                              <IconBtn title="Approve" tone="emerald" disabled={rowBusy} onClick={() => act(inv.id, 'approve')}><CheckCircle2 className="h-4 w-4" /></IconBtn>
                              <IconBtn title="Reject" tone="rose" disabled={rowBusy} onClick={() => act(inv.id, 'reject')}><XCircle className="h-4 w-4" /></IconBtn>
                            </>
                          )}
                          {!inv.onboardingLink && !canEdit && !canReshare && !canApprove && (
                            <span className="text-xs text-gray-300"><Clock className="h-4 w-4" /></span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <EditInviteModal
          invite={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await load()
          }}
        />
      )}
    </div>
  )
}

function IconBtn({
  children, title, onClick, disabled, tone = 'gray',
}: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean; tone?: 'gray' | 'indigo' | 'emerald' | 'rose' | 'amber' }) {
  const tones: Record<string, string> = {
    gray: 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-700',
    indigo: 'text-indigo-600 hover:bg-indigo-50',
    emerald: 'text-emerald-600 hover:bg-emerald-50',
    rose: 'text-rose-600 hover:bg-rose-50',
    amber: 'text-amber-600 hover:bg-amber-50',
  }
  return (
    <button title={title} onClick={onClick} disabled={disabled} className={`rounded-lg p-1.5 disabled:opacity-50 ${tones[tone]}`}>
      {children}
    </button>
  )
}

function EditInviteModal({ invite, onClose, onSaved }: { invite: InviteRow; onClose: () => void; onSaved: () => void }) {
  const { showToast } = useToast()
  const [form, setForm] = useState({ email: invite.email, phone: invite.phone, name: invite.name || '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function save() {
    setErr('')
    setSaving(true)
    try {
      const res = await apiFetch(`/api/onboarding/invite/${invite.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'update', email: form.email.trim(), phone: form.phone.trim(), name: form.name.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update invite')
      showToast(data.emailSent ? 'Invite updated & new link sent' : 'Invite updated (email failed — use Resend)', data.emailSent ? 'success' : 'info')
      onSaved()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-gray-800">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Edit invite</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>
        <p className="mb-4 text-sm text-gray-500">Correct the contact if the invite was sent to the wrong details. A fresh link is issued and sent to the new address.</p>
        {err && <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</div>}
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:bg-gray-900 dark:border-gray-600 dark:text-white" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Email *</label>
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:bg-gray-900 dark:border-gray-600 dark:text-white" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Phone *</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:bg-gray-900 dark:border-gray-600 dark:text-white" />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300">Cancel</button>
          <button onClick={save} disabled={saving || !form.email || !form.phone} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-gray-300">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Save &amp; Resend
          </button>
        </div>
      </div>
    </div>
  )
}
