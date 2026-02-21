'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { 
  Search, RefreshCw, Download, Filter, Calendar,
  ChevronLeft, ChevronRight, CheckCircle, XCircle, 
  Clock, AlertCircle, CreditCard, Eye, X, Smartphone,
  Zap, CheckSquare, Square, Loader2, BadgeCheck, Banknote,
  ArrowDownToLine, ShieldCheck
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api-client'
import { RazorpayPOSTransaction } from '@/types/database.types'

interface POSTransactionsTableProps {
  autoPoll?: boolean
  pollInterval?: number
}

export default function POSTransactionsTable({
  autoPoll = true,
  pollInterval = 15000
}: POSTransactionsTableProps) {
  const { user } = useAuth()
  const [transactions, setTransactions] = useState<RazorpayPOSTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [limit] = useState(20)
  
  // Filters
  const [showFilters, setShowFilters] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [settlementFilter, setSettlementFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [tidFilter, setTidFilter] = useState('')
  
  // Detail modal
  const [selectedTxn, setSelectedTxn] = useState<RazorpayPOSTransaction | null>(null)

  // InstaCash selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [instaCashLoading, setInstaCashLoading] = useState(false)
  const [instaCashResult, setInstaCashResult] = useState<{
    success: boolean
    message: string
    summary?: any
  } | null>(null)

  const fetchTransactions = useCallback(async () => {
    // Admin users don't have partner_id, but should still see all transactions
    if (!user?.partner_id && user?.role !== 'admin') return

    try {
      setLoading(true)
      setError(null)

      const params = new URLSearchParams()
      params.append('page', page.toString())
      params.append('limit', limit.toString())
      if (dateFrom) params.append('date_from', dateFrom)
      if (dateTo) params.append('date_to', dateTo)
      if (statusFilter && statusFilter !== 'all') params.append('status', statusFilter)
      if (tidFilter) params.append('device_serial', tidFilter)

      const response = await apiFetch(`/api/razorpay/transactions?${params.toString()}`)
      const result = await response.json()

      if (result.success && result.data) {
        setTransactions(result.data)
        setTotal(result.pagination?.total || result.data.length)
        setTotalPages(result.pagination?.totalPages || 1)
      } else if (result.error) {
        setError(result.error)
      }
    } catch (err: any) {
      console.error('Error fetching POS transactions:', err)
      setError(err.message || 'Failed to fetch POS transactions')
    } finally {
      setLoading(false)
    }
  }, [user?.partner_id, user?.role, page, limit, statusFilter, dateFrom, dateTo, tidFilter])

  useEffect(() => {
    fetchTransactions()

    if (autoPoll) {
      const interval = setInterval(fetchTransactions, pollInterval)
      return () => clearInterval(interval)
    }
  }, [fetchTransactions, autoPoll, pollInterval])

  // Clear instaCash result after 8 seconds
  useEffect(() => {
    if (instaCashResult) {
      const timer = setTimeout(() => setInstaCashResult(null), 8000)
      return () => clearTimeout(timer)
    }
  }, [instaCashResult])

  // ---- Settlement status helpers ----
  const isEligibleForInstaCash = (txn: RazorpayPOSTransaction) => {
    const isSuccess = (txn.display_status || txn.status || '').toUpperCase() === 'SUCCESS' ||
                      (txn.display_status || txn.status || '').toUpperCase() === 'CAPTURED'
    return isSuccess && !txn.wallet_credited && !txn.settlement_mode
  }

  const getSettlementStatus = (txn: RazorpayPOSTransaction): { label: string; color: string; icon: any } => {
    if (txn.settlement_mode === 'INSTACASH') {
      return {
        label: 'InstaCash',
        color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
        icon: Zap
      }
    }
    if (txn.settlement_mode === 'AUTO_T1') {
      return {
        label: 'T+1 Settled',
        color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
        icon: BadgeCheck
      }
    }
    if (txn.wallet_credited) {
      return {
        label: 'Settled',
        color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
        icon: CheckCircle
      }
    }
    const status = (txn.display_status || txn.status || '').toUpperCase()
    if (status === 'SUCCESS' || status === 'CAPTURED') {
      return {
        label: 'Unsettled',
        color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
        icon: Clock
      }
    }
    if (status === 'FAILED') {
      return {
        label: 'N/A',
        color: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
        icon: XCircle
      }
    }
    return {
      label: 'Pending',
      color: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
      icon: Clock
    }
  }

  // ---- Filtered transactions (by settlement filter, applied client-side) ----
  const filteredTransactions = useMemo(() => {
    if (settlementFilter === 'all') return transactions
    if (settlementFilter === 'unsettled') {
      return transactions.filter(t => isEligibleForInstaCash(t))
    }
    if (settlementFilter === 'instacash') {
      return transactions.filter(t => t.settlement_mode === 'INSTACASH')
    }
    if (settlementFilter === 't1') {
      return transactions.filter(t => t.settlement_mode === 'AUTO_T1')
    }
    if (settlementFilter === 'settled') {
      return transactions.filter(t => t.wallet_credited)
    }
    return transactions
  }, [transactions, settlementFilter])

  // ---- Selection helpers ----
  const eligibleTransactions = useMemo(
    () => filteredTransactions.filter(isEligibleForInstaCash),
    [filteredTransactions]
  )

  const allEligibleSelected = eligibleTransactions.length > 0 &&
    eligibleTransactions.every(t => selectedIds.has(t.id))

  const someSelected = selectedIds.size > 0

  const selectedTransactions = useMemo(
    () => filteredTransactions.filter(t => selectedIds.has(t.id)),
    [filteredTransactions, selectedIds]
  )

  const selectedTotal = useMemo(
    () => selectedTransactions.reduce((sum, t) => sum + (Number(t.amount) || 0), 0),
    [selectedTransactions]
  )

  const toggleSelectAll = () => {
    if (allEligibleSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(eligibleTransactions.map(t => t.id)))
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ---- InstaCash handler ----
  const handleInstaCash = async () => {
    if (selectedIds.size === 0) return
    
    const confirmed = window.confirm(
      `Process InstaCash for ${selectedIds.size} transaction(s) totalling ${formatAmount(selectedTotal)}?\n\nMDR at T+0 rates will be deducted. Net amount will be credited to your wallet instantly.`
    )
    if (!confirmed) return

    try {
      setInstaCashLoading(true)
      setInstaCashResult(null)

      const response = await apiFetch('/api/pos/instacash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_ids: Array.from(selectedIds) })
      })

      const result = await response.json()

      if (result.success) {
        setInstaCashResult({
          success: true,
          message: result.message || `InstaCash complete! ${result.summary?.settled || selectedIds.size} transaction(s) settled.`,
          summary: result.summary
        })
        setSelectedIds(new Set())
        // Refresh the table to show updated settlement statuses
        await fetchTransactions()
      } else {
        setInstaCashResult({
          success: false,
          message: result.error || 'InstaCash processing failed. Please try again.'
        })
      }
    } catch (err: any) {
      console.error('InstaCash error:', err)
      setInstaCashResult({
        success: false,
        message: err.message || 'Network error. Please try again.'
      })
    } finally {
      setInstaCashLoading(false)
    }
  }

  // ---- Status badge ----
  const getStatusBadge = (status: string, displayStatus?: string) => {
    const s = (displayStatus || status || '').toUpperCase()
    const configs: Record<string, { color: string; icon: any; label: string }> = {
      'SUCCESS': { color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400', icon: CheckCircle, label: 'Success' },
      'CAPTURED': { color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400', icon: CheckCircle, label: 'Captured' },
      'AUTHORIZED': { color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400', icon: Clock, label: 'Authorized' },
      'PENDING': { color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400', icon: Clock, label: 'Pending' },
      'FAILED': { color: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400', icon: XCircle, label: 'Failed' },
      'REFUNDED': { color: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300', icon: AlertCircle, label: 'Refunded' },
    }

    const config = configs[s] || configs['PENDING']
    const Icon = config.icon

    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-full ${config.color}`}>
        <Icon className="w-3 h-3" />
        {config.label}
      </span>
    )
  }

  const getPaymentModeIcon = (mode: string | null) => {
    if (!mode) return null
    const m = mode.toUpperCase()
    if (m === 'CARD') return <CreditCard className="w-3.5 h-3.5" />
    if (m === 'UPI') return <Smartphone className="w-3.5 h-3.5" />
    return null
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    try {
      const d = new Date(dateStr)
      return d.toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
        timeZone: 'Asia/Kolkata'
      })
    } catch {
      return dateStr
    }
  }

  const formatAmount = (amount: number | null) => {
    if (amount == null) return '\u20B90.00'
    return `\u20B9${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  const handleExport = () => {
    const csv = [
      ['Date/Time', 'TID', 'Device Serial', 'Amount', 'Status', 'Settlement', 'Payment Mode', 'Card Brand', 'Card Classification', 'MDR Rate', 'Net Amount', 'Transaction ID'].join(','),
      ...filteredTransactions.map(t => [
        t.transaction_time ? new Date(t.transaction_time).toISOString() : '',
        t.tid || '',
        t.device_serial || '',
        t.amount || 0,
        t.display_status || t.status || '',
        getSettlementStatus(t).label,
        t.payment_mode || '',
        t.card_brand || '',
        t.card_classification || '',
        t.mdr_rate != null ? `${t.mdr_rate}%` : '',
        t.net_amount || '',
        t.txn_id || ''
      ].join(','))
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pos-transactions-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  const resetFilters = () => {
    setStatusFilter('all')
    setSettlementFilter('all')
    setDateFrom('')
    setDateTo('')
    setTidFilter('')
    setPage(1)
  }

  const hasActiveFilters = statusFilter !== 'all' || settlementFilter !== 'all' || dateFrom || dateTo || tidFilter

  // ---- Summary stats ----
  const summaryStats = useMemo(() => {
    const successTxns = transactions.filter(t => ['SUCCESS', 'CAPTURED'].includes((t.display_status || t.status || '').toUpperCase()))
    const unsettled = successTxns.filter(t => !t.wallet_credited && !t.settlement_mode)
    const instaCashSettled = transactions.filter(t => t.settlement_mode === 'INSTACASH')
    const t1Settled = transactions.filter(t => t.settlement_mode === 'AUTO_T1')
    const allSettled = transactions.filter(t => t.wallet_credited)

    return {
      total: total,
      totalAmount: transactions.reduce((sum, t) => sum + (Number(t.amount) || 0), 0),
      successful: successTxns.length,
      unsettledCount: unsettled.length,
      unsettledAmount: unsettled.reduce((sum, t) => sum + (Number(t.amount) || 0), 0),
      instaCashCount: instaCashSettled.length,
      t1Count: t1Settled.length,
      settledCount: allSettled.length,
      devices: new Set(transactions.map(t => t.device_serial).filter(Boolean)).size,
    }
  }, [transactions, total])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-blue-600" />
            POS Transactions
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {total} transaction{total !== 1 ? 's' : ''} from your POS devices
            {summaryStats.unsettledCount > 0 && (
              <span className="ml-2 text-amber-600 dark:text-amber-400 font-medium">
                ({summaryStats.unsettledCount} unsettled)
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* InstaCash Button */}
          {user?.role === 'retailer' && someSelected && (
            <motion.button
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              onClick={handleInstaCash}
              disabled={instaCashLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold text-sm shadow-lg shadow-amber-200/50 dark:shadow-amber-900/30 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {instaCashLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Zap className="w-4 h-4" />
              )}
              InstaCash ({selectedIds.size}) &middot; {formatAmount(selectedTotal)}
            </motion.button>
          )}
          <button
            onClick={fetchTransactions}
            disabled={loading}
            className="p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 text-gray-600 dark:text-gray-300 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-sm ${
              hasActiveFilters
                ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-400'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            <Filter className="w-4 h-4" />
            Filters
            {hasActiveFilters && (
              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
            )}
          </button>
          <button
            onClick={handleExport}
            disabled={filteredTransactions.length === 0}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {/* InstaCash Result Banner */}
      <AnimatePresence>
        {instaCashResult && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`rounded-xl p-4 border ${
              instaCashResult.success
                ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
            }`}
          >
            <div className="flex items-start gap-3">
              {instaCashResult.success ? (
                <Zap className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
              )}
              <div className="flex-1">
                <p className={`text-sm font-semibold ${
                  instaCashResult.success 
                    ? 'text-emerald-800 dark:text-emerald-300' 
                    : 'text-red-800 dark:text-red-300'
                }`}>
                  {instaCashResult.success ? 'InstaCash Successful!' : 'InstaCash Failed'}
                </p>
                <p className={`text-sm mt-0.5 ${
                  instaCashResult.success 
                    ? 'text-emerald-700 dark:text-emerald-400' 
                    : 'text-red-700 dark:text-red-400'
                }`}>
                  {instaCashResult.message}
                </p>
                {instaCashResult.summary && (
                  <div className="flex flex-wrap gap-4 mt-2 text-xs text-emerald-600 dark:text-emerald-400">
                    <span>Gross: {formatAmount(instaCashResult.summary.total_gross_amount)}</span>
                    <span>MDR: {formatAmount(instaCashResult.summary.total_mdr_amount)}</span>
                    <span className="font-bold">Net Credited: {formatAmount(instaCashResult.summary.total_net_amount)}</span>
                  </div>
                )}
              </div>
              <button
                onClick={() => setInstaCashResult(null)}
                className="p-1 hover:bg-black/10 rounded-lg transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filter Panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 overflow-hidden"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Filter Transactions</h3>
              {hasActiveFilters && (
                <button
                  onClick={resetFilters}
                  className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 flex items-center gap-1"
                >
                  <X className="w-3 h-3" /> Clear all
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">From Date</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">To Date</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Transaction Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                >
                  <option value="all">All Status</option>
                  <option value="AUTHORIZED">Authorized</option>
                  <option value="CAPTURED">Captured</option>
                  <option value="FAILED">Failed</option>
                  <option value="REFUNDED">Refunded</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Settlement Status</label>
                <select
                  value={settlementFilter}
                  onChange={(e) => { setSettlementFilter(e.target.value) }}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                >
                  <option value="all">All Settlement</option>
                  <option value="unsettled">Unsettled</option>
                  <option value="instacash">InstaCash</option>
                  <option value="t1">T+1 Settled</option>
                  <option value="settled">All Settled</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">TID / Device</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={tidFilter}
                    onChange={(e) => { setTidFilter(e.target.value); setPage(1) }}
                    placeholder="Search TID or Device"
                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
          <p className="text-sm text-red-800 dark:text-red-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </p>
        </div>
      )}

      {/* Summary Cards */}
      {transactions.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">Total Txns</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{summaryStats.total}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">Total Amount</p>
            <p className="text-lg font-bold text-green-600 dark:text-green-400">
              {formatAmount(summaryStats.totalAmount)}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3 text-amber-500" />
              <p className="text-xs text-amber-600 dark:text-amber-400">Unsettled</p>
            </div>
            <p className="text-lg font-bold text-amber-600 dark:text-amber-400">{summaryStats.unsettledCount}</p>
            <p className="text-xs text-amber-500 dark:text-amber-500">{formatAmount(summaryStats.unsettledAmount)}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
            <div className="flex items-center gap-1">
              <Zap className="w-3 h-3 text-emerald-500" />
              <p className="text-xs text-emerald-600 dark:text-emerald-400">InstaCash</p>
            </div>
            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{summaryStats.instaCashCount}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
            <div className="flex items-center gap-1">
              <BadgeCheck className="w-3 h-3 text-blue-500" />
              <p className="text-xs text-blue-600 dark:text-blue-400">T+1 Settled</p>
            </div>
            <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{summaryStats.t1Count}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">Active Devices</p>
            <p className="text-lg font-bold text-purple-600 dark:text-purple-400">{summaryStats.devices}</p>
          </div>
        </div>
      )}

      {/* Transactions Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
              <tr>
                {/* Checkbox column */}
                {user?.role === 'retailer' && (
                  <th className="px-3 py-3 text-center w-10">
                    <button
                      onClick={toggleSelectAll}
                      className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                      title={allEligibleSelected ? 'Deselect all' : 'Select all unsettled'}
                    >
                      {allEligibleSelected && eligibleTransactions.length > 0 ? (
                        <CheckSquare className="w-4 h-4 text-amber-500" />
                      ) : (
                        <Square className="w-4 h-4 text-gray-400" />
                      )}
                    </button>
                  </th>
                )}
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Date & Time
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  TID
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Mode
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Card / Brand
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Txn Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Settlement
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Details
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
              {loading && transactions.length === 0 ? (
                <tr>
                  <td colSpan={user?.role === 'retailer' ? 9 : 8} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center">
                      <RefreshCw className="w-6 h-6 animate-spin text-blue-500 mb-2" />
                      <span className="text-sm text-gray-500 dark:text-gray-400">Loading POS transactions...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={user?.role === 'retailer' ? 9 : 8} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center">
                      <CreditCard className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-3" />
                      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No POS transactions found</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        {settlementFilter !== 'all' 
                          ? 'Try changing the settlement filter' 
                          : 'Transactions will appear here after a POS payment is made'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((txn) => {
                  const eligible = isEligibleForInstaCash(txn)
                  const isSelected = selectedIds.has(txn.id)
                  const settlement = getSettlementStatus(txn)
                  const SettlementIcon = settlement.icon

                  return (
                    <tr 
                      key={txn.id} 
                      className={`transition-colors ${
                        isSelected 
                          ? 'bg-amber-50/60 dark:bg-amber-900/10 hover:bg-amber-50 dark:hover:bg-amber-900/20' 
                          : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'
                      }`}
                    >
                      {/* Checkbox */}
                      {user?.role === 'retailer' && (
                        <td className="px-3 py-3 text-center">
                          {eligible ? (
                            <button
                              onClick={() => toggleSelect(txn.id)}
                              className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                            >
                              {isSelected ? (
                                <CheckSquare className="w-4 h-4 text-amber-500" />
                              ) : (
                                <Square className="w-4 h-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" />
                              )}
                            </button>
                          ) : (
                            <span className="inline-block w-4 h-4" />
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                        {formatDate(txn.transaction_time)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-sm font-mono font-medium text-gray-900 dark:text-white">
                          {txn.tid || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right">
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">
                          {formatAmount(txn.amount)}
                        </span>
                        {txn.net_amount != null && txn.net_amount !== txn.amount && (
                          <div className="text-[10px] text-gray-500 dark:text-gray-400">
                            Net: {formatAmount(txn.net_amount)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
                          {getPaymentModeIcon(txn.payment_mode)}
                          {txn.payment_mode || '-'}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="text-xs">
                          {txn.card_brand ? (
                            <span className="text-gray-700 dark:text-gray-300 font-medium">{txn.card_brand}</span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                          {txn.card_classification && (
                            <span className="block text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                              {txn.card_classification}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {getStatusBadge(txn.status, txn.display_status)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-full ${settlement.color}`}>
                          <SettlementIcon className="w-3 h-3" />
                          {settlement.label}
                        </span>
                        {txn.mdr_rate != null && txn.wallet_credited && (
                          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                            MDR: {txn.mdr_rate}%
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-center">
                        <button
                          onClick={() => setSelectedTxn(txn)}
                          className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                          title="View Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Page {page} of {totalPages} ({total} total)
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedTxn && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedTxn(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-4 bg-gradient-to-r from-blue-500 to-blue-600 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Transaction Details</h3>
                <button
                  onClick={() => setSelectedTxn(null)}
                  className="p-1 hover:bg-white/20 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-white" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="text-center mb-4">
                  <p className="text-3xl font-bold text-gray-900 dark:text-white">
                    {formatAmount(selectedTxn.amount)}
                  </p>
                  <div className="mt-2 flex items-center justify-center gap-2 flex-wrap">
                    {getStatusBadge(selectedTxn.status, selectedTxn.display_status)}
                    {(() => {
                      const s = getSettlementStatus(selectedTxn)
                      const SIcon = s.icon
                      return (
                        <span className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-full ${s.color}`}>
                          <SIcon className="w-3 h-3" />
                          {s.label}
                        </span>
                      )
                    })()}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <DetailRow label="Transaction ID" value={selectedTxn.txn_id} mono />
                  <DetailRow label="Terminal ID" value={selectedTxn.tid || '-'} mono />
                  <DetailRow label="Device Serial" value={selectedTxn.device_serial || '-'} mono />
                  <DetailRow label="Payment Mode" value={selectedTxn.payment_mode || '-'} />
                  <DetailRow label="Status" value={selectedTxn.status} />
                  <DetailRow label="Merchant" value={selectedTxn.merchant_name || '-'} />
                  <DetailRow 
                    label="Transaction Time" 
                    value={formatDate(selectedTxn.transaction_time)} 
                    fullWidth 
                  />

                  {/* Card Details */}
                  {selectedTxn.card_brand && (
                    <DetailRow label="Card Brand" value={selectedTxn.card_brand} />
                  )}
                  {selectedTxn.card_type && (
                    <DetailRow label="Card Type" value={selectedTxn.card_type} />
                  )}
                  {selectedTxn.card_classification && (
                    <DetailRow label="Card Classification" value={selectedTxn.card_classification} />
                  )}
                  {selectedTxn.rrn && (
                    <DetailRow label="RRN" value={selectedTxn.rrn} mono />
                  )}
                  {selectedTxn.auth_code && (
                    <DetailRow label="Auth Code" value={selectedTxn.auth_code} mono />
                  )}

                  {/* Settlement Details */}
                  {selectedTxn.settlement_mode && (
                    <DetailRow 
                      label="Settlement Mode" 
                      value={selectedTxn.settlement_mode === 'INSTACASH' ? 'InstaCash (T+0)' : 'Auto T+1'} 
                    />
                  )}
                  {selectedTxn.mdr_rate != null && (
                    <DetailRow label="MDR Rate" value={`${selectedTxn.mdr_rate}%`} />
                  )}
                  {selectedTxn.mdr_amount != null && (
                    <DetailRow label="MDR Amount" value={formatAmount(selectedTxn.mdr_amount)} />
                  )}
                  {selectedTxn.net_amount != null && (
                    <DetailRow label="Net Amount" value={formatAmount(selectedTxn.net_amount)} />
                  )}

                  {/* Legacy raw_data fields */}
                  {selectedTxn.raw_data?.rrNumber && !selectedTxn.rrn && (
                    <DetailRow label="RRN" value={selectedTxn.raw_data.rrNumber} mono />
                  )}
                  {selectedTxn.raw_data?.authCode && !selectedTxn.auth_code && (
                    <DetailRow label="Auth Code" value={selectedTxn.raw_data.authCode} mono />
                  )}
                  {selectedTxn.raw_data?.cardType && !selectedTxn.card_type && (
                    <DetailRow label="Card Type" value={selectedTxn.raw_data.cardType} />
                  )}
                  {selectedTxn.raw_data?.cardBrand && !selectedTxn.card_brand && (
                    <DetailRow label="Card Brand" value={selectedTxn.raw_data.cardBrand} />
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function DetailRow({ label, value, mono, fullWidth }: { label: string; value: string; mono?: boolean; fullWidth?: boolean }) {
  return (
    <div className={fullWidth ? 'col-span-2' : ''}>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{label}</p>
      <p className={`text-sm text-gray-900 dark:text-white break-all ${mono ? 'font-mono' : ''}`}>
        {value}
      </p>
    </div>
  )
}
