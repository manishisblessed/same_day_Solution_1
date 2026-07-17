'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { apiFetch } from '@/lib/api-client'
import NetworkUserFilter, { NetworkFilterValue } from '@/components/reports/NetworkUserFilter'
import {
  FileBarChart, Download, Calendar, Filter, Search,
  RefreshCw, IndianRupee, CheckCircle2, XCircle, Clock,
  ChevronLeft, ChevronRight, Banknote, Loader2
} from 'lucide-react'

type DatePreset = 'today' | 'yesterday' | 'week' | 'month' | 'quarter' | 'custom'

interface PayoutTransaction {
  date: string
  transaction_id: string
  beneficiary_name: string
  beneficiary_account: string
  bank_name: string
  ifsc_code: string
  amount: number
  charge: number
  gst: number
  total_debit: number
  reference_number: string
  status: 'success' | 'failed' | 'pending' | 'processing' | 'refunded'
  retailer_id?: string
  retailer_name?: string
}

interface Summary {
  total_transactions: number
  total_amount: number
  total_charges: number
  total_gst: number
  total_debit: number
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

interface Props {
  userRole: 'admin' | 'finance_executive' | 'master_distributor' | 'distributor' | 'retailer' | 'partner'
  userName?: string
}

const formatCurrency = (v: number) => '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const statusConfig: Record<string, { bg: string; text: string; dot: string }> = {
  success: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-400', dot: 'bg-green-500' },
  failed: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-400', dot: 'bg-red-500' },
  pending: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-400', dot: 'bg-yellow-500' },
  processing: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-700 dark:text-yellow-400', dot: 'bg-yellow-500' },
  refunded: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-400', dot: 'bg-blue-500' },
}

