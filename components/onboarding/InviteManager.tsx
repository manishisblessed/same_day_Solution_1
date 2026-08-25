'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { useAuth } from '@/contexts/AuthContext'

interface InviteRow {
  id: string
  email: string
  phone: string
  name?: string
  target_role: string
  status: string
  created_at: string
  created_partner_id?: string | null
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  registered: 'bg-blue-100 text-blue-700',
  verified: 'bg-indigo-100 text-indigo-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  expired: 'bg-amber-100 text-amber-700',
  resubmit: 'bg-purple-100 text-purple-700',
}

const ROLE_LABEL: Record<string, string> = {
  master_distributor: 'Master Distributor',
  distributor: 'Distributor',
  retailer: 'Retailer',
}

/**
 * Reusable onboarding invite manager. Behaviour adapts to the current role:
 *  - admin: choose any target role + parent picker; can approve/reject KYC.
 *  - MD/DT: single fixed target role; approve/reject hidden.
 */
export default function InviteManager({ adminMode = false }: { adminMode?: boolean }) {
  const { user } = useAuth()
  const [invites, setInvites] = useState<InviteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const [role, setRole] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [parents, setParents] = useState<{ partner_id: string; name: string }[]>([])
  const [parentId, setParentId] = useState('')
  const [creating, setCreating] = useState(false)
  const [lastLink, setLastLink] = useState('')

  const isAdmin = user?.role === 'admin' || user?.role === 'finance_executive'

  const defaultTargetRole =
    user?.role === 'master_distributor' ? 'distributor' : user?.role === 'distributor' ? 'retailer' : ''

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/onboarding/invite?pageSize=100')
      const data = await res.json()
      if (data.success) setInvites(data.invites)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Load parent options for the admin picker when target role is DT/RT.
  useEffect(() => {
    const target = isAdmin ? role : defaultTargetRole
    if (isAdmin && (target === 'distributor' || target === 'retailer')) {
      apiFetch(`/api/onboarding/invite/parents?role=${target}`)
        .then((r) => r.json())
        .then((d) => setParents(d.parents || []))
        .catch(() => setParents([]))
    } else {
      setParents([])
      setParentId('')
    }
  }, [role, isAdmin, defaultTargetRole])

  async function createInvite() {
    setErr('')
    setMsg('')
    setLastLink('')
    setCreating(true)
    try {
      const targetRole = isAdmin ? role : defaultTargetRole
      const body: any = { email, phone, name, role: targetRole }
      if (isAdmin && targetRole === 'distributor') body.parent_master_distributor_id = parentId
      if (isAdmin && targetRole === 'retailer') body.parent_distributor_id = parentId
      const res = await apiFetch('/api/onboarding/invite', { method: 'POST', body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create invite')
      setMsg('Invite created and link sent.')
      setLastLink(data.link)
      setEmail('')
      setPhone('')
      setName('')
      await load()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setCreating(false)
    }
  }

  async function act(id: string, action: string) {
    setErr('')
    setMsg('')
    try {
      const body: any = { action }
      if (action === 'reject') body.reason = prompt('Reason for rejection?') || 'Rejected'
      const res = await apiFetch(`/api/onboarding/invite/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Action failed')
      if (data.link) setLastLink(data.link)
      setMsg(`Invite ${action} done.`)
      await load()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-white p-5 shadow ring-1 ring-gray-100">
        <h3 className="mb-3 text-base font-bold text-gray-900">Invite a New Partner</h3>
        {err && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
        {msg && <div className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</div>}
        {lastLink && (
          <div className="mb-3 break-all rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
            Link: {lastLink}
          </div>
        )}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {isAdmin && (
            <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">Select role…</option>
              <option value="master_distributor">Master Distributor</option>
              <option value="distributor">Distributor</option>
              <option value="retailer">Retailer</option>
            </select>
          )}
          {!isAdmin && (
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
              Onboarding: <strong>{ROLE_LABEL[defaultTargetRole] || defaultTargetRole}</strong>
            </div>
          )}
          {isAdmin && parents.length > 0 && (
            <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">Select parent…</option>
              {parents.map((p) => (
                <option key={p.partner_id} value={p.partner_id}>{p.name} ({p.partner_id})</option>
              ))}
            </select>
          )}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email *" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (10-digit) *" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <button
          onClick={createInvite}
          disabled={creating || !email || !phone || (isAdmin && !role)}
          className="mt-3 rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:bg-gray-300"
        >
          {creating ? 'Creating…' : 'Send Invite'}
        </button>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow ring-1 ring-gray-100">
        <h3 className="mb-3 text-base font-bold text-gray-900">Invites</h3>
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : invites.length === 0 ? (
          <p className="text-sm text-gray-400">No invites yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs uppercase text-gray-400">
                  <th className="py-2">Name / Email</th>
                  <th className="py-2">Role</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Partner ID</th>
                  <th className="py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv.id} className="border-b last:border-0">
                    <td className="py-2">
                      <div className="font-medium text-gray-800">{inv.name || '—'}</div>
                      <div className="text-xs text-gray-400">{inv.email}</div>
                    </td>
                    <td className="py-2 text-gray-600">{ROLE_LABEL[inv.target_role] || inv.target_role}</td>
                    <td className="py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[inv.status] || 'bg-gray-100'}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="py-2 text-xs text-gray-500">{inv.created_partner_id || '—'}</td>
                    <td className="py-2 text-right">
                      <div className="flex justify-end gap-1">
                        {['pending', 'registered', 'verified', 'resubmit'].includes(inv.status) && (
                          <button onClick={() => act(inv.id, 'resend')} className="rounded px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50">Resend</button>
                        )}
                        {adminMode && isAdmin && ['registered', 'verified'].includes(inv.status) && (
                          <>
                            <button onClick={() => act(inv.id, 'approve')} className="rounded bg-green-600 px-2 py-1 text-xs font-semibold text-white hover:bg-green-700">Approve</button>
                            <button onClick={() => act(inv.id, 'reject')} className="rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700">Reject</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
