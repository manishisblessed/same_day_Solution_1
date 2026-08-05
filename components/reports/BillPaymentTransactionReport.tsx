'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'framer-motion'
import { apiFetch } from '@/lib/api-client'
import NetworkUserFilter, { NetworkFilterValue } from '@/components/reports/NetworkUserFilter'
import {
  FileBarChart, Download, Calendar, Filter, Search,
  RefreshCw, IndianRupee, CheckCircle2, XCircle, Clock,
  ChevronLeft, ChevronRight, Receipt, Loader2
} from 'lucide-react'
import ExportDropdown, { type ExportFormat, downloadBlob, getExportExtension } from '@/components/ExportDropdown'

interface Transaction {
  date: string
  transaction_id: string
  operator: string
  biller_name?: string
  customer_name?: string
  mobile?: string
  card_number?: string
  customer_number: string
  bill_amount: number
  charge: number
  gst: number
  total_debit: number
  reference_number: string
  status: string
  user_id?: string
  user_name?: string
  user_type?: 'retailer' | 'partner'
  retailer_id?: string
  retailer_name?: string
  source?: string
}

type ProviderFilter = '' | 'bbps' | 'credit_card' | 'pay2new' | 'rechargekit'

const PROVIDER_OPTIONS: { value: ProviderFilter; label: string }[] = [
  { value: '', label: 'All Providers' },
  { value: 'bbps', label: 'BBPS' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'pay2new', label: 'Pay2New' },
  { value: 'rechargekit', label: 'Rechargekit' },
]

interface StatusBucket {
  count: number
  bill_amount: number
  charges: number
  gst: number
  total_debit: number
}

interface Summary {
  total_transactions: number
  total_bill_amount: number
  total_charges: number
  total_gst: number
  total_debit: number
  success_count: number
  failed_count: number
  pending_count: number
  by_status: {
    success: StatusBucket
    failed: StatusBucket
    pending: StatusBucket
  }
}

interface Pagination {
  total: number
  limit: number
  offset: number
  page: number
  totalPages: number
}

type DatePreset = 'today' | 'yesterday' | 'week' | 'month' | 'quarter' | 'custom'

interface BillPaymentTransactionReportProps {
  userRole: 'admin' | 'finance_executive' | 'master_distributor' | 'distributor' | 'retailer' | 'partner'
  userName?: string
}

const blankBucket = (): StatusBucket => ({ count: 0, bill_amount: 0, charges: 0, gst: 0, total_debit: 0 })
const emptySummary: Summary = {
  total_transactions: 0, total_bill_amount: 0, total_charges: 0,
  total_gst: 0, total_debit: 0, success_count: 0, failed_count: 0, pending_count: 0,
  by_status: { success: blankBucket(), failed: blankBucket(), pending: blankBucket() },
}

