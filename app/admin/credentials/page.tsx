'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import AdminSidebar from '@/components/AdminSidebar'
import { secureDb } from '@/lib/secure-db'
import {
  KeyRound, Search, RefreshCw, Menu, ShieldAlert, Eye, X, Lock, Unlock,
  CheckCircle2, XCircle, Copy, User as UserIcon, CreditCard, FileText, Building2,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api-client'
import { useToast } from '@/components/Toast'

type Role = 'retailer' | 'distributor' | 'master_distributor' | 'partner'

type TpinInfo = {
  supported: boolean
  enabled: boolean
  locked: boolean
  locked_until: string | null
  failed_attempts: number
}

type CredUser = {
  role: Role
  id: string
  identifier: string
  name: string
  email: string
  phone: string
  status: string
  verification_status: string | null
  has_login: boolean
  tpin: TpinInfo
  settlement_accounts: any[]
  created_at: string
  details: Record<string, any>
}

const ROLE_LABEL: Record<Role, string> = {
  retailer: 'Retailer',
  distributor: 'Distributor',
  master_distributor: 'Master Distributor',
  partner: 'Partner',
}

const ROLE_BADGE: Record<Role, string> = {
  retailer: 'bg-blue-100 text-blue-700',
  distributor: 'bg-purple-100 text-purple-700',
  master_distributor: 'bg-amber-100 text-amber-700',
  partner: 'bg-emerald-100 text-emerald-700',
}

// Human-friendly labels + display order for the detail modal.
const FIELD_GROUPS: { title: string; icon: any; keys: string[] }[] = [
  {
    title: 'Profile',
    icon: UserIcon,
    keys: ['name', 'partner_id', 'id', 'email', 'phone', 'business_name', 'status', 'commission_rate', 'distributor_id', 'master_distributor_id', 'created_at', 'updated_at'],
  },
  {
    title: 'Address',
    icon: Building2,
    keys: ['address', 'city', 'state', 'pincode'],
  },
  {
    title: 'KYC Documents',
    icon: FileText,
    keys: [
      'verification_status', 'aadhar_number', 'aadhaar_uid', 'aadhaar_name', 'aadhaar_dob', 'aadhaar_gender', 'aadhaar_address', 'aadhaar_verified',
      'pan_number', 'pan_verified', 'pan_registered_name', 'pan_type', 'pan_verified_at',
      'gst_number', 'gst_verified', 'gst_legal_name', 'gst_trade_name', 'gst_status',
      'udhyam_number', 'auto_verification_score',
      'aadhar_front_url', 'aadhar_back_url', 'aadhar_attachment_url', 'pan_attachment_url', 'udhyam_certificate_url', 'gst_certificate_url',
    ],
  },
  {
    title: 'Bank Account',
    icon: CreditCard,
    keys: ['bank_name', 'account_number', 'ifsc_code', 'bank_branch', 'bank_city', 'bank_verified', 'bank_verified_name', 'bank_utr', 'bank_verified_at', 'bank_document_url'],
  },
]

function fmtVal(key: string, v: any) {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'object') return JSON.stringify(v)
  if (/_at$|created_at|updated_at/.test(key) && typeof v === 'string' && v.includes('T')) {
    try { return new Date(v).toLocaleString('en-IN') } catch { return String(v) }
  }
  return String(v)
}

function prettyKey(k: string) {
  return k.replace(/_/g, ' ').replace(/\burl\b/i, 'URL').replace(/\bid\b/i, 'ID').replace(/\bpan\b/i, 'PAN').replace(/\bgst\b/i, 'GST').replace(/^\w/, c => c.toUpperCase())
}

