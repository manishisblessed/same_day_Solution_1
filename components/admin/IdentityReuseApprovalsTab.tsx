'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'
import { useToast } from '@/components/Toast'
import { RefreshCw, Check, X, Fingerprint, Loader2 } from 'lucide-react'

interface ConflictAccount {
  role: string
  partner_id: string | null
  name: string | null
  status: string | null
}

interface ReuseRequest {
  id: string
  pan_number: string
  target_role: string
  status: 'pending' | 'approved' | 'rejected'
  reason: string | null
  conflicting_accounts: ConflictAccount[]
  created_at: string
  reviewed_at: string | null
  invite: {
    name: string | null
    email: string
    phone: string
    target_role: string
    status: string
  } | null
}

const ROLE_LABEL: Record<string, string> = {
  master_distributor: 'Master Distributor',
  distributor: 'Distributor',
  retailer: 'Retailer',
}
const roleLabel = (r: string) => ROLE_LABEL[r] || r

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
}

export default function IdentityReuseApprovalsTab() {
  const { showToast } = useToast()
  const [requests, setRequests] = useState<ReuseRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending')
  const [actioningId, setActioningId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = statusFilter === 'all' ? '' : `?status=${statusFilter}`
      const res = await apiFetch(`/api/admin/identity-reuse-requests${qs}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load requests')
      setRequests(data.requests || [])
    } catch (e: any) {
      showToast(e.message || 'Failed to load requests', 'error')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, showToast])

  useEffect(() => {
    load()
  }, [load])

  async function act(id: string, action: 'approve' | 'reject') {
    let reason: string | undefined
    if (action === 'reject') {
      reason = window.prompt('Reason for rejection (shared with the applicant):') || undefined
      if (reason === undefined) return // cancelled
    } else {
      if (!window.confirm('Approve reuse of this PAN for an additional role account?')) return
    }
    setActioningId(id)
    try {
      const res = await apiFetch(`/api/admin/identity-reuse-requests/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action, reason }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Failed to ${action}`)
      showToast(`Request ${action === 'approve' ? 'approved' : 'rejected'}`, 'success')
      load()
    } catch (e: any) {
      showToast(e.message || `Failed to ${action}`, 'error')
    } finally {
      setActioningId(null)
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <Fingerprint className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Identity Reuse Approvals</h2>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="text-sm border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1.5 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
        A person may hold MD / DT / RT accounts under one PAN, but never two of the same role. Approving lets this
        onboarding finish with a PAN that already belongs to a different role account.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
        </div>
      ) : requests.length === 0 ? (
        <div className="text-center py-12 text-sm text-gray-500 dark:text-gray-400">No {statusFilter === 'all' ? '' : statusFilter} requests.</div>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <div key={r.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 dark:text-white">{r.invite?.name || '—'}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[r.status]}`}>{r.status}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                      Applying as {roleLabel(r.target_role)}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                    {r.invite?.email} · {r.invite?.phone}
                  </div>
                  <div className="mt-1 text-sm text-gray-700 dark:text-gray-200">
                    PAN: <span className="font-mono">{r.pan_number}</span>
                  </div>
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    Already holds:
                    <ul className="mt-1 space-y-0.5">
                      {(r.conflicting_accounts || []).map((c, i) => (
                        <li key={i} className="text-gray-700 dark:text-gray-200">
                          • {roleLabel(c.role)} {c.partner_id ? `(${c.partner_id})` : ''} {c.name ? `— ${c.name}` : ''}
                          {c.status ? ` [${c.status}]` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {r.reason && (
                    <div className="mt-2 text-xs text-red-600">Reason: {r.reason}</div>
                  )}
                </div>

                {r.status === 'pending' && (
                  <div className="flex items-center gap-2">
                    <button
                      disabled={actioningId === r.id}
                      onClick={() => act(r.id, 'approve')}
                      className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      <Check className="w-4 h-4" /> Approve
                    </button>
                    <button
                      disabled={actioningId === r.id}
                      onClick={() => act(r.id, 'reject')}
                      className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      <X className="w-4 h-4" /> Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
