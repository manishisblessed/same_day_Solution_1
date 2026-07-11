'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import {
  RefreshCw, Search, ChevronLeft, ChevronRight, BookOpen,
  FileSpreadsheet, FileText, Loader2,
} from 'lucide-react'
import { motion } from 'framer-motion'

type LedgerRow = {
  id: string
  retailer_id: string
  user_name?: string | null
  partner_name?: string | null
  user_role?: string
  wallet_type?: string
  fund_category?: string
  service_type?: string
  transaction_type?: string
  credit?: number
  debit?: number
  opening_balance?: number
  closing_balance?: number
  description?: string
  reference_id?: string
  status?: string
  created_at: string
}

type UserSearchResult = {
  id: string
  name: string
  business_name: string | null
  role: string
  status: string | null
}

const SERVICE_TYPES = [
  { value: '', label: 'All services' },
  { value: 'pos', label: 'POS' },
  { value: 'bbps', label: 'BBPS' },
  { value: 'pay2new', label: 'Pay2New (BBPS-2)' },
  { value: 'aeps', label: 'AEPS' },
  { value: 'payout', label: 'Payout / Settlement-1' },
  { value: 'shadval_settlement', label: 'Settlement-2' },
  { value: 'settlement', label: 'Settlement' },
  { value: 'subscription', label: 'Subscription' },
  { value: 'admin', label: 'Admin adjustment' },
]

const COMMON_TX_TYPES = [
  'CREDIT', 'DEBIT', 'REFUND', 'COMMISSION_CREDIT', 'REVENUE_CREDIT',
  'BBPS_DEBIT', 'BBPS_REFUND', 'PAY2NEW_REFUND', 'pos',
]

const ROLE_LABELS: Record<string, string> = {
  retailer: 'Retailer',
  distributor: 'Distributor',
  master_distributor: 'Master Distributor',
  partner: 'Partner',
}

