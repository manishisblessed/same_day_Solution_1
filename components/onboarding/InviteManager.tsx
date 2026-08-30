'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { useAuth } from '@/contexts/AuthContext'
import {
  UserPlus, Send, Loader2, RefreshCw, Pencil, Link2, Share2, Copy,
  CheckCircle2, XCircle, X, Search, ExternalLink, Clock, Eye, FileText,
  ShieldCheck, Landmark, User, Video as VideoIcon, Mail, MessageSquare,
  Download, ZoomIn,
} from 'lucide-react'
import JSZip from 'jszip'
import { useToast } from '@/components/Toast'
import { ONBOARD_STEPS, computeOnboardingProgress } from '@/lib/onboarding/progress'

interface InviteProgress {
  currentLabel: string
  currentKey: string
  percent: number
  completedCount: number
  totalCount: number
  complete: boolean
}

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
  progress?: InviteProgress
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
  partner: 'Partner',
  master_partner: 'Master Partner',
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
  const [reviewing, setReviewing] = useState<InviteRow | null>(null)

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
  const [channels, setChannels] = useState({ email: true, sms: true })

  const selectedChannels = () => {
    const c: string[] = []
    if (channels.email) c.push('email')
    if (channels.sms) c.push('sms')
    return c
  }

  const sentToast = (data: any, prefix: string) => {
    const parts: string[] = []
    if (data.emailSent) parts.push('email')
    if (data.smsSent) parts.push('SMS')
    if (parts.length) showToast(`${prefix} via ${parts.join(' & ')}`, 'success')
    else showToast(`${prefix} — link ready, but delivery failed. Copy & share manually.`, 'info')
  }

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
    const chans = selectedChannels()
    if (chans.length === 0) {
      setErr('Choose at least one way to notify the invitee (Email or SMS).')
      return
    }
    setCreating(true)
    try {
      const body: any = { email, phone, name, role: targetRole, channels: chans }
      if (isAdmin && targetRole === 'distributor') body.parent_master_distributor_id = parentId
      if (isAdmin && targetRole === 'retailer') body.parent_distributor_id = parentId
      const res = await apiFetch('/api/onboarding/invite', { method: 'POST', body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create invite')
      sentToast(data, 'Invite sent')
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
      // Resend / reshare go out over both channels by default.
      if (action === 'resend' || action === 'reshare') {
        body.channels = ['email', 'sms']
      }
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
        sentToast(data, 'Fresh link sent & copied')
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
                <option value="partner">Partner</option>
                <option value="master_partner">Master Partner</option>
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

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-xs font-medium text-gray-500">Notify via:</span>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={channels.email} onChange={(e) => setChannels((c) => ({ ...c, email: e.target.checked }))} className="h-4 w-4 accent-indigo-600" />
            <Mail className="h-4 w-4 text-gray-400" /> Email
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={channels.sms} onChange={(e) => setChannels((c) => ({ ...c, sms: e.target.checked }))} className="h-4 w-4 accent-indigo-600" />
            <MessageSquare className="h-4 w-4 text-gray-400" /> SMS
          </label>
        </div>

        <button
          onClick={createInvite}
          disabled={creating || !email || !phone || (isAdmin && !role) || (needsParent && !parentId)}
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-gray-300"
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
                  <th className="py-2 pr-3">Progress</th>
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
                  // Any parent who can see the invite may track it; the detail API
                  // scopes access to their own downline (MD→DT, DT→RT, admin→all).
                  const canReview = ['registered', 'verified', 'approved', 'rejected', 'resubmit'].includes(inv.status)
                  return (
                    <tr key={inv.id} className="border-b last:border-0 dark:border-gray-700">
                      <td className="py-2.5 pr-3">
                        {canReview ? (
                          <button
                            onClick={() => setReviewing(inv)}
                            className="group flex items-center gap-1 text-left font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                            title="View onboarding progress & documents"
                          >
                            {inv.name || '—'}
                            <Eye className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                          </button>
                        ) : (
                          <div className="font-medium text-gray-800 dark:text-gray-200">{inv.name || '—'}</div>
                        )}
                        <div className="text-xs text-gray-400">{inv.email}</div>
                        <div className="text-xs text-gray-400">{inv.phone}</div>
                      </td>
                      <td className="py-2.5 pr-3 text-gray-600 dark:text-gray-300">{ROLE_LABEL[inv.target_role] || inv.target_role}</td>
                      <td className="py-2.5 pr-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[inv.status] || 'bg-gray-100'}`}>{inv.status}</span>
                      </td>
                      <td className="py-2.5 pr-3">
                        {inv.progress ? (
                          <div className="min-w-[120px]">
                            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                              <span className="font-medium text-gray-600 dark:text-gray-300">{inv.progress.currentLabel}</span>
                              <span className="text-gray-400">{inv.progress.percent}%</span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                              <div
                                className={`h-full rounded-full ${inv.progress.complete ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                                style={{ width: `${Math.max(4, inv.progress.percent)}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
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
                              <IconBtn title="Resend link (Email + SMS)" tone="indigo" disabled={rowBusy} onClick={() => act(inv.id, 'resend')}>
                                {rowBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                              </IconBtn>
                            </>
                          )}
                          {canReshare && (
                            <IconBtn title="Generate a fresh link & reshare" tone="amber" disabled={rowBusy} onClick={() => act(inv.id, 'reshare')}>
                              {rowBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            </IconBtn>
                          )}
                          {canReview && (
                            <IconBtn title="View KYC details" tone="indigo" onClick={() => setReviewing(inv)}><Eye className="h-4 w-4" /></IconBtn>
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

      {reviewing && (
        <KycReviewModal
          invite={reviewing}
          canApprove={adminMode && isAdmin && ['registered', 'verified'].includes(reviewing.status)}
          canResend={adminMode && isAdmin && ['approved', 'rejected', 'resubmit'].includes(reviewing.status)}
          onAction={async (action) => {
            await act(reviewing.id, action)
            setReviewing(null)
          }}
          onChanged={async () => {
            await load()
            setReviewing(null)
          }}
          onClose={() => setReviewing(null)}
        />
      )}
    </div>
  )
}

// ── Admin KYC review ─────────────────────────────────────────────────────────

interface VerificationRow {
  type: string
  status: string
  verified_name?: string | null
  response_payload?: Record<string, any> | null
  media_url?: string | null
  updated_at?: string
}

const DOC_LABELS: Record<string, string> = {
  DOCUMENT_SELFIE: 'Live Selfie',
  ONBOARD_VIDEO: 'Liveness Video',
  SELF_DECLARATION: 'Signed Self-Declaration',
}

function docTitle(type: string): string {
  if (DOC_LABELS[type]) return DOC_LABELS[type]
  if (type.startsWith('DOCUMENT_')) {
    return type
      .replace('DOCUMENT_', '')
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  }
  return type
}

function KycField({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">{value}</p>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const ok = status === 'Success' || status === 'Uploaded'
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ok ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
      {status}
    </span>
  )
}

function KycReviewModal({
  invite,
  canApprove,
  canResend,
  onAction,
  onChanged,
  onClose,
}: {
  invite: InviteRow
  canApprove: boolean
  canResend: boolean
  onAction: (action: 'approve' | 'reject') => Promise<void>
  onChanged: () => Promise<void>
  onClose: () => void
}) {
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [rows, setRows] = useState<VerificationRow[]>([])
  const [detail, setDetail] = useState<any>(null)
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null)
  const [zipping, setZipping] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)
  // Per-item re-submission flags: verification type -> remark shown to applicant.
  const [rejects, setRejects] = useState<Record<string, string>>({})
  const [sendingRejects, setSendingRejects] = useState(false)
  const [resending, setResending] = useState(false)

  const flagged = (type: string) => type in rejects
  const toggleFlag = (type: string) =>
    setRejects((p) => {
      const n = { ...p }
      if (type in n) delete n[type]
      else n[type] = ''
      return n
    })
  const setReason = (type: string, reason: string) => setRejects((p) => ({ ...p, [type]: reason }))
  const rejectList = Object.entries(rejects).map(([type, reason]) => ({ type, reason: reason.trim() }))
  const canSendRejects = rejectList.length > 0 && rejectList.every((r) => r.reason.length > 0)

  async function submitRejects() {
    if (!canSendRejects) {
      setErr('Add a remark for each flagged item before sending.')
      return
    }
    setErr('')
    setSendingRejects(true)
    try {
      const res = await apiFetch(`/api/onboarding/invite/${invite.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'reject_items', items: rejectList }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to request re-submission')
      const parts = [data.emailSent && 'email', data.smsSent && 'SMS'].filter(Boolean)
      showToast(parts.length ? `Re-submission requested — link sent via ${parts.join(' & ')}` : 'Re-submission requested — delivery pending', parts.length ? 'success' : 'info')
      await onChanged()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setSendingRejects(false)
    }
  }

  async function resendDecision() {
    setErr('')
    setResending(true)
    try {
      const res = await apiFetch(`/api/onboarding/invite/${invite.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'resend_decision' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to resend')
      const parts = [data.emailSent && 'email', data.smsSent && 'SMS'].filter(Boolean)
      showToast(parts.length ? `Email resent via ${parts.join(' & ')}` : 'Resend attempted — delivery pending', parts.length ? 'success' : 'info')
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setResending(false)
    }
  }

  function renderReject(type: string) {
    if (!canApprove) return null
    const on = flagged(type)
    return (
      <div className="mt-2">
        <button
          type="button"
          onClick={() => toggleFlag(type)}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold transition-colors ${
            on ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40' : 'text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20'
          }`}
        >
          <XCircle className="h-3 w-3" /> {on ? 'Flagged — will ask to re-submit' : 'Reject / request change'}
        </button>
        {on && (
          <textarea
            value={rejects[type]}
            onChange={(e) => setReason(type, e.target.value)}
            placeholder="Remark for the applicant (why it must be re-submitted)…"
            rows={2}
            className="mt-1 w-full rounded-md border border-rose-200 px-2 py-1 text-xs focus:border-rose-400 focus:outline-none dark:border-rose-800 dark:bg-gray-900 dark:text-gray-200"
          />
        )}
      </div>
    )
  }

  useEffect(() => {
    let cancelled = false
    apiFetch(`/api/onboarding/invite/${invite.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return
        if (!d.success) throw new Error(d.error || 'Failed to load KYC details')
        setRows(d.verifications || [])
        setDetail(d.invite || null)
      })
      .catch((e) => !cancelled && setErr(e.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [invite.id])

  const byType = new Map(rows.map((r) => [r.type, r]))
  const pan = byType.get('PAN_360')
  const aadhaar = byType.get('AADHAAR_DIGILOCKER')
  const bank = byType.get('BANK_PENNY_DROP')
  const gst = byType.get('GST')
  const business = byType.get('BUSINESS_NAME')
  const mediaRows = rows.filter(
    (r) => r.media_url && (r.type.startsWith('DOCUMENT_') || r.type === 'ONBOARD_VIDEO' || r.type === 'SELF_DECLARATION')
  )

  const verifiedMap: Record<string, string> = {}
  rows.forEach((r) => { verifiedMap[r.type] = r.status })
  const stepInvite: any = detail || invite
  const progress = computeOnboardingProgress(stepInvite, verifiedMap, stepInvite.target_role)

  function stepDetail(key: string): string {
    switch (key) {
      case 'mobile': return stepInvite.phone || invite.phone || ''
      case 'email': return stepInvite.email || invite.email || ''
      case 'aadhaar': return aadhaar?.response_payload?.name || ''
      case 'pan': return pan?.response_payload?.pan || pan?.verified_name || ''
      case 'bank': return bank?.response_payload?.nameAtBank || bank?.response_payload?.account_number || ''
      case 'business': return business?.verified_name || gst?.response_payload?.legal_name_of_business || ''
      case 'selfie_video':
        return [verifiedMap['DOCUMENT_SELFIE'] === 'Uploaded' && 'Selfie', verifiedMap['ONBOARD_VIDEO'] === 'Uploaded' && 'Video']
          .filter(Boolean).join(' + ')
      case 'documents': {
        const n = mediaRows.filter((m) => m.type.startsWith('DOCUMENT_') && m.type !== 'DOCUMENT_SELFIE').length
        return n ? `${n} file${n > 1 ? 's' : ''} uploaded` : ''
      }
      case 'declaration': return verifiedMap['SELF_DECLARATION'] === 'Uploaded' ? 'Signed' : ''
      case 'finish': return stepInvite.created_partner_id || ''
      default: return ''
    }
  }

  async function run(action: 'approve' | 'reject') {
    setActing(action)
    try {
      await onAction(action)
    } finally {
      setActing(null)
    }
  }

  function mediaExt(m: VerificationRow): string {
    const clean = (m.media_url as string).split('?')[0]
    const match = clean.match(/\.([a-z0-9]+)$/i)
    if (match) return match[1].toLowerCase()
    if (m.type === 'ONBOARD_VIDEO') return 'webm'
    if (m.type === 'SELF_DECLARATION') return 'pdf'
    return 'jpg'
  }

  function saveBlob(blob: Blob, filename: string) {
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 2000)
  }

  async function downloadOne(m: VerificationRow) {
    const res = await fetch(m.media_url as string)
    if (!res.ok) throw new Error('Download failed')
    saveBlob(await res.blob(), `${docTitle(m.type)}.${mediaExt(m)}`)
  }

  async function downloadAll() {
    setErr('')
    setZipping(true)
    try {
      const base = (invite.name || invite.email || 'onboarding').replace(/[^\w.-]+/g, '_')
      const zip = new JSZip()
      const folder = zip.folder(base) || zip
      let added = 0
      for (const m of mediaRows) {
        try {
          const res = await fetch(m.media_url as string)
          if (!res.ok) continue
          folder.file(`${docTitle(m.type)}.${mediaExt(m)}`, await res.blob())
          added++
        } catch {
          /* skip unreachable file, keep zipping the rest */
        }
      }
      if (!added) throw new Error('Could not fetch any media files.')
      const content = await zip.generateAsync({ type: 'blob' })
      saveBlob(content, `${base}-KYC.zip`)
    } catch (e: any) {
      setErr(e.message || 'Download all failed')
    } finally {
      setZipping(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-gray-700">
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">KYC Review — {invite.name || invite.email}</h3>
            <p className="truncate text-xs text-gray-400">
              {ROLE_LABEL[invite.target_role] || invite.target_role} · {invite.email} · {invite.phone}
              {invite.created_partner_id ? ` · Partner ID: ${invite.created_partner_id}` : ''}
            </p>
            {invite.progress && (
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 w-40 max-w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <div
                    className={`h-full rounded-full ${invite.progress.complete ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                    style={{ width: `${Math.max(4, invite.progress.percent)}%` }}
                  />
                </div>
                <span className="text-xs font-medium text-gray-500">
                  {invite.progress.complete ? 'All steps complete' : `Reached: ${invite.progress.currentLabel}`} · {invite.progress.percent}%
                </span>
              </div>
            )}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : err ? (
            <div className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{err}</div>
          ) : (
            <div className="space-y-5">
              {/* Step-by-step onboarding progress */}
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="flex items-center gap-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">
                    <Clock className="h-4 w-4 text-indigo-600" /> Onboarding Progress
                  </h4>
                  <span className="text-xs font-semibold text-gray-500">
                    {progress.completedCount}/{progress.totalCount} steps · {progress.percent}%
                    {progress.complete && <span className="ml-1 text-emerald-600">· Completed</span>}
                  </span>
                </div>
                <ol className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
                  {ONBOARD_STEPS.map((s, i) => {
                    if (s.key === 'welcome') return null
                    const done = progress.states[i]
                    const current = !progress.complete && i === progress.currentIndex
                    const info = stepDetail(s.key)
                    return (
                      <li
                        key={s.key}
                        className={`flex items-center gap-2.5 border-b border-gray-100 px-3 py-2 last:border-0 dark:border-gray-700/60 ${
                          current ? 'bg-indigo-50/70 dark:bg-indigo-900/20' : ''
                        }`}
                      >
                        <span className="shrink-0">
                          {done ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          ) : current ? (
                            <span className="flex h-4 w-4 items-center justify-center">
                              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-indigo-500" />
                            </span>
                          ) : (
                            <span className="block h-4 w-4 rounded-full border-2 border-gray-200 dark:border-gray-600" />
                          )}
                        </span>
                        <span className="flex-1 truncate text-sm text-gray-700 dark:text-gray-300">
                          {s.label}
                          {info && <span className="ml-1.5 text-xs text-gray-400">— {info}</span>}
                        </span>
                        <span
                          className={`shrink-0 text-xs font-semibold ${
                            done ? 'text-emerald-600' : current ? 'text-indigo-600' : 'text-gray-300 dark:text-gray-500'
                          }`}
                        >
                          {done ? 'Done' : current ? 'In progress' : 'Pending'}
                        </span>
                      </li>
                    )
                  })}
                </ol>
              </section>

              {/* Identity verifications */}
              <section>
                <h4 className="mb-2 flex items-center gap-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">
                  <ShieldCheck className="h-4 w-4 text-indigo-600" /> Identity Verifications
                </h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 dark:text-gray-200"><User className="h-4 w-4 text-gray-400" /> PAN</span>
                      {pan ? <StatusPill status={pan.status} /> : <span className="text-xs text-gray-400">Not done</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <KycField label="PAN" value={pan?.response_payload?.pan} />
                      <KycField label="Name" value={pan?.verified_name || pan?.response_payload?.registered_name} />
                      <KycField label="DOB" value={pan?.response_payload?.date_of_birth} />
                      <KycField label="Aadhaar linked" value={pan?.response_payload?.aadhaar_linked !== undefined ? String(pan.response_payload.aadhaar_linked) : null} />
                    </div>
                    {renderReject('PAN_360')}
                  </div>
                  <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 dark:text-gray-200"><ShieldCheck className="h-4 w-4 text-gray-400" /> Aadhaar (DigiLocker)</span>
                      {aadhaar ? <StatusPill status={aadhaar.status} /> : <span className="text-xs text-gray-400">Not done</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <KycField label="Name" value={aadhaar?.response_payload?.name} />
                      <KycField label="UID" value={aadhaar?.response_payload?.uid} />
                      <KycField label="DOB" value={aadhaar?.response_payload?.dob} />
                      <KycField label="Gender" value={aadhaar?.response_payload?.gender} />
                    </div>
                    <KycField label="Address" value={aadhaar?.response_payload?.address} />
                    {renderReject('AADHAAR_DIGILOCKER')}
                  </div>
                  <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 dark:text-gray-200"><Landmark className="h-4 w-4 text-gray-400" /> Bank (Penny Drop)</span>
                      {bank ? <StatusPill status={bank.status} /> : <span className="text-xs text-gray-400">Not done</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <KycField label="Name at bank" value={bank?.response_payload?.nameAtBank} />
                      <KycField label="Account" value={bank?.response_payload?.account_number} />
                      <KycField label="IFSC" value={bank?.response_payload?.ifsc} />
                      <KycField label="UTR" value={bank?.response_payload?.utr} />
                    </div>
                    {renderReject('BANK_PENNY_DROP')}
                  </div>
                  <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-800 dark:text-gray-200"><FileText className="h-4 w-4 text-gray-400" /> Business / GST</span>
                      {gst ? <StatusPill status={gst.status} /> : <span className="text-xs text-gray-400">GST not provided</span>}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <KycField label="Business name" value={business?.verified_name} />
                      <KycField label="GSTIN" value={gst?.response_payload?.GSTIN} />
                      <KycField label="Legal name" value={gst?.response_payload?.legal_name_of_business} />
                      <KycField label="GST status" value={gst?.response_payload?.gst_in_status} />
                    </div>
                    {renderReject('BUSINESS_NAME')}
                  </div>
                </div>
              </section>

              {/* Media & documents */}
              <section>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h4 className="flex items-center gap-1.5 text-sm font-bold text-gray-700 dark:text-gray-300">
                    <VideoIcon className="h-4 w-4 text-indigo-600" /> Selfie, Video &amp; Documents
                    {mediaRows.length > 0 && <span className="text-xs font-normal text-gray-400">({mediaRows.length})</span>}
                  </h4>
                  {mediaRows.length > 0 && (
                    <button
                      onClick={downloadAll}
                      disabled={zipping}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:bg-gray-300"
                    >
                      {zipping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      {zipping ? 'Zipping…' : 'Download all'}
                    </button>
                  )}
                </div>
                {mediaRows.length === 0 ? (
                  <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-400 dark:bg-gray-900">No media available yet.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {mediaRows.map((m) => {
                      const url = m.media_url as string
                      const isVideo = m.type === 'ONBOARD_VIDEO' || /\.(webm|mp4)(\?|$)/i.test(url)
                      const isPdf = /\.pdf(\?|$)/i.test(url)
                      return (
                        <div key={m.type} className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
                          <div className="flex h-32 items-center justify-center bg-gray-50 dark:bg-gray-900">
                            {isVideo ? (
                              // eslint-disable-next-line jsx-a11y/media-has-caption
                              <video src={url} controls className="h-full w-full object-contain" preload="metadata" />
                            ) : isPdf ? (
                              <a href={url} target="_blank" rel="noopener noreferrer" className="flex flex-col items-center gap-1 text-indigo-600 hover:underline">
                                <FileText className="h-8 w-8" />
                                <span className="text-xs font-medium">Open PDF</span>
                              </a>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setLightbox(url)}
                                className="group relative h-full w-full"
                                title="Click to enlarge"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={url} alt={docTitle(m.type)} className="h-full w-full object-cover" />
                                <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white/0 transition-colors group-hover:bg-black/30 group-hover:text-white">
                                  <ZoomIn className="h-6 w-6" />
                                </span>
                              </button>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                            <span className="truncate text-xs font-medium text-gray-600 dark:text-gray-300">{docTitle(m.type)}</span>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <button
                                onClick={() => downloadOne(m).catch((e) => setErr(e.message))}
                                title="Download"
                                className="text-gray-400 hover:text-indigo-600"
                              >
                                <Download className="h-3.5 w-3.5" />
                              </button>
                              <a href={url} target="_blank" rel="noopener noreferrer" title="Open in new tab" className="text-gray-400 hover:text-indigo-600">
                                <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            </div>
                          </div>
                          {(m.response_payload?.lat != null || m.response_payload?.ip) && (
                            <div className="space-y-0.5 border-t border-gray-100 px-2 py-1 text-[10px] leading-tight text-gray-400 dark:border-gray-700">
                              {m.response_payload?.lat != null && m.response_payload?.lng != null && (
                                <a
                                  href={`https://maps.google.com/?q=${m.response_payload.lat},${m.response_payload.lng}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block truncate text-indigo-500 hover:underline"
                                >
                                  📍 {Number(m.response_payload.lat).toFixed(5)}, {Number(m.response_payload.lng).toFixed(5)}
                                  {m.response_payload?.accuracy != null ? ` · ±${Math.round(Number(m.response_payload.accuracy))}m` : ''}
                                </a>
                              )}
                              {m.response_payload?.ip && <div className="truncate">IP: {m.response_payload.ip}</div>}
                            </div>
                          )}
                          {canApprove && <div className="border-t border-gray-100 px-2 pb-2 pt-1 dark:border-gray-700">{renderReject(m.type)}</div>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-6 py-4 dark:border-gray-700">
          <div className="text-xs font-medium text-gray-500">
            {rejectList.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-1 text-rose-600 dark:bg-rose-900/30">
                <XCircle className="h-3.5 w-3.5" /> {rejectList.length} item{rejectList.length > 1 ? 's' : ''} flagged for re-submission
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-300">
              Close
            </button>
            {canResend && (
              <button
                onClick={resendDecision}
                disabled={resending || loading}
                title="Resend the last decision email/SMS to the applicant"
                className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300"
              >
                {resending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Resend {invite.status === 'approved' ? 'approval' : invite.status === 'rejected' ? 'rejection' : 're-submit'} email
              </button>
            )}
            {canApprove && rejectList.length > 0 && (
              <button
                onClick={submitRejects}
                disabled={!canSendRejects || sendingRejects || loading}
                title={canSendRejects ? 'Send re-submission request with your remarks' : 'Add a remark for each flagged item'}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:bg-gray-300"
              >
                {sendingRejects ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Request re-submission ({rejectList.length})
              </button>
            )}
            {canApprove && rejectList.length === 0 && (
              <>
                <button
                  onClick={() => run('reject')}
                  disabled={!!acting || loading}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:bg-gray-300"
                >
                  {acting === 'reject' ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Reject
                </button>
                <button
                  onClick={() => run('approve')}
                  disabled={!!acting || loading}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-gray-300"
                >
                  {acting === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Approve KYC
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={(e) => {
            e.stopPropagation()
            setLightbox(null)
          }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setLightbox(null) }}
            className="absolute right-4 top-4 rounded-lg bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt="Preview"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
          />
          <a
            href={lightbox}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-4 right-4 inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-sm text-white hover:bg-white/20"
          >
            <ExternalLink className="h-4 w-4" /> Open original
          </a>
        </div>
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
      const parts = [data.emailSent && 'email', data.smsSent && 'SMS'].filter(Boolean)
      showToast(
        parts.length ? `Invite updated & new link sent via ${parts.join(' & ')}` : 'Invite updated — delivery failed, use Resend',
        parts.length ? 'success' : 'info'
      )
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
