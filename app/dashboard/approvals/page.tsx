'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api-client'
import { useAuth } from '@/contexts/AuthContext'
import DashboardChrome from '@/components/DashboardChrome'

interface Approval {
  id: string
  invite_id: string
  onboardee_role_label: string
  status: string
  created_at: string
  invitee?: { name?: string; email?: string; phone?: string } | null
}

export default function ApprovalsPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!loading && user && !['master_distributor', 'distributor'].includes(user.role)) {
      router.replace('/business-login')
    }
  }, [user, loading, router])

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/onboarding/approvals/pending')
      const data = await res.json()
      if (data.success) setApprovals(data.approvals)
    } catch (e: any) {
      setErr(e.message)
    }
  }, [])

  useEffect(() => {
    if (user) load()
  }, [user, load])

  async function act(id: string, action: 'approve' | 'reject') {
    setBusy(true)
    setErr('')
    setMsg('')
    try {
      const body: any = {}
      if (action === 'reject') body.reason = prompt('Reason for rejection?') || 'Rejected'
      // Try to attach location for approvals (best-effort).
      if (action === 'approve' && navigator.geolocation) {
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              body.latitude = pos.coords.latitude
              body.longitude = pos.coords.longitude
              resolve()
            },
            () => resolve(),
            { timeout: 5000 }
          )
        })
      }
      const res = await apiFetch(`/api/onboarding/approvals/${id}/${action}`, { method: 'POST', body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Action failed')
      setMsg(`Declaration ${action}d.`)
      await load()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>
  if (!user) return null

  return (
    <DashboardChrome>
      <div className="p-4 sm:p-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-1 text-2xl font-bold text-gray-900 dark:text-white">Onboarding Approvals</h1>
        <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">Review and approve declarations from partners you invited.</p>

        {err && <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}
        {msg && <div className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{msg}</div>}

        <div className="rounded-2xl bg-white p-5 shadow ring-1 ring-gray-100">
          {approvals.length === 0 ? (
            <p className="text-sm text-gray-400">No pending approvals.</p>
          ) : (
            <div className="space-y-3">
              {approvals.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg border border-gray-200 p-3">
                  <div>
                    <p className="font-medium text-gray-800">{a.invitee?.name || a.invitee?.email || 'Applicant'}</p>
                    <p className="text-xs text-gray-400">
                      {a.onboardee_role_label} · {a.invitee?.phone || ''} {a.invitee?.email || ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => act(a.id, 'approve')} disabled={busy} className="rounded-lg bg-green-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-green-700 disabled:bg-gray-300">Approve</button>
                    <button onClick={() => act(a.id, 'reject')} disabled={busy} className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:bg-gray-300">Reject</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>
    </DashboardChrome>
  )
}
