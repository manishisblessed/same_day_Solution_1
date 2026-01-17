'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import AdminSidebar from '@/components/AdminSidebar'
import { 
  CreditCard, 
  ChevronLeft, 
  ChevronRight, 
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Filter
} from 'lucide-react'
import { motion } from 'framer-motion'

interface RazorpayTransaction {
  txn_id: string
  amount: number
  payment_mode: string | null
  status: 'CAPTURED' | 'FAILED' | 'PENDING'
  settlement_status: string | null
  created_time: string
}

export default function RazorpayTransactionsPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [transactions, setTransactions] = useState<RazorpayTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | 'CAPTURED' | 'FAILED' | 'PENDING'>('all')
  const limit = 20

  // Redirect if not admin
  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'admin')) {
      router.push('/admin/login')
    }
  }, [user, authLoading, router])

  // Fetch transactions
  const fetchTransactions = useCallback(async (silent = false) => {
    if (!user || user.role !== 'admin') return

    if (!silent) {
      setLoading(true)
    }
    setError(null)

    try {
      const statusParam = statusFilter !== 'all' ? `&status=${statusFilter}` : ''
      const response = await fetch(`/api/admin/razorpay-transactions?page=${page}&limit=${limit}${statusParam}`)
      
      // Check if response is JSON before parsing
      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        // Handle non-JSON responses (e.g., HTML error pages from timeouts)
        const text = await response.text()
        console.error('Non-JSON response received:', text.substring(0, 200))
        
        if (response.status === 504) {
          throw new Error('Request timeout. The server took too long to respond. Please try again.')
        } else if (response.status >= 500) {
          throw new Error('Server error. Please try again later or contact support.')
        } else {
          throw new Error('Unexpected response format. Please refresh the page.')
        }
      }

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to fetch transactions')
      }

      setTransactions(result.data || [])
      setTotalPages(result.pagination?.totalPages || 1)
      setTotal(result.pagination?.total || 0)
    } catch (err: any) {
      console.error('Error fetching transactions:', err)
      setError(err.message || 'Failed to load transactions')
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }, [user, page, limit, statusFilter])

  // Initial fetch and auto-refresh polling
  useEffect(() => {
    if (!user || user.role !== 'admin') return

    // Initial fetch
    fetchTransactions()

    // Set up auto-refresh polling (every 10 seconds)
    let pollInterval: NodeJS.Timeout | null = null
    if (autoRefresh) {
      pollInterval = setInterval(() => {
        fetchTransactions(true) // Silent refresh (no loading spinner)
      }, 10000) // 10 seconds
    }

    // Cleanup
    return () => {
      if (pollInterval) {
        clearInterval(pollInterval)
      }
    }
  }, [fetchTransactions, autoRefresh, user])

  // Format date
  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A'
    try {
      const date = new Date(dateString)
      return date.toLocaleString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    } catch {
      return 'Invalid Date'
    }
  }

  // Format amount
  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2
    }).format(amount)
  }

  // Get status badge
  const getStatusBadge = (status: 'CAPTURED' | 'FAILED' | 'PENDING') => {
    switch (status) {
      case 'CAPTURED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            🟢 CAPTURED
          </span>
        )
      case 'FAILED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
            <XCircle className="w-3 h-3 mr-1" />
            🔴 FAILED
          </span>
        )
      case 'PENDING':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
            <Clock className="w-3 h-3 mr-1" />
            🟡 PENDING
          </span>
        )
    }
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="lg:pl-56 flex items-center justify-center min-h-screen">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      
      <div className="lg:pl-56">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                <CreditCard className="w-8 h-8 text-primary-600" />
                Razorpay Transactions
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mt-1">
                View all Razorpay POS transaction notifications
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAutoRefresh(!autoRefresh)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                  autoRefresh
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
                title={autoRefresh ? 'Auto-refresh enabled (every 10s)' : 'Auto-refresh disabled'}
              >
                <div className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-white animate-pulse' : 'bg-gray-500'}`} />
                <span className="text-sm">{autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}</span>
              </button>
              <button
                onClick={() => fetchTransactions()}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-red-800 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">Total Transactions</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{total}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">Current Page</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {page} / {totalPages}
              </p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">Page Size</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{limit}</p>
            </div>
          </div>

          {/* Status Filter */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="flex items-center gap-2 min-w-fit">
                <Filter className="w-5 h-5 text-gray-500" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">Filter by Status:</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {(['all', 'CAPTURED', 'FAILED', 'PENDING'] as const).map((status) => (
                  <button
                    key={status}
                    onClick={() => {
                      setStatusFilter(status)
                      setPage(1) // Reset to first page when filter changes
                    }}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                      statusFilter === status
                        ? 'bg-primary-600 text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {status === 'all' ? 'All' : status}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Transactions Table */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Transaction ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Amount (₹)
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Payment Mode
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Settlement Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                        {loading ? 'Loading transactions...' : 'No transactions found'}
                      </td>
                    </tr>
                  ) : (
                    transactions.map((txn) => (
                      <motion.tr
                        key={txn.txn_id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                      >
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-900 dark:text-gray-100">
                          {txn.txn_id}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {formatAmount(txn.amount)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                          {txn.payment_mode || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          {getStatusBadge(txn.status)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                          {txn.settlement_status || 'N/A'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                          {formatDate(txn.created_time)}
                        </td>
                      </motion.tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="bg-gray-50 dark:bg-gray-900 px-6 py-4 flex items-center justify-between border-t border-gray-200 dark:border-gray-700">
                <div className="text-sm text-gray-700 dark:text-gray-300">
                  Showing page {page} of {totalPages} ({total} total transactions)
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1 || loading}
                    className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Previous
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages || loading}
                    className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