export default function AdminWalletLedgerTab() {
  const [entries, setEntries] = useState<LedgerRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit] = useState(25)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<'all' | 'platform'>('all')
  const [userRole, setUserRole] = useState('')
  const [walletType, setWalletType] = useState('primary')
  const [serviceType, setServiceType] = useState('')
  const [transactionType, setTransactionType] = useState('')
  const [status, setStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [exporting, setExporting] = useState<'csv' | 'excel' | null>(null)

  // Role-driven user picker state
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null)
  const [roleUsers, setRoleUsers] = useState<UserSearchResult[]>([])
  const [usersLoading, setUsersLoading] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 400)
    return () => clearTimeout(t)
  }, [q])

  // Load users of the selected role
  useEffect(() => {
    setSelectedUser(null)
    setRoleUsers([])
    if (!userRole) return

    let cancelled = false
    setUsersLoading(true)
    ;(async () => {
      try {
        const res = await apiFetch(`/api/admin/users/search?all=1&roles=${encodeURIComponent(userRole)}`)
        const data = await res.json()
        if (!cancelled && res.ok) setRoleUsers(data.results || [])
      } catch {
        if (!cancelled) setRoleUsers([])
      } finally {
        if (!cancelled) setUsersLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [userRole])

  const buildParams = useCallback(() => {
    const params = new URLSearchParams({ scope, wallet_type: walletType })
    if (scope === 'all' && selectedUser) params.set('user_id', selectedUser.id)
    if (scope === 'all' && userRole) params.set('user_role', userRole)
    if (serviceType) params.set('service_type', serviceType)
    if (transactionType.trim()) params.set('transaction_type', transactionType.trim())
    if (status) params.set('status', status)
    if (dateFrom) params.set('date_from', dateFrom)
    if (dateTo) params.set('date_to', dateTo)
    if (debouncedQ.trim()) params.set('q', debouncedQ.trim())
    return params
  }, [scope, walletType, selectedUser, userRole, serviceType, transactionType, status, dateFrom, dateTo, debouncedQ])

  const fetchLedger = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = buildParams()
      params.set('page', String(page))
      params.set('limit', String(limit))

      const res = await apiFetch(`/api/admin/wallet/ledger?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load ledger')
      setEntries(data.entries || [])
      setTotal(data.total ?? 0)
    } catch (e: any) {
      setError(e.message || 'Failed to load')
      setEntries([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [buildParams, page, limit])

  useEffect(() => {
    fetchLedger()
  }, [fetchLedger])

  useEffect(() => {
    setPage(1)
  }, [scope, selectedUser, userRole, walletType, serviceType, transactionType, status, dateFrom, dateTo, debouncedQ])

  const handleExport = async (format: 'csv' | 'excel') => {
    setExporting(format)
    try {
      const params = buildParams()
      params.set('format', format)
      params.set('limit', '50000')

      const res = await apiFetch(`/api/admin/wallet/ledger/export?${params}`)
      if (!res.ok) {
        let msg = 'Export failed'
        try { msg = (await res.json()).error || msg } catch {}
        throw new Error(msg)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const datePart = new Date().toISOString().split('T')[0]
      const userPart = selectedUser ? `-${selectedUser.id}` : ''
      a.download = `wallet-ledger${userPart}-${datePart}.${format === 'excel' ? 'xls' : 'csv'}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e: any) {
      setError(e.message || 'Export failed')
    } finally {
      setExporting(null)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit))
  const inputCls =
    'px-3 py-2 text-sm border rounded-lg bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600'

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BookOpen className="w-6 h-6 text-primary-600 dark:text-primary-400" />
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Wallet ledger</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Credit and debit lines across all wallets. Pick a user for a user-wise ledger, then export.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleExport('csv')}
            disabled={!!exporting || loading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {exporting === 'csv' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => handleExport('excel')}
            disabled={!!exporting || loading}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-700 hover:bg-green-800 text-white text-sm font-medium disabled:opacity-50"
          >
            {exporting === 'excel' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            Export Excel
          </button>
          <button
            type="button"
            onClick={() => fetchLedger()}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-end bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Scope</label>
          <select value={scope} onChange={(e) => setScope(e.target.value as 'all' | 'platform')} className={inputCls}>
            <option value="all">All users (admin view)</option>
            <option value="platform">Platform revenue wallet only</option>
          </select>
        </div>

        {scope === 'all' && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Role</label>
              <select value={userRole} onChange={(e) => setUserRole(e.target.value)} className={inputCls}>
                <option value="">Any</option>
                <option value="retailer">Retailer</option>
                <option value="distributor">Distributor</option>
                <option value="master_distributor">Master distributor</option>
                <option value="partner">Partner</option>
              </select>
            </div>
            {userRole && (
              <div className="flex-1 min-w-[220px]">
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  User {usersLoading ? '(loading…)' : `(${roleUsers.length})`}
                </label>
                <select
                  value={selectedUser?.id || ''}
                  onChange={(e) => {
                    const u = roleUsers.find((r) => r.id === e.target.value) || null
                    setSelectedUser(u)
                  }}
                  disabled={usersLoading}
                  className={`w-full ${inputCls}`}
                >
                  <option value="">All {ROLE_LABELS[userRole] || userRole}s</option>
                  {roleUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                      {u.business_name && u.business_name !== u.name ? ` — ${u.business_name}` : ''}
                      {u.status && u.status !== 'active' ? ` (${u.status})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Wallet</label>
          <select value={walletType} onChange={(e) => setWalletType(e.target.value)} className={inputCls}>
            <option value="primary">Primary</option>
            <option value="aeps">AEPS</option>
            <option value="all">All types</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Service</label>
          <select value={serviceType} onChange={(e) => setServiceType(e.target.value)} className={inputCls}>
            {SERVICE_TYPES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Transaction type</label>
          <input
            list="ledger-tx-types"
            value={transactionType}
            onChange={(e) => setTransactionType(e.target.value)}
            placeholder="All"
            className={`w-36 ${inputCls}`}
          />
          <datalist id="ledger-tx-types">
            {COMMON_TX_TYPES.map((t) => <option key={t} value={t} />)}
          </datalist>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
            <option value="">All</option>
            <option value="completed">Completed</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">From</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">To</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} />
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Search description</label>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Notes / description…"
              className={`w-full pl-8 ${inputCls}`}
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">{error}</div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">When</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">User / role</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">Type</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">Service</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 dark:text-gray-400">Credit</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 dark:text-gray-400">Debit</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 dark:text-gray-400">Balance</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">Status</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {loading && entries.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-gray-500">
                    <RefreshCw className="w-6 h-6 animate-spin inline-block mr-2" />
                    Loading…
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-10 text-center text-gray-500">
                    No ledger rows match your filters.
                  </td>
                </tr>
              ) : (
                entries.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600 dark:text-gray-400">
                      {new Date(e.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="font-medium text-gray-800 dark:text-gray-200 truncate max-w-[180px]" title={e.user_name || e.retailer_id}>
                        {e.user_name || e.retailer_id?.slice(0, 10) + '…'}
                      </div>
                      {e.partner_name && (
                        <div className="text-gray-500 truncate max-w-[180px]" title={e.partner_name}>
                          {e.partner_name}
                        </div>
                      )}
                      <div className="text-gray-400 text-[10px]">{e.user_role || '—'}{e.wallet_type ? ` · ${e.wallet_type}` : ''}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">{e.transaction_type || '—'}</td>
                    <td className="px-3 py-2 text-xs">{e.service_type || '—'}</td>
                    <td className="px-3 py-2 text-right text-xs text-green-600 dark:text-green-400">
                      {Number(e.credit) > 0 ? `₹${Number(e.credit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-red-600 dark:text-red-400">
                      {Number(e.debit) > 0 ? `₹${Number(e.debit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-medium text-gray-900 dark:text-white">
                      ₹
                      {Number(e.closing_balance ?? 0).toLocaleString('en-IN', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-3 py-2 text-xs">{e.status || '—'}</td>
                    <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400 max-w-xs truncate" title={e.description}>
                      {e.description || e.reference_id || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {total > 0 && (
          <div className="flex items-center justify-between px-3 py-2 border-t border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400">
            <span>
              {total} row{total !== 1 ? 's' : ''} · page {page} of {totalPages}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
                className="p-1.5 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}
