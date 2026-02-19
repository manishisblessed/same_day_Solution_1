'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { 
  Search, RefreshCw, Download, Filter, Calendar,
  ChevronLeft, ChevronRight, CheckCircle, XCircle, 
  Clock, AlertCircle, CreditCard, Eye, X, Smartphone
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
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [tidFilter, setTidFilter] = useState('')
  
  // Detail modal
  const [selectedTxn, setSelectedTxn] = useState<RazorpayPOSTransaction | null>(null)

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
    if (amount == null) return '₹0.00'
    return `₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  const handleExport = () => {
    const csv = [
      ['Date/Time', 'TID', 'Device Serial', 'Amount', 'Status', 'Payment Mode', 'Transaction ID'].join(','),
      ...transactions.map(t => [
        t.transaction_time ? new Date(t.transaction_time).toISOString() : '',
        t.tid || '',
        t.device_serial || '',
        t.amount || 0,
        t.display_status || t.status || '',
        t.payment_mode || '',
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
    setDateFrom('')
    setDateTo('')
    setTidFilter('')
    setPage(1)
  }

  const hasActiveFilters = statusFilter !== 'all' || dateFrom || dateTo || tidFilter

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
          </p>
        </div>
        <div className="flex items-center gap-2">
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
            disabled={transactions.length === 0}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Status</label>
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">Total Transactions</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{total}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">Total Amount</p>
            <p className="text-lg font-bold text-green-600 dark:text-green-400">
              {formatAmount(transactions.reduce((sum, t) => sum + (Number(t.amount) || 0), 0))}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">Successful</p>
            <p className="text-lg font-bold text-blue-600 dark:text-blue-400">
              {transactions.filter(t => ['SUCCESS', 'CAPTURED'].includes((t.display_status || t.status || '').toUpperCase())).length}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">Active Devices</p>
            <p className="text-lg font-bold text-purple-600 dark:text-purple-400">
              {new Set(transactions.map(t => t.device_serial).filter(Boolean)).size}
            </p>
          </div>
        </div>
      )}

      {/* Transactions Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Date & Time
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  TID
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Device Serial
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Payment Mode
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Details
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
              {loading && transactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center">
                      <RefreshCw className="w-6 h-6 animate-spin text-blue-500 mb-2" />
                      <span className="text-sm text-gray-500 dark:text-gray-400">Loading POS transactions...</span>
                    </div>
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center">
                      <CreditCard className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-3" />
                      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No POS transactions found</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        Transactions will appear here after a POS payment is made
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                transactions.map((txn) => (
                  <tr 
                    key={txn.id} 
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                      {formatDate(txn.transaction_time)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-sm font-mono font-medium text-gray-900 dark:text-white">
                        {txn.tid || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-sm font-mono text-gray-600 dark:text-gray-400">
                        {txn.device_serial || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right">
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">
                        {formatAmount(txn.amount)}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
                        {getPaymentModeIcon(txn.payment_mode)}
                        {txn.payment_mode || '-'}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {getStatusBadge(txn.status, txn.display_status)}
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
                ))
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
              className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
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
                  <div className="mt-2">
                    {getStatusBadge(selectedTxn.status, selectedTxn.display_status)}
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
                  {selectedTxn.raw_data?.rrNumber && (
                    <DetailRow label="RRN" value={selectedTxn.raw_data.rrNumber} mono />
                  )}
                  {selectedTxn.raw_data?.authCode && (
                    <DetailRow label="Auth Code" value={selectedTxn.raw_data.authCode} mono />
                  )}
                  {selectedTxn.raw_data?.cardType && (
                    <DetailRow label="Card Type" value={selectedTxn.raw_data.cardType} />
                  )}
                  {selectedTxn.raw_data?.cardBrand && (
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

