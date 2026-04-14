'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import { 
  RefreshCw, Search, ChevronLeft, ChevronRight, Wallet, Download, 
  TrendingUp, TrendingDown, Calendar, FileSpreadsheet, ArrowUpRight, ArrowDownRight,
  IndianRupee, Filter, AlertCircle
} from 'lucide-react'
import { motion } from 'framer-motion'

type LedgerRow = {
  id: string
  retailer_id: string
  user_role?: string
  wallet_type?: string
  fund_category?: string
  service_type?: string
  transaction_type?: string
  credit?: number
  debit?: number
  opening_balance?: number
  closing_balance?: number
  balance_after?: number
  description?: string
  reference_id?: string
  status?: string
  created_at: string
}

type WalletStats = {
  total_credits: number
  total_debits: number
  transaction_count: number
}

export default function AdminRevenueWalletTab() {
  const [balance, setBalance] = useState<number | null>(null)
  const [configured, setConfigured] = useState(true)
  const [configMessage, setConfigMessage] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  
  const [entries, setEntries] = useState<LedgerRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit] = useState(25)
  const [loading, setLoading] = useState(true)
  const [loadingBalance, setLoadingBalance] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  const [serviceTypeFilter, setServiceTypeFilter] = useState<string>('all')
  const [transactionTypeFilter, setTransactionTypeFilter] = useState<string>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  
  const [stats, setStats] = useState<WalletStats>({ total_credits: 0, total_debits: 0, transaction_count: 0 })
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 400)
    return () => clearTimeout(t)
  }, [q])

  const fetchBalance = useCallback(async () => {
    setLoadingBalance(true)
    try {
      const res = await apiFetch('/api/admin/subscriptions/revenue-balance')
      const data = await res.json()
      
      if (!data.configured) {
        setConfigured(false)
        setConfigMessage(data.message || 'Revenue wallet not configured')
        setBalance(null)
      } else {
        setConfigured(true)
        setBalance(data.balance)
        setUserId(data.user_id)
        setUserRole(data.user_role)
      }
    } catch (e: any) {
      setError(e.message || 'Failed to fetch balance')
    } finally {
      setLoadingBalance(false)
    }
  }, [])

  const fetchLedger = useCallback(async () => {
    if (!userId) return
    
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        scope: 'all',
        user_id: userId,
        wallet_type: 'primary',
      })
      
      if (serviceTypeFilter !== 'all') params.set('service_type', serviceTypeFilter)
      if (transactionTypeFilter !== 'all') params.set('transaction_type', transactionTypeFilter)
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      if (debouncedQ.trim()) params.set('q', debouncedQ.trim())

      const res = await apiFetch(`/api/admin/wallet/ledger?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load ledger')
      
      setEntries(data.entries || [])
      setTotal(data.total ?? 0)
      
      // Calculate stats from entries
      const credits = (data.entries || []).reduce((sum: number, e: LedgerRow) => sum + (Number(e.credit) || 0), 0)
      const debits = (data.entries || []).reduce((sum: number, e: LedgerRow) => sum + (Number(e.debit) || 0), 0)
      setStats({
        total_credits: credits,
        total_debits: debits,
        transaction_count: data.total ?? 0
      })
    } catch (e: any) {
      setError(e.message || 'Failed to load')
      setEntries([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [page, limit, userId, serviceTypeFilter, transactionTypeFilter, dateFrom, dateTo, debouncedQ])

  useEffect(() => {
    fetchBalance()
  }, [fetchBalance])

  useEffect(() => {
    if (userId) {
      fetchLedger()
    }
  }, [fetchLedger, userId])

  useEffect(() => {
    setPage(1)
  }, [serviceTypeFilter, transactionTypeFilter, dateFrom, dateTo, debouncedQ])

  const handleDownload = async (format: 'csv' | 'excel') => {
    if (!userId) return
    
    setDownloading(true)
    try {
      const params = new URLSearchParams({
        scope: 'all',
        user_id: userId,
        wallet_type: 'primary',
        format,
        limit: '10000',
      })
      
      if (serviceTypeFilter !== 'all') params.set('service_type', serviceTypeFilter)
      if (transactionTypeFilter !== 'all') params.set('transaction_type', transactionTypeFilter)
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      if (debouncedQ.trim()) params.set('q', debouncedQ.trim())

      const res = await apiFetch(`/api/admin/wallet/ledger/export?${params}`)
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to export')
      }
      
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `revenue-wallet-statement-${new Date().toISOString().split('T')[0]}.${format === 'excel' ? 'xlsx' : 'csv'}`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (e: any) {
      setError(e.message || 'Failed to download')
    } finally {
      setDownloading(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit))

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  }

  if (!configured) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4 p-4"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg">
            <Wallet className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Revenue Wallet</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">Platform revenue collection wallet</p>
          </div>
        </div>
        
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-amber-800 dark:text-amber-300 mb-2">Revenue Wallet Not Configured</h3>
              <p className="text-amber-700 dark:text-amber-400 text-sm">{configMessage}</p>
            </div>
          </div>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 p-4"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg">
            <Wallet className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Revenue Wallet</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Platform revenue collection • {userRole?.replace('_', ' ')}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { fetchBalance(); fetchLedger(); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-sm font-medium transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading || loadingBalance ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Balance Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-1 bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl p-6 text-white shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <span className="text-green-100 text-sm font-medium">Current Balance</span>
            <Wallet className="w-5 h-5 text-green-200" />
          </div>
          {loadingBalance ? (
            <div className="h-10 bg-white/20 rounded animate-pulse"></div>
          ) : (
            <div className="text-3xl font-bold">{formatCurrency(balance || 0)}</div>
          )}
          <div className="mt-4 pt-4 border-t border-white/20">
            <p className="text-xs text-green-100 truncate" title={userId || ''}>
              Wallet ID: {userId?.slice(0, 16)}...
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <span className="text-gray-500 dark:text-gray-400 text-sm font-medium">Total Credits (Page)</span>
            <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
              <ArrowDownRight className="w-4 h-4 text-green-600 dark:text-green-400" />
            </div>
          </div>
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">
            {formatCurrency(stats.total_credits)}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Incoming funds</p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <span className="text-gray-500 dark:text-gray-400 text-sm font-medium">Total Debits (Page)</span>
            <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
              <ArrowUpRight className="w-4 h-4 text-red-600 dark:text-red-400" />
            </div>
          </div>
          <div className="text-2xl font-bold text-red-600 dark:text-red-400">
            {formatCurrency(stats.total_debits)}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Outgoing funds</p>
        </div>
      </div>

      {/* Filters & Actions */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Service Type</label>
            <select
              value={serviceTypeFilter}
              onChange={(e) => setServiceTypeFilter(e.target.value)}
              className="px-3 py-2 text-sm border rounded-lg bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            >
              <option value="all">All Services</option>
              <option value="subscription">Subscription</option>
              <option value="settlement">Settlement</option>
              <option value="payout">Payout</option>
              <option value="bbps">BBPS</option>
              <option value="pos_rental">POS Rental</option>
            </select>
          </div>
          
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Transaction Type</label>
            <select
              value={transactionTypeFilter}
              onChange={(e) => setTransactionTypeFilter(e.target.value)}
              className="px-3 py-2 text-sm border rounded-lg bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            >
              <option value="all">All Types</option>
              <option value="SUBSCRIPTION_REVENUE">Subscription Revenue</option>
              <option value="POS_RENTAL_COMMISSION">POS Rental Commission</option>
              <option value="COMMISSION_CREDIT">Commission Credit</option>
              <option value="SETTLEMENT_FEE">Settlement Fee</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">From Date</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-3 py-2 text-sm border rounded-lg bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">To Date</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-3 py-2 text-sm border rounded-lg bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
            />
          </div>

          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search description or reference..."
                className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-600"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleDownload('csv')}
              disabled={downloading || !userId}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50 transition-colors"
            >
              <Download className="w-4 h-4" />
              CSV
            </button>
            <button
              type="button"
              onClick={() => handleDownload('excel')}
              disabled={downloading || !userId}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium disabled:opacity-50 transition-colors"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Excel
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm flex items-center gap-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Statement Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-white">Wallet Statement</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {total} transaction{total !== 1 ? 's' : ''} found
          </p>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Date & Time</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Service</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Credit</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Debit</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Balance</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {loading && entries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                    <RefreshCw className="w-6 h-6 animate-spin inline-block mr-2" />
                    Loading statement...
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                    No transactions found matching your filters.
                  </td>
                </tr>
              ) : (
                entries.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-600 dark:text-gray-400">
                      {new Date(e.created_at).toLocaleString('en-IN', { 
                        timeZone: 'Asia/Kolkata',
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                        {e.transaction_type?.replace(/_/g, ' ') || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 text-xs rounded-full bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                        {e.service_type || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {Number(e.credit) > 0 ? (
                        <span className="text-sm font-medium text-green-600 dark:text-green-400">
                          +{formatCurrency(Number(e.credit))}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {Number(e.debit) > 0 ? (
                        <span className="text-sm font-medium text-red-600 dark:text-red-400">
                          -{formatCurrency(Number(e.debit))}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">
                        {formatCurrency(Number(e.closing_balance ?? e.balance_after ?? 0))}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs rounded-full font-medium ${
                        e.status === 'completed' 
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : e.status === 'pending'
                          ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-400'
                      }`}>
                        {e.status || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400 max-w-xs truncate" title={e.description || e.reference_id || ''}>
                      {e.description || e.reference_id || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Page {page} of {totalPages} ({total} total)
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
                className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
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
