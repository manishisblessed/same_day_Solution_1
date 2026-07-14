'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import {
  RefreshCw, Search, ChevronLeft, ChevronRight,
  ArrowUpCircle, ArrowDownCircle,
  FileSpreadsheet, FileText, Loader2,
} from 'lucide-react'
import { motion } from 'framer-motion'

type AuditRow = {
  id: string
  action_type: 'wallet_push' | 'wallet_pull'
  user_name?: string
  wallet_type?: string
  fund_category?: string
  amount: number
  before_balance: number
  after_balance: number
  performed_by: string
  remarks?: string
  reference_id?: string
  created_at: string
}

type UserSearchResult = {
  id: string
  name: string
  business_name: string | null
  role: string
  status: string | null
}

type Summary = { totalPush: number; totalPull: number; net: number }

const FUND_CATEGORIES = [
  { value: '', label: 'All categories' },
  { value: 'cash', label: 'Cash' },
  { value: 'online', label: 'Online' },
  { value: 'commission', label: 'Commission' },
  { value: 'settlement', label: 'Settlement' },
  { value: 'adjustment', label: 'Adjustment' },
  { value: 'aeps', label: 'AEPS' },
  { value: 'bbps', label: 'BBPS' },
  { value: 'other', label: 'Other' },
]

const ROLE_LABELS: Record<string, string> = {
  retailer: 'Retailer',
  distributor: 'Distributor',
  master_distributor: 'Master Distributor',
}

