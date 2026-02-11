'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase/client'
import { useAuth } from '@/contexts/AuthContext'
import { BBPSTransaction, BBPSTransactionStatus } from '@/types/database.types'
import { 
  Search, RefreshCw, Download, Calendar, 
  ChevronLeft, ChevronRight, Eye,
  CheckCircle, XCircle, Clock, AlertCircle, Filter
} from 'lucide-react'
import { motion } from 'framer-motion'
import { format } from 'date-fns'
import { apiFetchJson } from '@/lib/api-client'

interface BBPSTransactionsTableProps {
  autoPoll?: boolean
  pollInterval?: number
}

export default function BBPSTransactionsTable({
  autoPoll = true,
  pollInterval = 15000
}: BBPSTransactionsTableProps) {
  const { user } = useAuth()
  const [transactions, setTransactions] = useState<BBPSTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [limit] = useState(20)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [showFilterPanel, setShowFilterPanel] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedTx, setSelectedTx] = useState<BBPSTransaction | null>(null)

  const totalPages = Math.ceil(total / limit)

  const fetchTransactions = useCallback(async () => {
    if (!user?.partner_id) return

    try {
      setLoading(true)
      setError(null)

      const params = new URLSearchParams()
      params.append('service', 'bbps')
      params.append('limit', limit.toString())
      params.append('offset', ((page - 1) * limit).toString())
      if (statusFilter && statusFilter !== 'all') params.append('status', statusFilter)
      if (dateFrom) params.append('date_from', dateFrom)
      if (dateTo) params.append('date_to', dateTo)

      const result = await apiFetchJson<{
        success: boolean
        data: any[]
        total: number
        error?: string
      }>(`/api/reports/transactions?${params.toString()}`)

      if (result.success && result.data) {
        setTransactions(result.data as BBPSTransaction[])
        setTotal(result.total || result.data.length)
      } else if (result.error) {
        setError(result.error)
      }
    } catch (err: any) {
      console.error('Error fetching BBPS transactions:', err)
      setError(err.message || 'Failed to fetch transactions')
    } finally {
      setLoading(false)
    }
  }, [user?.partner_id, page, limit, statusFilter, dateFrom, dateTo])

  useEffect(() => {
    fetchTransactions()

    if (autoPoll) {
      const interval = setInterval(fetchTransactions, pollInterval)
      return () => clearInterval(interval)
    }
  }, [fetchTransactions, autoPoll, pollInterval])

  const getStatusBadge = (status: BBPSTransactionStatus) => {
    const styles: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
      success: { 
        bg: 'bg-green-100 dark:bg-green-900/30', 
        text: 'text-green-700 dark:text-green-400',
        icon: <CheckCircle className="w-3.5 h-3.5" />
      },
      failed: { 
        bg: 'bg-red-100 dark:bg-red-900/30', 
        text: 'text-red-700 dark:text-red-400',
        icon: <XCircle className="w-3.5 h-3.5" />
      },
      pending: { 
        bg: 'bg-yellow-100 dark:bg-yellow-900/30', 
        text: 'text-yellow-700 dark:text-yellow-400',
        icon: <Clock className="w-3.5 h-3.5" />
      },
      initiated: { 
        bg: 'bg-blue-100 dark:bg-blue-900/30', 
        text: 'text-blue-700 dark:text-blue-400',
        icon: <Clock className="w-3.5 h-3.5" />
      },
      reversed: { 
        bg: 'bg-purple-100 dark:bg-purple-900/30', 
        text: 'text-purple-700 dark:text-purple-400',
        icon: <AlertCircle className="w-3.5 h-3.5" />
      },
      refunded: { 
        bg: 'bg-orange-100 dark:bg-orange-900/30', 
        text: 'text-orange-700 dark:text-orange-400',
        icon: <AlertCircle className="w-3.5 h-3.5" />
      },
    }
    const style = styles[status] || styles.pending
    return (
      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${style.bg} ${style.text}`}>
        {style.icon}
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    )
  }

  // Filter by search query (biller name, consumer number, transaction ID)
  const filteredTransactions = transactions.filter(tx => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      (tx.biller_name || '').toLowerCase().includes(q) ||
      (tx.consumer_number || '').toLowerCase().includes(q) ||
      (tx.transaction_id || '').toLowerCase().includes(q) ||
      (tx.agent_transaction_id || '').toLowerCase().includes(q) ||
      (tx.consumer_name || '').toLowerCase().includes(q)
    )
  })

  const handleExport = () => {
    if (filteredTransactions.length === 0) return
    
    const headers = ['Date', 'Biller', 'Consumer No.', 'Consumer Name', 'Bill Amount', 'Status', 'Transaction ID', 'Wallet Debited']
    const rows = filteredTransactions.map(tx => [
      format(new Date(tx.created_at), 'dd MMM yyyy HH:mm'),
      tx.biller_name || tx.biller_id,
      tx.consumer_number,
      tx.consumer_name || '-',
      `₹${tx.bill_amount?.toFixed(2)}`,
      tx.status,
      tx.transaction_id || tx.agent_transaction_id || '-',
      tx.wallet_debited ? 'Yes' : 'No'
    ])
    
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bbps-transactions-${format(new Date(), 'yyyyMMdd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden"
    >
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">BBPS Transactions</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">{total} total transactions</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchTransactions}
              disabled={loading}
              className="p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setShowFilterPanel(!showFilterPanel)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                showFilterPanel 
                  ? 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800'
                  : 'text-gray-600 border-gray-300 hover:bg-gray-50 dark:text-gray-400 dark:border-gray-600 dark:hover:bg-gray-700'
              }`}
            >
              <Filter className="w-4 h-4" />
              Filters
            </button>
            <button
              onClick={handleExport}
              disabled={filteredTransactions.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by biller, consumer number, transaction ID..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Filter Panel */}
        {showFilterPanel && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 grid grid-cols-1 sm:grid-cols-3 gap-3"
          >
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Status</label>
              <select
                value={statusFilter}
                onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
                className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="all">All Status</option>
                <option value="success">Success</option>
                <option value="failed">Failed</option>
                <option value="pending">Pending</option>
                <option value="initiated">Initiated</option>
                <option value="reversed">Reversed</option>
                <option value="refunded">Refunded</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">From Date</label>
              <input
                type="date"
                value={dateFrom}
                onChange={e => { setDateFrom(e.target.value); setPage(1) }}
                className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">To Date</label>
              <input
                type="date"
                value={dateTo}
                onChange={e => { setDateTo(e.target.value); setPage(1) }}
                className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </motion.div>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Date & Time</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Biller</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Consumer</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Bill Amount</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Wallet</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Transaction ID</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {loading && transactions.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto text-blue-500 mb-2" />
                  <span className="text-sm text-gray-500 dark:text-gray-400">Loading transactions...</span>
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center">
                  <AlertCircle className="w-6 h-6 mx-auto text-red-500 mb-2" />
                  <span className="text-sm text-red-500">{error}</span>
                  <button onClick={fetchTransactions} className="block mx-auto mt-2 text-sm text-blue-600 hover:underline">
                    Retry
                  </button>
                </td>
              </tr>
            ) : filteredTransactions.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  No BBPS transactions found
                </td>
              </tr>
            ) : (
              filteredTransactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                    {format(new Date(tx.created_at), 'dd MMM yyyy, HH:mm')}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900 dark:text-white truncate max-w-[180px]" title={tx.biller_name || tx.biller_id}>
                      {tx.biller_name || tx.biller_id}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-sm text-gray-900 dark:text-white">{tx.consumer_number}</div>
                    {tx.consumer_name && (
                      <div className="text-xs text-gray-500 dark:text-gray-400">{tx.consumer_name}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-gray-900 dark:text-white">
                    ₹{tx.bill_amount?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {getStatusBadge(tx.status)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {tx.wallet_debited ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                        <CheckCircle className="w-3 h-3" /> Debited
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                        <XCircle className="w-3 h-3" /> Not Debited
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400 font-mono">
                    {tx.transaction_id 
                      ? <span title={tx.transaction_id}>{tx.transaction_id.substring(0, 16)}...</span>
                      : tx.agent_transaction_id 
                        ? <span title={tx.agent_transaction_id}>{tx.agent_transaction_id.substring(0, 16)}...</span>
                        : '-'
                    }
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <button
                      onClick={() => setSelectedTx(tx)}
                      className="p-1.5 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
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
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Page {page} of {totalPages} ({total} total)
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1.5 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Transaction Detail Modal */}
      {selectedTx && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedTx(null)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Transaction Details</h3>
              <button onClick={() => setSelectedTx(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="p-5 space-y-3">
              <DetailRow label="Status" value={getStatusBadge(selectedTx.status)} />
              <DetailRow label="Biller" value={selectedTx.biller_name || selectedTx.biller_id} />
              <DetailRow label="Consumer Number" value={selectedTx.consumer_number} />
              {selectedTx.consumer_name && <DetailRow label="Consumer Name" value={selectedTx.consumer_name} />}
              <DetailRow label="Bill Amount" value={`₹${selectedTx.bill_amount?.toFixed(2)}`} />
              <DetailRow label="Amount Paid" value={`₹${selectedTx.amount_paid?.toFixed(2)}`} />
              <DetailRow label="Wallet Debited" value={selectedTx.wallet_debited ? '✅ Yes' : '❌ No'} />
              <DetailRow label="Date" value={format(new Date(selectedTx.created_at), 'dd MMM yyyy, HH:mm:ss')} />
              {selectedTx.completed_at && <DetailRow label="Completed" value={format(new Date(selectedTx.completed_at), 'dd MMM yyyy, HH:mm:ss')} />}
              {selectedTx.transaction_id && <DetailRow label="BBPS Transaction ID" value={selectedTx.transaction_id} />}
              {selectedTx.agent_transaction_id && <DetailRow label="Agent Transaction ID" value={selectedTx.agent_transaction_id} />}
              {selectedTx.payment_status && <DetailRow label="Payment Status" value={selectedTx.payment_status} />}
              {selectedTx.bill_number && <DetailRow label="Bill Number" value={selectedTx.bill_number} />}
              {selectedTx.due_date && <DetailRow label="Due Date" value={selectedTx.due_date} />}
              {selectedTx.error_code && <DetailRow label="Error Code" value={selectedTx.error_code} />}
              {selectedTx.error_message && <DetailRow label="Error Message" value={<span className="text-red-600">{selectedTx.error_message}</span>} />}
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">{label}</span>
      <span className="text-sm font-medium text-gray-900 dark:text-white text-right break-all">{value}</span>
    </div>
  )
}