export default function PayoutTransactionReport({ userRole, userName }: Props) {
  const [data, setData] = useState<PayoutTransaction[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [pagination, setPagination] = useState<Pagination>({ total: 0, limit: 25, offset: 0, page: 1, totalPages: 1 })
  const [loading, setLoading] = useState(false)
  const [datePreset, setDatePreset] = useState<DatePreset>('month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [searchTxn, setSearchTxn] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [rowsPerPage, setRowsPerPage] = useState(25)
  const [page, setPage] = useState(1)

  const [networkFilter, setNetworkFilter] = useState<NetworkFilterValue | null>(null)

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

  const applyNetworkUserParams = useCallback((params: URLSearchParams) => {
    if (!networkFilter) return
    if (networkFilter.user_id) params.set('user_id', networkFilter.user_id)
    if (networkFilter.distributor_id) params.set('distributor_id', networkFilter.distributor_id)
    if (networkFilter.md_id) params.set('md_id', networkFilter.md_id)
    if (networkFilter.partner_id) params.set('partner_id', networkFilter.partner_id)
  }, [networkFilter])

  const buildParams = useCallback(() => {
    const { start, end } = getDateRange()
    const params = new URLSearchParams({
      date_from: start,
      date_to: end,
      limit: rowsPerPage.toString(),
      offset: ((page - 1) * rowsPerPage).toString(),
    })
    if (searchTxn) params.set('search', searchTxn)
    if (statusFilter !== 'all') params.set('status', statusFilter)
    applyNetworkUserParams(params)
    return params
  }, [getDateRange, rowsPerPage, page, searchTxn, statusFilter, applyNetworkUserParams])

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = buildParams()
      const res = await apiFetch(`/api/reports/payout-report?${params.toString()}`)
      const json = await res.json()
      if (res.ok && json.success) {
        setData(json.data)
        setSummary(json.summary)
        setPagination(json.pagination)
      }
    } catch { /* silently handle */ } finally {
      setLoading(false)
    }
  }, [buildParams])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => { setPage(1) }, [datePreset, dateFrom, dateTo, searchTxn, statusFilter, networkFilter, rowsPerPage])

  const handleExport = async () => {
    const params = buildParams()
    params.set('format', 'excel')
    try {
      const res = await apiFetch(`/api/reports/payout-report?${params.toString()}`)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `settlement-report-${new Date().toISOString().split('T')[0]}.xlsx`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch { /* silently handle */ }
  }

  const statCards = summary ? [
    { label: 'Total Transactions', value: summary.total_transactions.toLocaleString('en-IN'), icon: FileBarChart, color: 'text-indigo-600 dark:text-indigo-400' },
    { label: 'Total Amount', value: formatCurrency(summary.total_amount), icon: IndianRupee, color: 'text-emerald-600 dark:text-emerald-400' },
    { label: 'Total Charges', value: formatCurrency(summary.total_charges), icon: Banknote, color: 'text-orange-600 dark:text-orange-400' },
    { label: 'Total GST', value: formatCurrency(summary.total_gst), icon: Banknote, color: 'text-purple-600 dark:text-purple-400' },
    { label: 'Total Debit', value: formatCurrency(summary.total_debit), icon: IndianRupee, color: 'text-red-600 dark:text-red-400' },
    { label: 'Success', value: summary.success_count.toString(), icon: CheckCircle2, color: 'text-green-600 dark:text-green-400' },
    { label: 'Failed', value: summary.failed_count.toString(), icon: XCircle, color: 'text-red-600 dark:text-red-400' },
    { label: 'Pending', value: summary.pending_count.toString(), icon: Clock, color: 'text-yellow-600 dark:text-yellow-400' },
  ] : []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-100 dark:bg-indigo-900/40 rounded-lg">
            <FileBarChart className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settlement Transaction Report</h1>
            {userName && <p className="text-sm text-gray-500 dark:text-gray-400">{userName}</p>}
          </div>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-colors"
        >
          <Download className="w-4 h-4" />
          Export Excel
        </button>
      </div>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {statCards.map((card, i) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3"
            >
              <card.icon className={`w-5 h-5 ${card.color} mb-1`} />
              <p className="text-xs text-gray-500 dark:text-gray-400">{card.label}</p>
              <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{card.value}</p>
            </motion.div>
          ))}
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
            {(['today', 'yesterday', 'week', 'month', 'custom'] as DatePreset[]).map(p => (
              <button
                key={p}
                onClick={() => setDatePreset(p)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${
                  datePreset === p
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          {datePreset === 'custom' && (
            <div className="flex items-center gap-2">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
              <span className="text-gray-500 dark:text-gray-400 text-sm">to</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white" />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search Transaction ID..."
              value={searchTxn}
              onChange={e => setSearchTxn(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400"
            />
          </div>

          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="pl-9 pr-8 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white appearance-none cursor-pointer"
            >
              <option value="all">All Status</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="refunded">Refunded</option>
            </select>
          </div>

          {userRole !== 'retailer' && userRole !== 'partner' && (
            <div className="min-w-[230px]">
              <NetworkUserFilter userRole={userRole} onChange={setNetworkFilter} />
            </div>
          )}

          <button onClick={fetchData} className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <RefreshCw className={`w-4 h-4 text-gray-600 dark:text-gray-300 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                {['Date', 'Transaction ID', 'Beneficiary Name', 'Account No.', 'Bank', 'IFSC', 'Amount', 'Charge', 'GST', 'Total Debit', 'Reference No.', 'Status'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={12} className="px-4 py-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-indigo-500" /></td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={12} className="px-4 py-12 text-center text-gray-500 dark:text-gray-400">No transactions found</td></tr>
              ) : (
                data.map((txn, i) => {
                  const sc = statusConfig[txn.status] || statusConfig.pending
                  return (
                    <motion.tr
                      key={txn.transaction_id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.02 }}
                      className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-gray-700 dark:text-gray-300">{new Date(txn.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                      <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-gray-900 dark:text-white">{txn.transaction_id}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-700 dark:text-gray-300">{txn.beneficiary_name}</td>
                      <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-gray-700 dark:text-gray-300">{txn.beneficiary_account}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-700 dark:text-gray-300">{txn.bank_name}</td>
                      <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-gray-700 dark:text-gray-300">{txn.ifsc_code}</td>
                      <td className="px-4 py-3 whitespace-nowrap font-medium text-gray-900 dark:text-white">{formatCurrency(txn.amount)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-600 dark:text-gray-400">{formatCurrency(txn.charge)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-600 dark:text-gray-400">{formatCurrency(txn.gst)}</td>
                      <td className="px-4 py-3 whitespace-nowrap font-semibold text-gray-900 dark:text-white">{formatCurrency(txn.total_debit)}</td>
                      <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-gray-700 dark:text-gray-300">{txn.reference_number}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${sc.bg} ${sc.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                          {txn.status}
                        </span>
                      </td>
                    </motion.tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <span>Rows:</span>
            <select
              value={rowsPerPage}
              onChange={e => setRowsPerPage(Number(e.target.value))}
              className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={100}>100</option>
            </select>
            <span className="ml-2">
              Showing {((page - 1) * rowsPerPage) + 1}–{Math.min(page * rowsPerPage, pagination.total)} of {pagination.total}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <ChevronLeft className="w-4 h-4 text-gray-600 dark:text-gray-300" />
            </button>
            <span className="px-3 py-1 text-sm font-medium text-gray-700 dark:text-gray-300">{page} / {pagination.totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
              disabled={page >= pagination.totalPages}
              className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-300" />
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