const inr = (v: number) =>
  `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function AdminPushPullReport() {
  const [entries, setEntries] = useState<AuditRow[]>([])
  const [total, setTotal] = useState(0)
  const [summary, setSummary] = useState<Summary>({ totalPush: 0, totalPull: 0, net: 0 })
  const [page, setPage] = useState(1)
  const [limit] = useState(25)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState<'csv' | 'excel' | null>(null)

  // Filters
  const [userRole, setUserRole] = useState('')
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null)
  const [roleUsers, setRoleUsers] = useState<UserSearchResult[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [actionType, setActionType] = useState('')
  const [walletType, setWalletType] = useState('')
  const [fundCategory, setFundCategory] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

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
    const params = new URLSearchParams()
    if (selectedUser) params.set('user_id', selectedUser.id)
    if (actionType) params.set('action_type', actionType)
    if (walletType) params.set('wallet_type', walletType)
    if (fundCategory) params.set('fund_category', fundCategory)
    if (dateFrom) params.set('date_from', dateFrom)
    if (dateTo) params.set('date_to', dateTo)
    return params
  }, [selectedUser, actionType, walletType, fundCategory, dateFrom, dateTo])

  const fetchReport = useCallback(async () => {
    if (!selectedUser) {
      setEntries([])
      setTotal(0)
      setSummary({ totalPush: 0, totalPull: 0, net: 0 })
      return
    }
    setLoading(true)
    setError(null)
    try {
      const params = buildParams()
      params.set('page', String(page))
      params.set('limit', String(limit))

      const res = await apiFetch(`/api/admin/reports/push-pull?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load')
      setEntries(data.entries || [])
      setTotal(data.total ?? 0)
      setSummary(data.summary || { totalPush: 0, totalPull: 0, net: 0 })
    } catch (e: any) {
      setError(e.message || 'Failed to load')
      setEntries([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [buildParams, page, limit, selectedUser])

  useEffect(() => {
    fetchReport()
  }, [fetchReport])

  useEffect(() => {
    setPage(1)
  }, [selectedUser, actionType, walletType, fundCategory, dateFrom, dateTo])

  const handleExport = async (format: 'csv' | 'excel') => {
    if (!selectedUser) return
    setExporting(format)
    try {
      const params = buildParams()
      params.set('format', format)
      params.set('limit', '50000')

      const res = await apiFetch(`/api/admin/reports/push-pull?${params}`)
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
      a.download = `push-pull-${selectedUser.id}-${datePart}.${format === 'excel' ? 'xls' : 'csv'}`
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
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ArrowUpCircle className="w-6 h-6 text-primary-600 dark:text-primary-400" />
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Push / Pull Report</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Select a user to view all push &amp; pull transactions performed by admin, MD, or DT.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleExport('csv')}
            disabled={!!exporting || loading || !selectedUser}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {exporting === 'csv' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => handleExport('excel')}
            disabled={!!exporting || loading || !selectedUser}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-700 hover:bg-green-800 text-white text-sm font-medium disabled:opacity-50"
          >
            {exporting === 'excel' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            Export Excel
          </button>
          <button
            type="button"
            onClick={() => fetchReport()}
            disabled={!selectedUser}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-end bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Role</label>
          <select value={userRole} onChange={(e) => setUserRole(e.target.value)} className={inputCls}>
            <option value="">Select role…</option>
            <option value="retailer">Retailer</option>
            <option value="distributor">Distributor</option>
            <option value="master_distributor">Master Distributor</option>
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
              <option value="">— Select user —</option>
              {roleUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.id} — {u.name}
                  {u.business_name && u.business_name !== u.name ? ` (${u.business_name})` : ''}
                  {u.status && u.status !== 'active' ? ` [${u.status}]` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Action</label>
          <select value={actionType} onChange={(e) => setActionType(e.target.value)} className={inputCls}>
            <option value="">Push &amp; Pull</option>
            <option value="wallet_push">Push only</option>
            <option value="wallet_pull">Pull only</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Wallet</label>
          <select value={walletType} onChange={(e) => setWalletType(e.target.value)} className={inputCls}>
            <option value="">All</option>
            <option value="primary">Primary</option>
            <option value="aeps">AEPS</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Fund category</label>
          <select value={fundCategory} onChange={(e) => setFundCategory(e.target.value)} className={inputCls}>
            {FUND_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
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
      </div>

      {/* Summary cards */}
      {selectedUser && (total > 0 || loading) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-3">
            <p className="text-xs text-green-600 dark:text-green-400 font-medium">Total Pushed</p>
            <p className="text-lg font-bold text-green-700 dark:text-green-300">{inr(summary.totalPush)}</p>
          </div>
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3">
            <p className="text-xs text-red-600 dark:text-red-400 font-medium">Total Pulled</p>
            <p className="text-lg font-bold text-red-700 dark:text-red-300">{inr(summary.totalPull)}</p>
          </div>
          <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-3">
            <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">Net (Push − Pull)</p>
            <p className={`text-lg font-bold ${summary.net >= 0 ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
              {inr(summary.net)}
            </p>
          </div>
        </div>
      )}

      {!selectedUser && (
        <div className="p-8 text-center text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <Search className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p className="font-medium">Select a role and user above to view their push/pull history</p>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">{error}</div>
      )}

      {/* Table */}
      {selectedUser && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">Date</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">Action</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 dark:text-gray-400">Amount</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">Fund Category</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">Wallet</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 dark:text-gray-400">Before Bal</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 dark:text-gray-400">After Bal</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">Performed By</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 dark:text-gray-400">Remarks</th>
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
                      No push/pull transactions found for this user.
                    </td>
                  </tr>
                ) : (
                  entries.map((e) => {
                    const isPush = e.action_type === 'wallet_push'
                    return (
                      <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                        <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600 dark:text-gray-400">
                          {new Date(e.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                            isPush
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                          }`}>
                            {isPush
                              ? <ArrowUpCircle className="w-3 h-3" />
                              : <ArrowDownCircle className="w-3 h-3" />}
                            {isPush ? 'Push' : 'Pull'}
                          </span>
                        </td>
                        <td className={`px-3 py-2 text-right text-xs font-medium ${isPush ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                          {inr(Number(e.amount) || 0)}
                        </td>
                        <td className="px-3 py-2 text-xs capitalize">{e.fund_category || '—'}</td>
                        <td className="px-3 py-2 text-xs capitalize">{e.wallet_type || 'primary'}</td>
                        <td className="px-3 py-2 text-right text-xs text-gray-600 dark:text-gray-400">
                          {inr(Number(e.before_balance) || 0)}
                        </td>
                        <td className="px-3 py-2 text-right text-xs font-medium text-gray-900 dark:text-white">
                          {inr(Number(e.after_balance) || 0)}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300 max-w-[140px] truncate" title={e.performed_by}>
                          {e.performed_by || '—'}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400 max-w-xs truncate" title={e.remarks}>
                          {e.remarks || '—'}
                        </td>
                      </tr>
                    )
                  })
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
      )}
    </motion.div>
  )
}
