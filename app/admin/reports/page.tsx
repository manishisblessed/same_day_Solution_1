'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '@/lib/supabase/client'
import {
  FileBarChart, Download, Calendar, Filter, Search,
  FileSpreadsheet, FileJson, FileText, Printer, RefreshCw,
  TrendingUp, Users, CreditCard, Receipt, IndianRupee,
  Clock, CheckCircle2, XCircle, AlertTriangle, Building2,
  ArrowUpRight, ArrowDownRight, BarChart3, PieChart
} from 'lucide-react'

type ReportType = 'transactions' | 'commissions' | 'partners' | 'services' | 'settlements' | 'wallets'
type ExportFormat = 'csv' | 'excel' | 'json' | 'pdf'
type DateRange = 'today' | 'yesterday' | 'week' | 'month' | 'quarter' | 'year' | 'custom'

interface ReportSummary {
  totalAmount: number
  totalCount: number
  successRate: number
  avgAmount: number
}

export default function ReportsPage() {
  const [selectedReport, setSelectedReport] = useState<ReportType>('transactions')
  const [dateRange, setDateRange] = useState<DateRange>('month')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [reportData, setReportData] = useState<any[]>([])
  const [summary, setSummary] = useState<ReportSummary>({
    totalAmount: 0,
    totalCount: 0,
    successRate: 0,
    avgAmount: 0
  })
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const reportTypes = [
    { id: 'transactions', label: 'Transactions', icon: Receipt, color: 'blue' },
    { id: 'commissions', label: 'Commissions', icon: IndianRupee, color: 'green' },
    { id: 'partners', label: 'Partners', icon: Building2, color: 'purple' },
    { id: 'services', label: 'Services', icon: CreditCard, color: 'orange' },
    { id: 'settlements', label: 'Settlements', icon: TrendingUp, color: 'pink' },
    { id: 'wallets', label: 'Wallets', icon: Receipt, color: 'cyan' }
  ]

  useEffect(() => {
    fetchReportData()
  }, [selectedReport, dateRange, startDate, endDate, statusFilter])

  const getDateRangeValues = () => {
    const now = new Date()
    let start: Date
    let end = new Date()

    switch (dateRange) {
      case 'today':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        break
      case 'yesterday':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59)
        break
      case 'week':
        start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1)
        break
      case 'quarter':
        start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
        break
      case 'year':
        start = new Date(now.getFullYear(), 0, 1)
        break
      case 'custom':
        start = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), 1)
        end = endDate ? new Date(endDate) : new Date()
        break
      default:
        start = new Date(now.getFullYear(), now.getMonth(), 1)
    }

    return { start, end }
  }

  const fetchReportData = async () => {
    setLoading(true)
    try {
      const { start, end } = getDateRangeValues()

      let query = supabase
        .from('transactions')
        .select('*')
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString())
        .order('created_at', { ascending: false })

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter)
      }

      const { data, error } = await query.limit(1000)

      if (error) throw error

      const transactions = data || []
      setReportData(transactions)

      // Calculate summary
      const successful = transactions.filter(t => t.status === 'success')
      const totalAmount = successful.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0)
      
      setSummary({
        totalAmount,
        totalCount: transactions.length,
        successRate: transactions.length > 0 ? (successful.length / transactions.length) * 100 : 0,
        avgAmount: successful.length > 0 ? totalAmount / successful.length : 0
      })
    } catch (error) {
      console.error('Error fetching report data:', error)
    } finally {
      setLoading(false)
    }
  }

  const exportReport = async (format: ExportFormat) => {
    const { start, end } = getDateRangeValues()
    
    try {
      // Fetch all data for export
      const { data } = await supabase
        .from('transactions')
        .select('*')
        .gte('created_at', start.toISOString())
        .lte('created_at', end.toISOString())
        .order('created_at', { ascending: false })

      if (!data) return

      const filename = `${selectedReport}_report_${new Date().toISOString().split('T')[0]}`

      switch (format) {
        case 'csv':
          exportCSV(data, filename)
          break
        case 'excel':
          exportExcel(data, filename)
          break
        case 'json':
          exportJSON(data, filename)
          break
        case 'pdf':
          alert('PDF export coming soon!')
          break
      }
    } catch (error) {
      console.error('Export error:', error)
      alert('Failed to export report')
    }
  }

  const exportCSV = (data: any[], filename: string) => {
    const headers = ['Date', 'Transaction ID', 'Type', 'Amount', 'Status', 'Partner ID', 'Description']
    const rows = data.map(t => [
      new Date(t.created_at).toLocaleString('en-IN'),
      t.transaction_id || t.id,
      t.transaction_type || 'N/A',
      t.amount || '0',
      t.status || 'pending',
      t.partner_id || 'N/A',
      t.description || ''
    ])
    const csvContent = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n')
    downloadFile(csvContent, `${filename}.csv`, 'text/csv')
  }

  const exportExcel = (data: any[], filename: string) => {
    // Using tab-separated values for basic Excel compatibility
    const headers = ['Date', 'Transaction ID', 'Type', 'Amount', 'Status', 'Partner ID', 'Description']
    const rows = data.map(t => [
      new Date(t.created_at).toLocaleString('en-IN'),
      t.transaction_id || t.id,
      t.transaction_type || 'N/A',
      t.amount || '0',
      t.status || 'pending',
      t.partner_id || 'N/A',
      t.description || ''
    ])
    const content = [headers.join('\t'), ...rows.map(r => r.join('\t'))].join('\n')
    downloadFile(content, `${filename}.xls`, 'application/vnd.ms-excel')
  }

  const exportJSON = (data: any[], filename: string) => {
    downloadFile(JSON.stringify(data, null, 2), `${filename}.json`, 'application/json')
  }

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(amount)
  }

  const filteredData = reportData.filter(item => {
    if (!searchTerm) return true
    const search = searchTerm.toLowerCase()
    return (
      item.transaction_id?.toLowerCase().includes(search) ||
      item.partner_id?.toLowerCase().includes(search) ||
      item.description?.toLowerCase().includes(search)
    )
  })

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-lg">
                <FileBarChart className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                  Reports & Analytics
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  Generate and download comprehensive reports
                </p>
              </div>
            </div>
            <button
              onClick={fetchReportData}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </motion.div>

        {/* Report Type Selection */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6"
        >
          {reportTypes.map((type) => (
            <button
              key={type.id}
              onClick={() => setSelectedReport(type.id as ReportType)}
              className={`p-4 rounded-xl border-2 transition-all ${
                selectedReport === type.id
                  ? `border-${type.color}-500 bg-${type.color}-50 dark:bg-${type.color}-900/20`
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300'
              }`}
            >
              <type.icon className={`w-6 h-6 mx-auto mb-2 ${
                selectedReport === type.id ? `text-${type.color}-600` : 'text-gray-400'
              }`} />
              <p className={`text-sm font-medium ${
                selectedReport === type.id ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'
              }`}>
                {type.label}
              </p>
            </button>
          ))}
        </motion.div>

        {/* Filters */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-100 dark:border-gray-700 mb-6"
        >
          <div className="flex flex-wrap gap-4 items-end">
            {/* Date Range */}
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Date Range
              </label>
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value as DateRange)}
                className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:ring-2 focus:ring-indigo-500"
              >
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="week">Last 7 Days</option>
                <option value="month">This Month</option>
                <option value="quarter">This Quarter</option>
                <option value="year">This Year</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>

            {/* Custom Date Range */}
            {dateRange === 'custom' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </>
            )}

            {/* Status Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:ring-2 focus:ring-indigo-500"
              >
                <option value="all">All Status</option>
                <option value="success">Success</option>
                <option value="pending">Pending</option>
                <option value="failed">Failed</option>
              </select>
            </div>

            {/* Search */}
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Search
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by ID, partner..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
          </div>
        </motion.div>

        {/* Summary Cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6"
        >
          <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-6 text-white shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <IndianRupee className="w-8 h-8 opacity-80" />
              <span className="text-xs bg-white/20 px-2 py-1 rounded-full">Total</span>
            </div>
            <p className="text-3xl font-bold">{formatCurrency(summary.totalAmount)}</p>
            <p className="text-sm text-blue-100 mt-1">Transaction Volume</p>
          </div>

          <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-xl p-6 text-white shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <Receipt className="w-8 h-8 opacity-80" />
              <span className="text-xs bg-white/20 px-2 py-1 rounded-full">Count</span>
            </div>
            <p className="text-3xl font-bold">{summary.totalCount.toLocaleString()}</p>
            <p className="text-sm text-emerald-100 mt-1">Total Transactions</p>
          </div>

          <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-6 text-white shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <CheckCircle2 className="w-8 h-8 opacity-80" />
              <span className="text-xs bg-white/20 px-2 py-1 rounded-full">Rate</span>
            </div>
            <p className="text-3xl font-bold">{summary.successRate.toFixed(1)}%</p>
            <p className="text-sm text-purple-100 mt-1">Success Rate</p>
          </div>

          <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl p-6 text-white shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <BarChart3 className="w-8 h-8 opacity-80" />
              <span className="text-xs bg-white/20 px-2 py-1 rounded-full">Avg</span>
            </div>
            <p className="text-3xl font-bold">{formatCurrency(summary.avgAmount)}</p>
            <p className="text-sm text-amber-100 mt-1">Average Transaction</p>
          </div>
        </motion.div>

        {/* Export Options */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-lg border border-gray-100 dark:border-gray-700 mb-6"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Export Report</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">Download in your preferred format</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => exportReport('csv')}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-all shadow-md hover:shadow-lg"
              >
                <FileSpreadsheet className="w-4 h-4" />
                CSV
              </button>
              <button
                onClick={() => exportReport('excel')}
                className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-all shadow-md hover:shadow-lg"
              >
                <FileSpreadsheet className="w-4 h-4" />
                Excel
              </button>
              <button
                onClick={() => exportReport('json')}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-all shadow-md hover:shadow-lg"
              >
                <FileJson className="w-4 h-4" />
                JSON
              </button>
              <button
                onClick={() => exportReport('pdf')}
                className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-all shadow-md hover:shadow-lg"
              >
                <FileText className="w-4 h-4" />
                PDF
              </button>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 px-5 py-2.5 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-medium transition-all shadow-md hover:shadow-lg"
              >
                <Printer className="w-4 h-4" />
                Print
              </button>
            </div>
          </div>
        </motion.div>

        {/* Data Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden"
        >
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              {selectedReport.charAt(0).toUpperCase() + selectedReport.slice(1)} Data
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Showing {filteredData.length} of {reportData.length} records
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Date</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Transaction ID</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Type</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Amount</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Status</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Partner ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center">
                      <div className="flex items-center justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                      </div>
                    </td>
                  </tr>
                ) : filteredData.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                      No data found for the selected criteria
                    </td>
                  </tr>
                ) : (
                  filteredData.slice(0, 50).map((item, idx) => (
                    <tr key={item.id || idx} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                        {new Date(item.created_at).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </td>
                      <td className="px-6 py-4 text-sm font-mono text-gray-600 dark:text-gray-400">
                        {item.transaction_id || item.id?.slice(0, 8) || 'N/A'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 dark:text-white">
                        {item.transaction_type || 'N/A'}
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold text-gray-900 dark:text-white">
                        {formatCurrency(parseFloat(item.amount) || 0)}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                          item.status === 'success'
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : item.status === 'pending'
                            ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        }`}>
                          {item.status === 'success' && <CheckCircle2 className="w-3 h-3" />}
                          {item.status === 'pending' && <Clock className="w-3 h-3" />}
                          {item.status === 'failed' && <XCircle className="w-3 h-3" />}
                          {item.status || 'pending'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                        {item.partner_id || 'N/A'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {filteredData.length > 50 && (
            <div className="p-4 border-t border-gray-200 dark:border-gray-700 text-center text-sm text-gray-500 dark:text-gray-400">
              Showing 50 of {filteredData.length} records. Export to see all data.
            </div>
          )}
        </motion.div>
      </div>
    </div>
  )
}