export default function BillPaymentTransactionReport({ userRole, userName }: BillPaymentTransactionReportProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [summary, setSummary] = useState<Summary>(emptySummary)
  const [pagination, setPagination] = useState<Pagination>({ total: 0, limit: 25, offset: 0, page: 1, totalPages: 0 })
  const [rowsPerPage, setRowsPerPage] = useState<10 | 25 | 100>(25)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [datePreset, setDatePreset] = useState<DatePreset>('month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>('')
  const [searchTerm, setSearchTerm] = useState('')
  const [exporting, setExporting] = useState<ExportFormat | null>(null)

  const [networkFilter, setNetworkFilter] = useState<NetworkFilterValue | null>(null)

  const tableRef = useRef<HTMLDivElement>(null)

  const handleStatusCardClick = (status: string) => {
    setStatusFilter(prev => (prev === status ? '' : status))
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
  }

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
        date_from: start, date_to: end,
        limit: String(rowsPerPage), offset: String(offset),
      })
      if (statusFilter) params.set('status', statusFilter)
      if (providerFilter) params.set('provider', providerFilter)
      if (searchTerm) params.set('search', searchTerm)
      applyNetworkUserParams(params)

      const res = await apiFetch(`/api/reports/bill-payment-report?${params.toString()}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to fetch report')

      setTransactions(json.data || [])
      setSummary(json.summary ? { ...emptySummary, ...json.summary, by_status: { ...emptySummary.by_status, ...(json.summary.by_status || {}) } } : emptySummary)
      setPagination(json.pagination || { total: 0, limit: rowsPerPage, offset: 0, page: 1, totalPages: 0 })
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [getDateRange, statusFilter, providerFilter, searchTerm, rowsPerPage, applyNetworkUserParams])

  useEffect(() => { fetchReport(1) }, [fetchReport, datePreset, dateFrom, dateTo, statusFilter, providerFilter, rowsPerPage, networkFilter])

  const handleSearch = () => fetchReport(1)
  const handlePageChange = (page: number) => fetchReport(page)

  const handleExport = async (format: ExportFormat) => {
    setExporting(format)
    try {
      const { start, end } = getDateRange()
      const params = new URLSearchParams({
        date_from: start, date_to: end,
        limit: '10000', offset: '0', format,
      })
      if (statusFilter) params.set('status', statusFilter)
      if (providerFilter) params.set('provider', providerFilter)
      if (searchTerm) params.set('search', searchTerm)
      applyNetworkUserParams(params)

      const res = await apiFetch(`/api/reports/bill-payment-report?${params.toString()}`)
      if (!res.ok) { const json = await res.json(); throw new Error(json.error || 'Export failed') }

      const contentType = res.headers.get('content-type') || ''
      const ext = getExportExtension(format, contentType)
      const blob = await res.blob()
      downloadBlob(blob, `bill_payment_report_${Date.now()}.${ext}`)
    } catch (err: any) {
      alert(err.message || 'Export failed')
    } finally {
      setExporting(null)
    }
  }

  const formatCurrency = (amount: number) => `₹${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const formatCompact = (amount: number) => {
    if (Math.abs(amount) >= 1e7) return `₹${(amount / 1e7).toFixed(2)} Cr`
    if (Math.abs(amount) >= 1e5) return `₹${(amount / 1e5).toFixed(2)} L`
    return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
  }

  const getStatusClasses = (status: string) => {
    const s = status.toLowerCase()
    if (s === 'success') return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    if (s === 'failed') return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
    if (s === 'pending' || s === 'initiated') return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
    if (s === 'reversed') return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
    if (s === 'refunded') return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
    return 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400'
  }

  const getStatusIcon = (status: string) => {
    const s = status.toLowerCase()
    if (s === 'success') return <CheckCircle2 className="w-3 h-3" />
    if (s === 'failed') return <XCircle className="w-3 h-3" />
    return <Clock className="w-3 h-3" />
  }

  const getProviderClasses = (provider: string) => {
    if (provider.includes('Rechargekit')) return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
    if (provider.includes('Pay2New') && provider.includes('Credit')) return 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300'
    if (provider.includes('Pay2New')) return 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
    return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
  }

  const roleLabel = userRole === 'admin' ? 'Admin' : userRole === 'finance_executive' ? 'Finance'
    : userRole === 'master_distributor' ? 'Master Distributor' : userRole === 'distributor' ? 'Distributor'
    : userRole === 'partner' ? 'Partner' : 'Retailer'

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl shadow-lg">
              <Receipt className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Bill Payment Report</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{roleLabel} view &middot; {userName || ''}</p>
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

      {/* Filters */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="bg-white dark:bg-gray-800 rounded-xl p-5 shadow-lg border border-gray-100 dark:border-gray-700"
      >
        <div className="flex flex-wrap gap-4 items-end">
          <div className="min-w-[160px]">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Date Range</label>
            <select value={datePreset} onChange={e => setDatePreset(e.target.value as DatePreset)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
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
                  className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">To</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500" />
              </div>
            </>
          )}

          {userRole !== 'retailer' && userRole !== 'partner' && (
            <div className="min-w-[230px]">
              <NetworkUserFilter userRole={userRole} onChange={setNetworkFilter} />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Provider</label>
            <div className="flex flex-wrap gap-1.5">
              {PROVIDER_OPTIONS.map(opt => (
                <button
                  key={opt.value || 'all'}
                  type="button"
                  onClick={() => setProviderFilter(opt.value)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    providerFilter === opt.value
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-emerald-400'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Status</label>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">All Status</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
              <option value="pending">Pending</option>
              <option value="initiated">Initiated</option>
              <option value="reversed">Reversed</option>
              <option value="refunded">Refunded</option>
            </select>
          </div>

          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type="text" placeholder="Search by Transaction ID..."
                value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500" />
            </div>
          </div>

          <button onClick={handleSearch}
            className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors">
            <Filter className="w-4 h-4 inline mr-1" />
            Apply
          </button>
        </div>
      </motion.div>

      {/* Summary Cards — reflect the currently filtered view */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4"
      >
        <SummaryCard icon={<Receipt className="w-5 h-5" />} label="Total Transactions" value={String(summary.total_transactions)} gradient="from-slate-600 to-slate-700" />
        <SummaryCard icon={<IndianRupee className="w-5 h-5" />} label="Total Bill Amount" value={formatCurrency(summary.total_bill_amount)} gradient="from-blue-500 to-blue-600" />
        <SummaryCard icon={<IndianRupee className="w-5 h-5" />} label="Total Charges" value={formatCurrency(summary.total_charges)} gradient="from-amber-500 to-orange-600" />
        <SummaryCard icon={<IndianRupee className="w-5 h-5" />} label="Total GST" value={formatCurrency(summary.total_gst)} gradient="from-purple-500 to-purple-600" />
        <SummaryCard icon={<IndianRupee className="w-5 h-5" />} label="Total Debit" value={formatCurrency(summary.total_debit)} gradient="from-emerald-500 to-teal-600" />
      </motion.div>

      {/* Clickable status breakdown — filters the table on click */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.13 }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <StatusCard
          active={statusFilter === ''}
          onClick={() => handleStatusCardClick('')}
          icon={<Receipt className="w-5 h-5" />}
          label="All Transactions"
          count={summary.by_status.success.count + summary.by_status.failed.count + summary.by_status.pending.count}
          amount={formatCompact(summary.by_status.success.bill_amount + summary.by_status.failed.bill_amount + summary.by_status.pending.bill_amount)}
          accent="slate"
        />
        <StatusCard
          active={statusFilter === 'success'}
          onClick={() => handleStatusCardClick('success')}
          icon={<CheckCircle2 className="w-5 h-5" />}
          label="Success"
          count={summary.by_status.success.count}
          amount={formatCompact(summary.by_status.success.bill_amount)}
          accent="green"
        />
        <StatusCard
          active={statusFilter === 'failed'}
          onClick={() => handleStatusCardClick('failed')}
          icon={<XCircle className="w-5 h-5" />}
          label="Failed / Refunded"
          count={summary.by_status.failed.count}
          amount={formatCompact(summary.by_status.failed.bill_amount)}
          accent="red"
        />
        <StatusCard
          active={statusFilter === 'pending'}
          onClick={() => handleStatusCardClick('pending')}
          icon={<Clock className="w-5 h-5" />}
          label="Pending"
          count={summary.by_status.pending.count}
          amount={formatCompact(summary.by_status.pending.bill_amount)}
          accent="amber"
        />
      </motion.div>

      {/* Export + Count Bar */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
        className="bg-white dark:bg-gray-800 rounded-xl px-6 py-4 shadow-lg border border-gray-100 dark:border-gray-700 flex flex-wrap items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3 text-sm text-gray-600 dark:text-gray-400">
          <span>
            <span className="font-semibold text-green-600">{summary.success_count}</span> success &middot;{' '}
            <span className="font-semibold text-red-600">{summary.failed_count}</span> failed &middot;{' '}
            <span className="font-semibold text-yellow-600">{summary.pending_count}</span> pending
          </span>
          {statusFilter && (
            <button onClick={() => handleStatusCardClick('')}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 text-xs font-medium hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors">
              Filtered: {statusFilter}
              <XCircle className="w-3 h-3" />
            </button>
          )}
          {providerFilter && (
            <button onClick={() => setProviderFilter('')}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 text-xs font-medium hover:bg-teal-200 dark:hover:bg-teal-900/50 transition-colors">
              Provider: {PROVIDER_OPTIONS.find(o => o.value === providerFilter)?.label}
              <XCircle className="w-3 h-3" />
            </button>
          )}
        </div>
        <ExportDropdown onExport={handleExport} exporting={exporting} disabled={false} />
      </motion.div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-center gap-3">
          <XCircle className="w-5 h-5 text-red-500 shrink-0" />
          <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
        </div>
      )}

      {/* Table */}
      <motion.div ref={tableRef} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden scroll-mt-4"
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                {['Date', 'Transaction ID', 'Provider', 'User', 'Customer Name', 'Mobile', 'Card / Consumer No', 'Bill Amount', 'Charge', 'GST', 'Total Debit', 'Reference No', 'Status'].map(col => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase whitespace-nowrap">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                <tr>
                  <td colSpan={13} className="px-6 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
                      <span className="text-sm text-gray-500">Loading transactions...</span>
                    </div>
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-6 py-16 text-center text-gray-500 dark:text-gray-400">
                    <div className="flex flex-col items-center gap-2">
                      <Receipt className="w-10 h-10 text-gray-300 dark:text-gray-600" />
                      <span>No transactions found</span>
                    </div>
                  </td>
                </tr>
              ) : (
                transactions.map((txn, i) => (
                  <tr key={txn.transaction_id + i} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white whitespace-nowrap">
                      {new Date(txn.date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: '2-digit' })}
                      <br />
                      <span className="text-xs text-gray-500">{new Date(txn.date).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono text-gray-600 dark:text-gray-400 block truncate max-w-[150px]" title={txn.transaction_id}>{txn.transaction_id}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${getProviderClasses(txn.operator || txn.source || '')}`}>
                        {txn.operator || txn.source || '-'}
                      </span>
                      {txn.biller_name && txn.biller_name !== '-' && (
                        <div className="text-[10px] text-gray-500 mt-0.5 truncate max-w-[160px]" title={txn.biller_name}>{txn.biller_name}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold uppercase leading-none ${
                          txn.user_type === 'partner'
                            ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                            : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                        }`}>
                          {txn.user_type === 'partner' ? 'PT' : 'RT'}
                        </span>
                        <span className="text-xs text-gray-900 dark:text-white truncate max-w-[110px]" title={txn.user_name || txn.retailer_name || txn.user_id || '-'}>
                          {txn.user_name || txn.retailer_name || txn.user_id || '-'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">{txn.customer_name || '-'}</td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{txn.mobile || '-'}</td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{txn.card_number && txn.card_number !== '-' ? txn.card_number : (txn.customer_number || '-')}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white whitespace-nowrap">{formatCurrency(txn.bill_amount)}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">{formatCurrency(txn.charge)}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">{formatCurrency(txn.gst)}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white whitespace-nowrap">{formatCurrency(txn.total_debit)}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono text-gray-600 dark:text-gray-400 block truncate max-w-[130px]" title={txn.reference_number}>{txn.reference_number}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${getStatusClasses(txn.status)}`}>
                        {getStatusIcon(txn.status)}
                        {txn.status}
                      </span>
                    </td>
                  </tr>
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
              <select value={rowsPerPage} onChange={e => setRowsPerPage(Number(e.target.value) as 10 | 25 | 100)}
                className="px-2 py-1 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
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
                <button onClick={() => handlePageChange(pagination.page - 1)} disabled={pagination.page <= 1}
                  className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                  let page: number
                  if (pagination.totalPages <= 5) page = i + 1
                  else if (pagination.page <= 3) page = i + 1
                  else if (pagination.page >= pagination.totalPages - 2) page = pagination.totalPages - 4 + i
                  else page = pagination.page - 2 + i
                  return (
                    <button key={page} onClick={() => handlePageChange(page)}
                      className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${
                        page === pagination.page
                          ? 'bg-emerald-600 text-white'
                          : 'border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                      }`}>
                      {page}
                    </button>
                  )
                })}
                <button onClick={() => handlePageChange(pagination.page + 1)} disabled={pagination.page >= pagination.totalPages}
                  className="p-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors">
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
    <div className={`bg-gradient-to-br ${gradient} rounded-xl p-4 text-white shadow-lg`}>
      <div className="flex items-center justify-between mb-2">
        <div className="opacity-80">{icon}</div>
      </div>
      <p className="text-xl font-bold truncate">{value}</p>
      <p className="text-xs opacity-80 mt-0.5">{label}</p>
    </div>
  )
}

type StatusAccent = 'slate' | 'green' | 'red' | 'amber'

const STATUS_ACCENTS: Record<StatusAccent, {
  iconWrap: string; count: string; ring: string; activeBg: string; hoverBorder: string; bar: string
}> = {
  slate: {
    iconWrap: 'bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300',
    count: 'text-slate-900 dark:text-white',
    ring: 'ring-slate-400 dark:ring-slate-500',
    activeBg: 'bg-slate-50 dark:bg-slate-800/60',
    hoverBorder: 'hover:border-slate-300 dark:hover:border-slate-600',
    bar: 'bg-slate-500',
  },
  green: {
    iconWrap: 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400',
    count: 'text-green-700 dark:text-green-400',
    ring: 'ring-green-500',
    activeBg: 'bg-green-50 dark:bg-green-900/20',
    hoverBorder: 'hover:border-green-300 dark:hover:border-green-700',
    bar: 'bg-green-500',
  },
  red: {
    iconWrap: 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400',
    count: 'text-red-600 dark:text-red-400',
    ring: 'ring-red-500',
    activeBg: 'bg-red-50 dark:bg-red-900/20',
    hoverBorder: 'hover:border-red-300 dark:hover:border-red-700',
    bar: 'bg-red-500',
  },
  amber: {
    iconWrap: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
    count: 'text-amber-600 dark:text-amber-400',
    ring: 'ring-amber-500',
    activeBg: 'bg-amber-50 dark:bg-amber-900/20',
    hoverBorder: 'hover:border-amber-300 dark:hover:border-amber-700',
    bar: 'bg-amber-500',
  },
}

function StatusCard({ active, onClick, icon, label, count, amount, accent }: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  count: number
  amount: string
  accent: StatusAccent
}) {
  const c = STATUS_ACCENTS[accent]
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`group relative text-left overflow-hidden rounded-xl p-4 border transition-all duration-200 shadow-sm hover:shadow-md
        ${active
          ? `${c.activeBg} border-transparent ring-2 ${c.ring}`
          : `bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 ${c.hoverBorder}`}`}
    >
      <span className={`absolute left-0 top-0 h-full w-1 ${c.bar} ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'} transition-opacity`} />
      <div className="flex items-center justify-between mb-3">
        <span className={`inline-flex items-center justify-center w-9 h-9 rounded-lg ${c.iconWrap}`}>{icon}</span>
        <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
          {active ? 'Viewing' : 'View'}
        </span>
      </div>
      <p className={`text-2xl font-bold ${c.count} leading-none`}>{count.toLocaleString('en-IN')}</p>
      <div className="mt-1.5 flex items-center justify-between">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300" title="Total bill amount">{amount}</p>
      </div>
    </button>
  )
}
