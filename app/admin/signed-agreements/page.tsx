'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Menu, FileSignature, Download, RefreshCw, Loader2, CheckCircle2, Clock, XCircle, FileText, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import AdminSidebar from '@/components/AdminSidebar'
import { apiFetch } from '@/lib/api-client'

interface Signer {
  name: string
  email?: string
  phone?: string
  status: string
  signType?: string
  signedAt?: string
}

interface Agreement {
  documentId: string
  irn?: string
  documentName: string
  status: string
  hasSignedFile: boolean
  hasAuditTrail: boolean
  createdAt: string
  updatedAt: string
  partner: {
    name?: string
    email?: string
    phone?: string
    role: string
    roleLabel: string
    inviteStatus: string
    partnerId?: string | null
  } | null
  signers: Signer[]
}

const STATUS_BADGE: Record<string, string> = {
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  'IN PROGRESS': 'bg-amber-100 text-amber-800',
  EXPIRED: 'bg-gray-100 text-gray-600',
  DELETED: 'bg-rose-100 text-rose-800',
}

function StatusBadge({ status }: { status: string }) {
  const Icon = status === 'COMPLETED' ? CheckCircle2 : status === 'IN PROGRESS' ? Clock : XCircle
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[status] || 'bg-gray-100 text-gray-600'}`}>
      <Icon className="h-3 w-3" />
      {status}
    </span>
  )
}

export default function SignedAgreementsPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [agreements, setAgreements] = useState<Agreement[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState<string>('')
  const [downloading, setDownloading] = useState<string>('')

  useEffect(() => {
    if (!loading && user && user.role !== 'admin' && user.role !== 'finance_executive') {
      router.replace('/admin')
    }
  }, [user, loading, router])

  const load = useCallback(async () => {
    setBusy(true)
    setErr('')
    try {
      const qs = filter ? `?status=${encodeURIComponent(filter)}` : ''
      const res = await apiFetch(`/api/admin/esign/list${qs}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setAgreements(data.agreements || [])
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }, [filter])

  useEffect(() => {
    if (user) load()
  }, [user, load])

  async function download(documentId: string, type: 'DOCUMENT' | 'AUDIT_TRAIL') {
    setDownloading(`${documentId}-${type}`)
    try {
      const res = await apiFetch(`/api/admin/esign/download?documentId=${encodeURIComponent(documentId)}&type=${type}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Download failed')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${type === 'AUDIT_TRAIL' ? 'audit-trail' : 'agreement'}-${documentId}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setDownloading('')
    }
  }

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>
  if (!user) return null

  const completed = agreements.filter((a) => a.status === 'COMPLETED').length
  const inProgress = agreements.filter((a) => a.status === 'IN PROGRESS').length

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 overflow-x-hidden">
      <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 lg:ml-56 min-w-0 overflow-x-hidden pt-16">
        <button
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden fixed top-20 left-2 z-30 p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700"
        >
          <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
        </button>

        <div className="p-4 sm:p-8">
          <div className="mx-auto max-w-6xl">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white">
                  <FileSignature className="h-6 w-6 text-indigo-600" /> Signed Agreements
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Partner agreement eSign status &amp; signed document downloads.
                </p>
              </div>
              <button
                onClick={load}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
              >
                <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>

            {/* Stats */}
            <div className="mb-5 grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                <p className="text-xs text-gray-500">Total</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{agreements.length}</p>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 dark:border-emerald-900/40 dark:bg-emerald-900/10">
                <p className="text-xs text-emerald-600">Signed</p>
                <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{completed}</p>
              </div>
              <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-4 dark:border-amber-900/40 dark:bg-amber-900/10">
                <p className="text-xs text-amber-600">Pending</p>
                <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{inProgress}</p>
              </div>
            </div>

            {/* Filter */}
            <div className="mb-4 flex gap-2">
              {['', 'COMPLETED', 'IN PROGRESS', 'EXPIRED'].map((s) => (
                <button
                  key={s || 'all'}
                  onClick={() => setFilter(s)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    filter === s ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300'
                  }`}
                >
                  {s || 'All'}
                </button>
              ))}
            </div>

            {err && (
              <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{err}</div>
            )}

            {/* List */}
            <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white dark:border-gray-700 dark:bg-gray-800">
              {busy && !agreements.length ? (
                <div className="flex items-center justify-center gap-2 p-10 text-gray-400">
                  <Loader2 className="h-5 w-5 animate-spin" /> Loading agreements…
                </div>
              ) : !agreements.length ? (
                <div className="p-10 text-center text-sm text-gray-400">No agreements found.</div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-700">
                  {agreements.map((a) => (
                    <div key={a.documentId} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-semibold text-gray-900 dark:text-white">
                            {a.partner?.name || a.signers[0]?.name || 'Unknown'}
                          </p>
                          <StatusBadge status={a.status} />
                        </div>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {a.partner?.roleLabel || '—'}
                          {a.partner?.phone ? ` · ${a.partner.phone}` : ''}
                          {a.partner?.email ? ` · ${a.partner.email}` : ''}
                        </p>
                        <p className="mt-0.5 text-[11px] text-gray-400">
                          Doc: {a.documentId}
                          {a.signers[0]?.signedAt ? ` · Signed ${new Date(a.signers[0].signedAt).toLocaleString('en-IN')}` : ''}
                          {a.partner?.partnerId ? ` · Partner ID: ${a.partner.partnerId}` : ''}
                        </p>
                      </div>

                      <div className="flex shrink-0 gap-2">
                        <button
                          onClick={() => download(a.documentId, 'DOCUMENT')}
                          disabled={a.status !== 'COMPLETED' || downloading === `${a.documentId}-DOCUMENT`}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-indigo-900/20 dark:text-indigo-300"
                          title={a.status !== 'COMPLETED' ? 'Available after signing completes' : 'Download signed agreement'}
                        >
                          {downloading === `${a.documentId}-DOCUMENT` ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <FileText className="h-3.5 w-3.5" />
                          )}
                          Agreement
                        </button>
                        <button
                          onClick={() => download(a.documentId, 'AUDIT_TRAIL')}
                          disabled={a.status !== 'COMPLETED' || downloading === `${a.documentId}-AUDIT_TRAIL`}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-700 dark:text-gray-200"
                          title="Download audit trail"
                        >
                          {downloading === `${a.documentId}-AUDIT_TRAIL` ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ShieldCheck className="h-3.5 w-3.5" />
                          )}
                          Audit
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
