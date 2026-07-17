'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { apiFetch } from '@/lib/api-client'
import NetworkUserFilter, { NetworkFilterValue } from '@/components/reports/NetworkUserFilter'
import {
  FileBarChart, Download, Calendar, Filter, Search,
  RefreshCw, IndianRupee, CheckCircle2, XCircle, Clock,
  ChevronLeft, ChevronRight, CreditCard, Loader2
} from 'lucide-react'

interface POSTransaction {
  date: string
  transaction_id: string
  tid: string
  merchant_name: string
  card_type: string
  amount: number
  mdr_rate: number
  mdr_amount: number
  settlement_amount: number
  status: string
  retailer_id?: string
  retailer_name?: string
}

interface Summary {
  total_transactions: number
  total_amount: number
  total_mdr: number
  total_settlement: number
  success_count: number
  failed_count: number
  pending_count: number
}

interface Pagination {
  total: number
  limit: number
  offset: number
  page: number
  totalPages: number
}

type DatePreset = 'today' | 'yesterday' | 'week' | 'month' | 'quarter' | 'custom'

interface POSTransactionReportProps {
  userRole: 'admin' | 'finance_executive' | 'master_distributor' | 'distributor' | 'retailer' | 'partner'
  userName?: string
}

export default function POSTransactionReport({ userRole, userName }: POSTransactionReportProps) {
  const [transactions, setTransactions] = useState<POSTransaction[]>([])
  const [summary, setSummary] = useState<Summary>({
    total_transactions: 0, total_amount: 0, total_mdr: 0,
    total_settlement: 0, success_count: 0, failed_count: 0, pending_count: 0,
  })
  const [pagination, setPagination] = useState<Pagination>({
    total: 0, limit: 25, offset: 0, page: 1, totalPages: 0,
  })
  const [rowsPerPage, setRowsPerPage] = useState<10 | 25 | 100>(25)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)

  const [datePreset, setDatePreset] = useState<DatePreset>('month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [searchTerm, setSearchTerm] = useState('')

  const [networkFilter, setNetworkFilter] = useState<NetworkFilterValue | null>(null)

  const applyNetworkUserParams = useCallback((params: URLSearchParams) => {
    if (!networkFilter) return
    if (networkFilter.user_id) params.set('user_id', networkFilter.user_id)
    if (networkFilter.distributor_id) params.set('distributor_id', networkFilter.distributor_id)
    if (networkFilter.md_id) params.set('md_id', networkFilter.md_id)
    if (networkFilter.partner_id) params.set('partner_id', networkFilter.partner_id)
  }, [networkFilter])

  const getDateRange = useCallback(() => {
    const now = new Date()
    let start: string
    let end: string = now.toISOString()
    switch (datePreset) {
      case 'today':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
        break
      case 'yesterday': {
        const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
        start = y.toISOString()
        end = new Date(y.getTime() + 86399999).toISOString()
        break
      }
      case 'week':
        start = new Date(now.getTime() - 7 * 86400000).toISOString()
        break
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
        break
      case 'quarter':
        start = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString()
        break
      case 'custom':
        start = dateFrom ? new Date(dateFrom).toISOString() : new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
        end = dateTo ? new Date(dateTo + 'T23:59:59').toISOString() : now.toISOString()
        break
      default:
        start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    }
    return { start, end }
  }, [datePreset, dateFrom, dateTo])

  const fetchReport = useCallback(async (page = 1) => {
    setLoading(true)
    setError('')
    try {
      const { start, end } = getDateRange()
      const offset = (page - 1) * rowsPerPage
      const params = new URLSearchParams({
        date_from: start,
        date_to: end,
        limit: String(rowsPerPage),
        offset: String(offset),
      })
      if (statusFilter) params.set('status', statusFilter)
      if (searchTerm) params.set('search', searchTerm)
      applyNetworkUserParams(params)

      const res = await apiFetch(`/api/reports/pos-report?${params.toString()}`)
      const json = await res.json()

      if (!res.ok) throw new Error(json.error || 'Failed to fetch report')

      setTransactions(json.data || [])
      setSummary(json.summary || {
        total_transactions: 0, total_amount: 0, total_mdr: 0,
        total_settlement: 0, success_count: 0, failed_count: 0, pending_count: 0,
      })
      setPagination(json.pagination || {
        total: 0, limit: rowsPerPage, offset: 0, page: 1, totalPages: 0,
      })
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [getDateRange, statusFilter, searchTerm, rowsPerPage, applyNetworkUserParams])

  useEffect(() => {
    fetchReport(1)
  }, [fetchReport, datePreset, dateFrom, dateTo, statusFilter, rowsPerPage, networkFilter])

  const handleSearch = () => fetchReport(1)
  const handlePageChange = (page: number) => fetchReport(page)

  const handleExport = async () => {
    setExporting(true)
    try {
      const { start, end } = getDateRange()
      const params = new URLSearchParams({
        date_from: start,
        date_to: end,
        limit: '10000',
        offset: '0',
        format: 'excel',
      })
      if (statusFilter) params.set('status', statusFilter)
      if (searchTerm) params.set('search', searchTerm)
      applyNetworkUserParams(params)

      const res = await apiFetch(`/api/reports/pos-report?${params.toString()}`)
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error || 'Export failed')
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `pos_transactions_${Date.now()}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err: any) {
      alert(err.message || 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const formatCurrency = (amount: number) =>
    `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const getStatusClasses = (status: string) => {
    const s = status.toLowerCase()
    if (['success', 'captured'].includes(s)) return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    if (s === 'failed') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
    return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
  }

  const getStatusIcon = (status: string) => {
    const s = status.toLowerCase()
    if (['success', 'captured'].includes(s)) return <CheckCircle2 className="w-3 h-3" />
    if (s === 'failed') return <XCircle className="w-3 h-3" />
    return <Clock className="w-3 h-3" />
  }

  const roleLabel =
    userRole === 'admin' ? 'Admin'
    : userRole === 'finance_executive' ? 'Finance'
    : userRole === 'master_distributor' ? 'Master Distributor'
    : userRole === 'distributor' ? 'Distributor'
    : userRole === 'partner' ? 'Partner'
    : 'Retailer'

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl shadow-lg">
              <CreditCard className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                POS Transaction Report
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {roleLabel} view &middot; {userName || ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleExport}
              disabled={exporting || loading}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors shadow-md disabled:opacity-50"
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Export Excel
            </button>
            <button
              onClick={() => fetchReport(pagination.page)}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </motion.div>

      {/* Summary Cards */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <SummaryCard icon={<FileBarChart className="w-6 h-6" />} label="Total Transactions" value={String(summary.total_transactions)} gradient="from-blue-500 to-blue-600" />
        <SummaryCard icon={<IndianRupee className="w-6 h-6" />} label="Total Amount" value={formatCurrency(summary.total_amount)} gradient="from-emerald-500 to-emerald-600" />
        <SummaryCard icon={<CreditCard className="w-6 h-6" />} label="Total MDR" value={formatCurrency(summary.total_mdr)} gradient="from-amber-500 to-orange-600" />
        <SummaryCard icon={<IndianRupee className="w-6 h-6" />} label="Total Settlement" value={formatCurrency(summary.total_settlement)} gradient="from-purple-500 to-purple-600" />
      </motion.div>

      {/* Status Count Bar */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
        className="flex flex-wrap gap-4"
      >
        <div className="flex items-center gap-2 px-4 py-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
          <span className="text-sm font-semibold text-green-700 dark:text-green-300">{summary.success_count}</span>
          <span className="text-xs text-green-600 dark:text-green-400">Success</span>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
          <span className="text-sm font-semibold text-red-700 dark:text-red-300">{summary.failed_count}</span>
          <span className="text-xs text-red-600 dark:text-red-400">Failed</span>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <Clock className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
          <span className="text-sm font-semibold text-yellow-700 dark:text-yellow-300">{summary.pending_count}</span>
          <span className="text-xs text-yellow-600 dark:text-yellow-400">Pending</span>
        </div>
      </motion.div>

      {/* Filters Bar */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-lg border border-gray-100 dark:border-gray-700"
      >
        <div className="flex flex-wrap gap-4 items-end">
          <div className="min-w-[160px]">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Date Range</label>
            <select value={datePreset} onChange={e => setDatePreset(e.target.value as DatePreset)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="week">Last 7 Days</option>
              <option value="month">This Month</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>

          {datePreset === 'custom' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">From</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">To</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500" />
              </div>
            </>
          )}

          {userRole !== 'retailer' && userRole !== 'partner' && (
            <div className="min-w-[230px]">
              <NetworkUserFilter userRole={userRole} onChange={setNetworkFilter} />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Status</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="FAILED">FAILED</option>
              <option value="PENDING">PENDING</option>
            </select>
          </div>

          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search by Transaction ID..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          <button
            onClick={handleSearch}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Filter className="w-4 h-4 inline mr-1" />
            Apply
          </button>
        </div>
      </motion.div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-center gap-3">
          <XCircle className="w-5 h-5 text-red-500" />
          <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
        </div>
      )}

      {/* Data Table */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
        className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase whitespace-nowrap">Date & Time</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase whitespace-nowrap">Transaction ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase whitespace-nowrap">TID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase whitespace-nowrap">Merchant</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase whitespace-nowrap">Card Type</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase whitespace-nowrap">Amount</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase whitespace-nowrap">MDR Rate</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase whitespace-nowrap">MDR Amount</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase whitespace-nowrap">Settlement</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase whitespace-nowrap">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                      <span className="text-sm text-gray-500">Loading transactions...</span>
                    </div>
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-6 py-16 text-center text-gray-500 dark:text-gray-400">
                    <div className="flex flex-col items-center gap-2">
                      <CreditCard className="w-10 h-10 text-gray-300 dark:text-gray-600" />
                      <span>No transactions found for the selected criteria</span>
                    </div>
                  </td>
                </tr>
              ) : (
                transactions.map((txn, idx) => (
                  <motion.tr
                    key={txn.transaction_id + idx}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: idx * 0.02 }}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white whitespace-nowrap">
                      {new Date(txn.date).toLocaleDateString('en-IN', {
                        timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: '2-digit',
                      })}
                      <br />
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {new Date(txn.date).toLocaleTimeString('en-IN', {
                          timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-[160px]" title={txn.transaction_id}>
                      <span className="text-xs font-mono text-gray-600 dark:text-gray-400 block truncate">
                        {txn.transaction_id}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-indigo-600 dark:text-indigo-400 font-semibold whitespace-nowrap">
                      {txn.tid}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white max-w-[150px] truncate" title={txn.merchant_name}>
                      {txn.merchant_name}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                        {txn.card_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white text-right whitespace-nowrap">
                      {formatCurrency(txn.amount)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 text-right whitespace-nowrap">
                      {(txn.mdr_rate * 100).toFixed(2)}%
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 text-right whitespace-nowrap">
                      {formatCurrency(txn.mdr_amount)}
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white text-right whitespace-nowrap">
                      {formatCurrency(txn.settlement_amount)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${getStatusClasses(txn.status)}`}>
                        {getStatusIcon(txn.status)}
                        {txn.status}
                      </span>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.total > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <span>Rows per page:</span>
              <select
                value={rowsPerPage}
                onChange={(e) => setRowsPerPage(Number(e.target.value) as 10 | 25 | 100)}
                className="px-2 py-1 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={100}>100</option>
              </select>
              <span className="text-xs">
                {(pagination.page - 1) * rowsPerPage + 1}–{Math.min(pagination.page * rowsPerPage, pagination.total)} of {pagination.total}
              </span>
            </div>
            {pagination.totalPages > 1 && (
              <div className="flex gap-2">
                <button
                  onClick={() => handlePageChange(pagination.page - 1)}
                  disabled={pagination.page <= 1}
                  className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                  let page: number
                  if (pagination.totalPages <= 5) {
                    page = i + 1
                  } else if (pagination.page <= 3) {
                    page = i + 1
                  } else if (pagination.page >= pagination.totalPages - 2) {
                    page = pagination.totalPages - 4 + i
                  } else {
                    page = pagination.page - 2 + i
                  }
                  return (
                    <button
                      key={page}
                      onClick={() => handlePageChange(page)}
                      className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${
                        page === pagination.page
                          ? 'bg-indigo-600 text-white'
                          : 'border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {page}
                    </button>
                  )
                })}
                <button
                  onClick={() => handlePageChange(pagination.page + 1)}
                  disabled={pagination.page >= pagination.totalPages}
                  className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  )
}

function SummaryCard({ icon, label, value, gradient }: { icon: React.ReactNode; label: string; value: string; gradient: string }) {
  return (
    <div className={`bg-gradient-to-br ${gradient} rounded-xl p-5 text-white shadow-lg`}>
      <div className="flex items-center justify-between mb-2">
        <div className="opacity-80">{icon}</div>
      </div>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm opacity-80 mt-0.5">{label}</p>
    </div>
  )
}
