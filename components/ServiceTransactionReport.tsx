'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api-client'
import {
  FileBarChart, Download, Calendar, Filter, Search,
  FileSpreadsheet, FileText, RefreshCw,
  IndianRupee, Receipt, CheckCircle2, XCircle, Clock,
  BarChart3, Eye, X, ChevronLeft, ChevronRight,
  CreditCard, Smartphone, Banknote, Globe, ArrowUpDown,
  AlertTriangle, Loader2
} from 'lucide-react'

// ============================================================================
// TYPES
// ============================================================================

interface Transaction {
  id: string
  service_type: string
  transaction_id: string
  tid: string | null
  amount: number
  status: string
  commission: number
  mdr: number
  mdr_rate: number
  settlement_type: string
  scheme_name: string
  scheme_id: string | null
  retailer_id: string | null
  retailer_name: string | null
  distributor_id: string | null
  distributor_name: string | null
  master_distributor_id: string | null
  md_name: string | null
  payment_mode: string | null
  card_type: string | null
  device_serial: string | null
  description: string | null
  created_at: string
  raw: Record<string, any>
}

interface Summary {
  total_transactions: number
  total_amount: number
  total_commission: number
  total_mdr: number
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

type ServiceFilter = 'all' | 'pos' | 'bbps' | 'aeps' | 'settlement'
type DatePreset = 'today' | 'yesterday' | 'week' | 'month' | 'quarter' | 'custom'

interface ServiceTransactionReportProps {
  userRole: 'admin' | 'master_distributor' | 'distributor' | 'retailer'
  userName?: string
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function ServiceTransactionReport({ userRole, userName }: ServiceTransactionReportProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [summary, setSummary] = useState<Summary>({
    total_transactions: 0, total_amount: 0, total_commission: 0,
    total_mdr: 0, success_count: 0, failed_count: 0, pending_count: 0,
  })
  const [pagination, setPagination] = useState<Pagination>({
    total: 0, limit: 50, offset: 0, page: 1, totalPages: 0,
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Filters
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>('all')
  const [datePreset, setDatePreset] = useState<DatePreset>('month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [sortField, setSortField] = useState<'created_at' | 'amount'>('created_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  // View modal
  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null)
  const [showViewModal, setShowViewModal] = useState(false)

  // Export loading
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null)

  const serviceOptions: { value: ServiceFilter; label: string; icon: any; color: string }[] = [
    { value: 'all', label: 'All Services', icon: Globe, color: 'gray' },
    { value: 'pos', label: 'POS', icon: CreditCard, color: 'blue' },
    { value: 'bbps', label: 'BBPS', icon: Receipt, color: 'green' },
    { value: 'aeps', label: 'AEPS', icon: Smartphone, color: 'amber' },
    { value: 'settlement', label: 'Settlement', icon: Banknote, color: 'purple' },
  ]

  // ============================================================================
  // DATE HELPERS
  // ============================================================================

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
        start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1).toISOString()
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

  // ============================================================================
  // FETCH DATA
  // ============================================================================

  const fetchReport = useCallback(async (page = 1) => {
    setLoading(true)
    setError('')

    try {
      const { start, end } = getDateRange()
      const offset = (page - 1) * pagination.limit

      const params = new URLSearchParams({
        service: serviceFilter,
        date_from: start,
        date_to: end,
        limit: String(pagination.limit),
        offset: String(offset),
      })

      if (statusFilter) params.set('status', statusFilter)
      if (searchTerm) params.set('search', searchTerm)

      const res = await apiFetch(`/api/reports/service-transactions?${params.toString()}`)
      const json = await res.json()

      if (!res.ok) {
        throw new Error(json.error || 'Failed to fetch report')
      }

      setTransactions(json.data || [])
      setSummary(json.summary || {
        total_transactions: 0, total_amount: 0, total_commission: 0,
        total_mdr: 0, success_count: 0, failed_count: 0, pending_count: 0,
      })
      setPagination(json.pagination || {
        total: 0, limit: 50, offset: 0, page: 1, totalPages: 0,
      })
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
      console.error('[ServiceTransactionReport]', err)
    } finally {
      setLoading(false)
    }
  }, [getDateRange, serviceFilter, statusFilter, searchTerm, pagination.limit])

  useEffect(() => {
    fetchReport(1)
  }, [serviceFilter, datePreset, dateFrom, dateTo, statusFilter])

  const handleSearch = () => fetchReport(1)
  const handlePageChange = (page: number) => fetchReport(page)

  // ============================================================================
  // EXPORT
  // ============================================================================

  const handleExport = async (format: 'csv' | 'pdf') => {
    setExporting(format)
    try {
      const { start, end } = getDateRange()
      const params = new URLSearchParams({
        service: serviceFilter,
        date_from: start,
        date_to: end,
        limit: '10000',
        offset: '0',
        format,
      })
      if (statusFilter) params.set('status', statusFilter)
      if (searchTerm) params.set('search', searchTerm)

      const res = await apiFetch(`/api/reports/service-transactions?${params.toString()}`)

      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error || 'Export failed')
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `service_txn_report_${Date.now()}.${format === 'csv' ? 'csv' : 'html'}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err: any) {
      alert(err.message || 'Export failed')
    } finally {
      setExporting(null)
    }
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount)

  const getStatusClasses = (status: string) => {
    const s = status.toLowerCase()
    if (['success', 'captured'].includes(s)) return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    if (['failed'].includes(s)) return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
    return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
  }

  const getStatusIcon = (status: string) => {
    const s = status.toLowerCase()
    if (['success', 'captured'].includes(s)) return <CheckCircle2 className="w-3 h-3" />
    if (['failed'].includes(s)) return <XCircle className="w-3 h-3" />
    return <Clock className="w-3 h-3" />
  }

  const getServiceBadge = (service: string) => {
    const map: Record<string, string> = {
      'POS': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
      'BBPS': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
      'AEPS': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
      'Settlement': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    }
    return map[service] || 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400'
  }

  const sorted = [...transactions].sort((a, b) => {
    const mul = sortOrder === 'asc' ? 1 : -1
    if (sortField === 'amount') return mul * (a.amount - b.amount)
    return mul * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  })

  const roleLabel = userRole === 'admin' ? 'Admin' :
    userRole === 'master_distributor' ? 'Master Distributor' :
    userRole === 'distributor' ? 'Distributor' : 'Retailer'

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-lg">
              <FileBarChart className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Service Transaction Report
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {roleLabel} view &middot; {userName || ''}
              </p>
            </div>
          </div>
          <button
            onClick={() => fetchReport(pagination.page)}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </motion.div>

      {/* Service Filter Chips */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="flex flex-wrap gap-2"
      >
        {serviceOptions.map(opt => {
          const Icon = opt.icon
          const active = serviceFilter === opt.value
          return (
            <button
              key={opt.value}
              onClick={() => setServiceFilter(opt.value)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 text-sm font-medium transition-all ${
                active
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:border-gray-300'
              }`}
            >
              <Icon className="w-4 h-4" />
              {opt.label}
            </button>
          )
        })}
      </motion.div>

      {/* Filters Bar */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-lg border border-gray-100 dark:border-gray-700"
      >
        <div className="flex flex-wrap gap-4 items-end">
          <div className="min-w-[160px]">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Date Range</label>
            <select value={datePreset} onChange={e => setDatePreset(e.target.value as DatePreset)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm focus:ring-2 focus:ring-indigo-500"
            >
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="week">Last 7 Days</option>
              <option value="month">This Month</option>
              <option value="quarter">This Quarter</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>

          {datePreset === 'custom' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">From</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">To</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm focus:ring-2 focus:ring-indigo-500" />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Status</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All Status</option>
              <option value="success">Success</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
              <option value="captured">Captured</option>
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
                className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm focus:ring-2 focus:ring-indigo-500"
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

      {/* Summary Cards */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-4"
      >
        <SummaryCard icon={<IndianRupee className="w-6 h-6" />} label="Total Amount" value={formatCurrency(summary.total_amount)}
          gradient="from-blue-500 to-blue-600" />
        <SummaryCard icon={<Receipt className="w-6 h-6" />} label="Total Transactions" value={String(summary.total_transactions)}
          gradient="from-emerald-500 to-emerald-600" />
        <SummaryCard icon={<BarChart3 className="w-6 h-6" />} label="Total Commission" value={formatCurrency(summary.total_commission)}
          gradient="from-purple-500 to-purple-600" />
        <SummaryCard icon={<IndianRupee className="w-6 h-6" />} label="Total MDR" value={formatCurrency(summary.total_mdr)}
          gradient="from-amber-500 to-orange-600" />
      </motion.div>

      {/* Export + Count Bar */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="bg-white dark:bg-gray-800 rounded-xl px-6 py-4 shadow-lg border border-gray-100 dark:border-gray-700 flex flex-wrap items-center justify-between gap-4"
      >
        <div>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            <span className="font-semibold text-green-600">{summary.success_count}</span> success &middot;{' '}
            <span className="font-semibold text-red-600">{summary.failed_count}</span> failed &middot;{' '}
            <span className="font-semibold text-yellow-600">{summary.pending_count}</span> pending
          </span>
        </div>
        <div className="flex gap-3">
          <button onClick={() => handleExport('csv')} disabled={!!exporting}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-all shadow-md disabled:opacity-50"
          >
            {exporting === 'csv' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
            Export CSV
          </button>
          <button onClick={() => handleExport('pdf')} disabled={!!exporting}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-all shadow-md disabled:opacity-50"
          >
            {exporting === 'pdf' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            Export PDF
          </button>
        </div>
      </motion.div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500" />
          <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
        </div>
      )}

      {/* Data Table */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}
        className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                  <button onClick={() => { setSortField('created_at'); setSortOrder(p => p === 'asc' ? 'desc' : 'asc') }}
                    className="flex items-center gap-1 hover:text-gray-700">
                    Date <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Service</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Transaction ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                  <button onClick={() => { setSortField('amount'); setSortOrder(p => p === 'asc' ? 'desc' : 'asc') }}
                    className="flex items-center gap-1 hover:text-gray-700">
                    Amount <ArrowUpDown className="w-3 h-3" />
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Commission</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">MDR</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Settlement</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Scheme</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Retailer</th>
                {userRole !== 'retailer' && (
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Distributor</th>
                )}
                {(userRole === 'admin' || userRole === 'master_distributor') && (
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">MD</th>
                )}
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                <tr>
                  <td colSpan={20} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                      <span className="text-sm text-gray-500">Loading transactions...</span>
                    </div>
                  </td>
                </tr>
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={20} className="px-6 py-16 text-center text-gray-500 dark:text-gray-400">
                    <div className="flex flex-col items-center gap-2">
                      <Receipt className="w-10 h-10 text-gray-300" />
                      <span>No transactions found for the selected criteria</span>
                    </div>
                  </td>
                </tr>
              ) : (
                sorted.map((txn) => (
                  <tr key={txn.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white whitespace-nowrap">
                      {new Date(txn.created_at).toLocaleDateString('en-IN', {
                        day: '2-digit', month: 'short', year: '2-digit',
                      })}
                      <br />
                      <span className="text-xs text-gray-500">
                        {new Date(txn.created_at).toLocaleTimeString('en-IN', {
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${getServiceBadge(txn.service_type)}`}>
                        {txn.service_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 max-w-[160px]" title={txn.transaction_id}>
                      <span className="text-xs font-mono text-gray-600 dark:text-gray-400 block truncate">
                        {txn.transaction_id}
                      </span>
                      {txn.tid && (
                        <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold mt-0.5 block">
                          TID: {txn.tid}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white whitespace-nowrap">
                      {formatCurrency(txn.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${getStatusClasses(txn.status)}`}>
                        {getStatusIcon(txn.status)}
                        {txn.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {txn.commission > 0 ? formatCurrency(txn.commission) : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {txn.mdr > 0 ? (
                        <span>
                          {formatCurrency(txn.mdr)}
                          {txn.mdr_rate > 0 && (
                            <span className="text-xs text-gray-400 ml-1">({(txn.mdr_rate * 100).toFixed(2)}%)</span>
                          )}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {txn.settlement_type !== '-' ? txn.settlement_type : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 max-w-[120px] truncate" title={txn.scheme_name}>
                      {txn.scheme_name !== '-' ? txn.scheme_name : '-'}
                    </td>
                    <td className="px-4 py-3 max-w-[130px]">
                      {txn.retailer_id ? (
                        <>
                          <span className="text-xs text-gray-900 dark:text-white block truncate">{txn.retailer_name || '-'}</span>
                          <span className="text-[10px] font-mono text-gray-400 block truncate" title={txn.retailer_id}>{txn.retailer_id}</span>
                        </>
                      ) : <span className="text-sm text-gray-400">-</span>}
                    </td>
                    {userRole !== 'retailer' && (
                      <td className="px-4 py-3 max-w-[130px]">
                        {txn.distributor_id ? (
                          <>
                            <span className="text-xs text-gray-900 dark:text-white block truncate">{txn.distributor_name || '-'}</span>
                            <span className="text-[10px] font-mono text-gray-400 block truncate" title={txn.distributor_id}>{txn.distributor_id}</span>
                          </>
                        ) : <span className="text-sm text-gray-400">-</span>}
                      </td>
                    )}
                    {(userRole === 'admin' || userRole === 'master_distributor') && (
                      <td className="px-4 py-3 max-w-[130px]">
                        {txn.master_distributor_id ? (
                          <>
                            <span className="text-xs text-gray-900 dark:text-white block truncate">{txn.md_name || '-'}</span>
                            <span className="text-[10px] font-mono text-gray-400 block truncate" title={txn.master_distributor_id}>{txn.master_distributor_id}</span>
                          </>
                        ) : <span className="text-sm text-gray-400">-</span>}
                      </td>
                    )}
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => { setSelectedTxn(txn); setShowViewModal(true) }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 rounded-lg transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 dark:border-gray-700">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Page {pagination.page} of {pagination.totalPages} &middot; {pagination.total} total records
            </span>
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
          </div>
        )}
      </motion.div>

      {/* View Modal */}
      <AnimatePresence>
        {showViewModal && selectedTxn && (
          <ViewTransactionModal
            txn={selectedTxn}
            userRole={userRole}
            onClose={() => { setShowViewModal(false); setSelectedTxn(null) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ============================================================================
// SUMMARY CARD
// ============================================================================

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

// ============================================================================
// VIEW TRANSACTION MODAL
// ============================================================================

function ViewTransactionModal({ txn, userRole, onClose }: { txn: Transaction; userRole: string; onClose: () => void }) {
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount)

  const DetailRow = ({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) => {
    if (!value || value === '-' || value === 'null') return null
    return (
      <div className="flex justify-between py-2.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
        <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
        <span className={`text-sm font-medium text-gray-900 dark:text-white ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto"
      >
        {/* Modal Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Transaction Details</h3>
            <p className="text-xs text-gray-500 mt-0.5">{txn.service_type} Transaction</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Amount & Status */}
          <div className="text-center py-4">
            <p className="text-3xl font-bold text-gray-900 dark:text-white">{formatCurrency(txn.amount)}</p>
            <div className="mt-2 flex items-center justify-center gap-2">
              <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${
                ['success', 'captured'].includes(txn.status.toLowerCase())
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                  : ['failed'].includes(txn.status.toLowerCase())
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
              }`}>
                {txn.status}
              </span>
              <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${
                txn.service_type === 'POS' ? 'bg-blue-100 text-blue-700' :
                txn.service_type === 'BBPS' ? 'bg-green-100 text-green-700' :
                txn.service_type === 'AEPS' ? 'bg-amber-100 text-amber-700' :
                'bg-purple-100 text-purple-700'
              }`}>
                {txn.service_type}
              </span>
            </div>
          </div>

          {/* Transaction Info */}
          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4">
            <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Transaction Info</h4>
            <DetailRow label="Transaction ID" value={txn.transaction_id} mono />
            <DetailRow label="TID" value={txn.tid} mono />
            <DetailRow label="Date" value={new Date(txn.created_at).toLocaleString('en-IN')} />
            <DetailRow label="Payment Mode" value={txn.payment_mode} />
            <DetailRow label="Card Type" value={txn.card_type} />
            <DetailRow label="Device Serial" value={txn.device_serial} />
            <DetailRow label="Description" value={txn.description} />
          </div>

          {/* Financial Details */}
          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4">
            <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Financial Details</h4>
            <DetailRow label="Amount" value={formatCurrency(txn.amount)} />
            <DetailRow label="Commission" value={txn.commission > 0 ? formatCurrency(txn.commission) : null} />
            <DetailRow label="MDR" value={txn.mdr > 0 ? formatCurrency(txn.mdr) : null} />
            <DetailRow label="MDR Rate" value={txn.mdr_rate > 0 ? `${(txn.mdr_rate * 100).toFixed(3)}%` : null} />
            <DetailRow label="Settlement Type" value={txn.settlement_type !== '-' ? txn.settlement_type : null} />
            <DetailRow label="Scheme Name" value={txn.scheme_name !== '-' ? txn.scheme_name : null} />
          </div>

          {/* Hierarchy */}
          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4">
            <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Hierarchy</h4>
            <DetailRow label="Retailer Name" value={txn.retailer_name} />
            <DetailRow label="Retailer ID" value={txn.retailer_id} mono />
            <DetailRow label="Distributor Name" value={txn.distributor_name} />
            <DetailRow label="Distributor ID" value={txn.distributor_id} mono />
            <DetailRow label="MD Name" value={txn.md_name} />
            <DetailRow label="MD ID" value={txn.master_distributor_id} mono />
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