export default function CredentialsPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const { showToast } = useToast()

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [checkingRole, setCheckingRole] = useState(true)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)

  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<CredUser[]>([])
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | Role>('all')

  const [detailUser, setDetailUser] = useState<CredUser | null>(null)
  const [resetTarget, setResetTarget] = useState<{ user: CredUser; kind: 'tpin' | 'password' } | null>(null)

  // Gate: admin session first, then verify strict super_admin.
  useEffect(() => {
    if (authLoading) return
    if (!user || user.role !== 'admin') {
      router.push('/admin/login')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await secureDb
          .from('admin_users')
          .select('admin_type, is_active')
          .eq('email', user.email)
          .single()
        if (cancelled) return
        const ok = !!data && (data as any).is_active !== false && (data as any).admin_type === 'super_admin'
        setIsSuperAdmin(ok)
      } catch {
        if (!cancelled) setIsSuperAdmin(false)
      } finally {
        if (!cancelled) setCheckingRole(false)
      }
    })()
    return () => { cancelled = true }
  }, [user, authLoading, router])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/admin/credentials')
      const data = await res.json()
      if (!res.ok || !data.success) {
        showToast(data?.error || 'Failed to load credentials', 'error')
        setRows([])
        return
      }
      setRows(data.users || [])
    } catch (e: any) {
      showToast(e?.message || 'Failed to load credentials', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    if (isSuperAdmin) fetchData()
  }, [isSuperAdmin, fetchData])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (roleFilter !== 'all' && r.role !== roleFilter) return false
      if (!q) return true
      return (
        r.name?.toLowerCase().includes(q) ||
        r.email?.toLowerCase().includes(q) ||
        r.phone?.toLowerCase().includes(q) ||
        r.identifier?.toLowerCase().includes(q)
      )
    })
  }, [rows, search, roleFilter])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, retailer: 0, distributor: 0, master_distributor: 0, partner: 0 }
    for (const r of rows) c[r.role] = (c[r.role] || 0) + 1
    return c
  }, [rows])

  if (authLoading || checkingRole) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600" />
      </div>
    )
  }

  if (!isSuperAdmin) {
    return (
      <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900">
        <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="flex-1 lg:ml-56 pt-16 flex items-center justify-center">
          <div className="text-center max-w-md p-8">
            <ShieldAlert className="w-14 h-14 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Restricted</h2>
            <p className="text-gray-600 dark:text-gray-400">
              The Credentials section is available to super-admins only.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900 overflow-x-hidden">
      <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 lg:ml-56 min-w-0 overflow-x-hidden pt-16">
        <button
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden fixed top-20 left-2 z-30 p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700"
        >
          <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
        </button>

        <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <KeyRound className="w-6 h-6 text-primary-600" /> Credentials
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Super-admin view of every user&apos;s profile, KYC, bank &amp; security state. Reset T-PIN / password below.
              </p>
            </div>
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60 text-sm font-medium"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>

          {/* Security note */}
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 p-3 text-xs text-amber-800 dark:text-amber-300">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              Passwords and T-PINs are one-way hashed and cannot be displayed. Use <b>Reset T-PIN</b> / <b>Reset Password</b> to set a new value and hand it to the user. Every reset is audit-logged.
            </span>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {(['all', 'retailer', 'distributor', 'master_distributor', 'partner'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRoleFilter(r)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${
                  roleFilter === r
                    ? 'bg-primary-600 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50'
                }`}
              >
                {r === 'all' ? 'All' : ROLE_LABEL[r]}{' '}
                <span className="opacity-70">({counts[r] ?? 0})</span>
              </button>
            ))}
            <div className="relative ml-auto w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email, phone, ID…"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          {/* Table */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 text-xs uppercase">
                  <tr>
                    <th className="px-4 py-3 text-left">User</th>
                    <th className="px-4 py-3 text-left">Role</th>
                    <th className="px-4 py-3 text-left">ID</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Login</th>
                    <th className="px-4 py-3 text-left">T-PIN</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {loading ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Loading…</td></tr>
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">No users found</td></tr>
                  ) : (
                    filtered.map((r) => (
                      <tr key={`${r.role}-${r.id}`} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900 dark:text-white">{r.name || '—'}</div>
                          <div className="text-xs text-gray-500">{r.email || '—'}</div>
                          <div className="text-xs text-gray-400">{r.phone || '—'}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGE[r.role]}`}>
                            {ROLE_LABEL[r.role]}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-300">{r.identifier || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            r.status === 'active' ? 'bg-green-100 text-green-700'
                            : r.status === 'suspended' ? 'bg-red-100 text-red-700'
                            : 'bg-gray-100 text-gray-600'
                          }`}>{r.status || '—'}</span>
                        </td>
                        <td className="px-4 py-3">
                          {r.has_login
                            ? <span className="inline-flex items-center gap-1 text-green-600 text-xs"><CheckCircle2 className="w-3.5 h-3.5" /> Yes</span>
                            : <span className="inline-flex items-center gap-1 text-red-500 text-xs"><XCircle className="w-3.5 h-3.5" /> None</span>}
                        </td>
                        <td className="px-4 py-3">
                          {!r.tpin.supported ? (
                            <span className="text-xs text-gray-400">N/A</span>
                          ) : r.tpin.locked ? (
                            <span className="inline-flex items-center gap-1 text-red-600 text-xs"><Lock className="w-3.5 h-3.5" /> Locked</span>
                          ) : r.tpin.enabled ? (
                            <span className="inline-flex items-center gap-1 text-green-600 text-xs"><CheckCircle2 className="w-3.5 h-3.5" /> Set</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-gray-500 text-xs"><Unlock className="w-3.5 h-3.5" /> Not set</span>
                          )}
                          {r.tpin.supported && r.tpin.failed_attempts > 0 && (
                            <div className="text-[10px] text-amber-600">{r.tpin.failed_attempts} failed</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => setDetailUser(r)}
                              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300"
                              title="View all details"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            {r.tpin.supported && (
                              <button
                                onClick={() => setResetTarget({ user: r, kind: 'tpin' })}
                                className="px-2 py-1 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300"
                              >
                                Reset T-PIN
                              </button>
                            )}
                            <button
                              onClick={() => setResetTarget({ user: r, kind: 'password' })}
                              className="px-2 py-1 rounded-lg text-xs font-medium bg-orange-50 text-orange-700 hover:bg-orange-100 dark:bg-orange-900/30 dark:text-orange-300"
                            >
                              Reset Password
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {detailUser && <DetailModal user={detailUser} onClose={() => setDetailUser(null)} />}
        {resetTarget && (
          <ResetModal
            target={resetTarget}
            onClose={() => setResetTarget(null)}
            onDone={() => { setResetTarget(null); fetchData() }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function DetailModal({ user, onClose }: { user: CredUser; onClose: () => void }) {
  const { showToast } = useToast()
  const d = user.details || {}
  const shownKeys = new Set<string>()

  const copy = (v: string) => {
    navigator.clipboard?.writeText(v).then(() => showToast('Copied', 'success')).catch(() => {})
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 10 }}
        className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h3 className="font-bold text-gray-900 dark:text-white">{user.name || 'User'} details</h3>
            <p className="text-xs text-gray-500">{ROLE_LABEL[user.role]} · {user.identifier}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-5">
          {/* Security summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <SecStat label="Login account" ok={user.has_login} okText="Exists" noText="Missing" />
            <SecStat label="T-PIN" ok={user.tpin.enabled} okText="Set" noText={user.tpin.supported ? 'Not set' : 'N/A'} />
            <SecStat label="T-PIN lock" ok={!user.tpin.locked} okText="Unlocked" noText="Locked" invert />
            <SecStat label="KYC" ok={(user.verification_status || '').toLowerCase().includes('verif')} okText={user.verification_status || 'Verified'} noText={user.verification_status || 'Pending'} />
          </div>

          {FIELD_GROUPS.map((g) => {
            const entries = g.keys
              .filter((k) => k in d && d[k] !== null && d[k] !== '' && d[k] !== undefined)
              .map((k) => { shownKeys.add(k); return k })
            if (entries.length === 0) return null
            const Icon = g.icon
            return (
              <div key={g.title}>
                <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                  <Icon className="w-4 h-4 text-primary-600" /> {g.title}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                  {entries.map((k) => (
                    <FieldRow key={k} k={k} v={d[k]} onCopy={copy} />
                  ))}
                </div>
              </div>
            )
          })}

          {/* Settlement accounts */}
          {user.settlement_accounts && user.settlement_accounts.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                <CreditCard className="w-4 h-4 text-primary-600" /> Settlement Accounts ({user.settlement_accounts.length})
              </div>
              <div className="space-y-2">
                {user.settlement_accounts.map((a, i) => (
                  <div key={i} className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                    {['account_holder_name', 'verified_name', 'account_number', 'ifsc_code', 'bank_name', 'verification_status'].map((k) =>
                      a[k] ? <FieldRow key={k} k={k} v={a[k]} onCopy={copy} /> : null
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

function FieldRow({ k, v, onCopy }: { k: string; v: any; onCopy: (s: string) => void }) {
  const display = fmtVal(k, v)
  const isUrl = typeof v === 'string' && /^https?:\/\//.test(v)
  return (
    <div className="flex items-start justify-between gap-2 py-1 border-b border-gray-50 dark:border-gray-700/50">
      <span className="text-xs text-gray-500 shrink-0 pt-0.5">{prettyKey(k)}</span>
      <span className="text-xs text-gray-900 dark:text-gray-100 font-medium text-right break-all flex items-center gap-1">
        {isUrl ? (
          <a href={v} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">View file</a>
        ) : (
          <>
            {display}
            {display !== '—' && (
              <button onClick={() => onCopy(String(v))} className="text-gray-300 hover:text-gray-500">
                <Copy className="w-3 h-3" />
              </button>
            )}
          </>
        )}
      </span>
    </div>
  )
}

function SecStat({ label, ok, okText, noText, invert }: { label: string; ok: boolean; okText: string; noText: string; invert?: boolean }) {
  const good = invert ? ok : ok
  return (
    <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 p-2 text-center">
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`text-sm font-semibold ${good ? 'text-green-600' : 'text-red-500'}`}>{good ? okText : noText}</div>
    </div>
  )
}

function ResetModal({
  target, onClose, onDone,
}: {
  target: { user: CredUser; kind: 'tpin' | 'password' }
  onClose: () => void
  onDone: () => void
}) {
  const { showToast } = useToast()
  const { user, kind } = target
  const [value, setValue] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [show, setShow] = useState(false)

  const isTpin = kind === 'tpin'

  const genRandom = () => {
    if (isTpin) {
      setValue(String(Math.floor(1000 + Math.random() * 9000)))
    } else {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#$'
      let p = ''
      for (let i = 0; i < 12; i++) p += chars[Math.floor(Math.random() * chars.length)]
      setValue(p)
      setConfirm(p)
    }
    setShow(true)
  }

  const validate = (): string | null => {
    if (isTpin) {
      if (!/^\d{4,6}$/.test(value)) return 'T-PIN must be 4 to 6 digits'
    } else {
      if (value.length < 8) return 'Password must be at least 8 characters'
      if (value !== confirm) return 'Passwords do not match'
    }
    return null
  }

  const submit = async () => {
    const err = validate()
    if (err) { showToast(err, 'error'); return }
    setSubmitting(true)
    try {
      const path = isTpin ? '/api/admin/reset-tpin' : '/api/admin/reset-password'
      const body = isTpin
        ? { user_id: user.identifier, user_role: user.role, new_tpin: value }
        : { user_id: user.identifier, user_role: user.role, new_password: value }
      const res = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok || !data.success) {
        showToast(data?.error || data?.message || 'Reset failed', 'error')
        return
      }
      showToast(data.message || `${isTpin ? 'T-PIN' : 'Password'} reset successfully`, 'success')
      onDone()
    } catch (e: any) {
      showToast(e?.message || 'Reset failed', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 10 }}
        className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="font-bold text-gray-900 dark:text-white">
            Reset {isTpin ? 'T-PIN' : 'Password'}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="text-sm text-gray-600 dark:text-gray-300">
            <div><b>{user.name}</b> <span className="text-gray-400">({ROLE_LABEL[user.role]})</span></div>
            <div className="text-xs text-gray-500">{user.email} · {user.identifier}</div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              New {isTpin ? 'T-PIN (4–6 digits)' : 'Password (min 8 chars)'}
            </label>
            <div className="relative">
              <input
                type={show ? 'text' : 'password'}
                inputMode={isTpin ? 'numeric' : 'text'}
                value={value}
                onChange={(e) => setValue(isTpin ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value)}
                className="w-full px-3 py-2 pr-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder={isTpin ? '••••' : '••••••••'}
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
              >
                {show ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {!isTpin && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Confirm password</label>
              <input
                type={show ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Re-enter password"
              />
            </div>
          )}

          <button onClick={genRandom} className="text-xs text-primary-600 hover:underline">
            Generate a random {isTpin ? 'T-PIN' : 'password'}
          </button>

          <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-2.5 text-xs text-amber-800 dark:text-amber-300">
            Share this new {isTpin ? 'T-PIN' : 'password'} with the user securely. It replaces their old one immediately.
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={submitting}
              className="flex-1 px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-60"
            >
              {submitting ? 'Saving…' : `Reset ${isTpin ? 'T-PIN' : 'Password'}`}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
