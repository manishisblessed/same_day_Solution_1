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
  Filter,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Send,
  X,
  Copy,
  FileJson,
  User,
  Terminal,
  Hash,
  Building,
  Smartphone,
  Receipt,
  Calendar,
  IndianRupee
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api-client'

interface RazorpayTransaction {
  txn_id: string
  amount: number
  payment_mode: string | null
  status: 'CAPTURED' | 'FAILED' | 'PENDING'
  settlement_status: string | null
  created_time: string
  // Extended details from raw_data
  customer_name: string | null
  payer_name: string | null
  tid: string | null
  mid: string | null
  rrn: string | null
  device_serial: string | null
  external_ref: string | null
  card_brand: string | null
  card_type: string | null
  txn_type: string | null
  currency: string | null
  auth_code: string | null
  customer_receipt_url: string | null
  posting_date: string | null
  username: string | null
  merchant_name: string | null
  raw_data: any | null
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
  const [expandedTxn, setExpandedTxn] = useState<string | null>(null)
  const [showRawJson, setShowRawJson] = useState<string | null>(null)
  // Test transaction modal state
  const [showTestModal, setShowTestModal] = useState(false)
  const [testAmount, setTestAmount] = useState('100')
  const [testPaymentMode, setTestPaymentMode] = useState('UPI')
  const [testCustomerName, setTestCustomerName] = useState('Test Customer')
  const [testStatus, setTestStatus] = useState('AUTHORIZED')
  const [testSending, setTestSending] = useState(false)
  const [testResult, setTestResult] = useState<any>(null)
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
      const response = await apiFetch(`/api/admin/razorpay-transactions?page=${page}&limit=${limit}${statusParam}`)
      
      // Check if response is JSON before parsing
      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
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

    fetchTransactions()

    let pollInterval: NodeJS.Timeout | null = null
    if (autoRefresh) {
      pollInterval = setInterval(() => {
        fetchTransactions(true)
      }, 10000)
    }

    return () => {
      if (pollInterval) {
        clearInterval(pollInterval)
      }
    }
  }, [fetchTransactions, autoRefresh, user])

  // Send test transaction
  const sendTestTransaction = async () => {
    setTestSending(true)
    setTestResult(null)
    try {
      const response = await apiFetch('/api/admin/razorpay-transactions/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: parseFloat(testAmount) || 100,
          paymentMode: testPaymentMode,
          customerName: testCustomerName,
          status: testStatus
        })
      })
      const result = await response.json()
      setTestResult(result)
      // Auto-refresh to show new transaction
      if (result.success) {
        setTimeout(() => fetchTransactions(), 1000)
      }
    } catch (err: any) {
      setTestResult({ success: false, error: err.message })
    } finally {
      setTestSending(false)
    }
  }

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

  // Copy to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  // Get status badge
  const getStatusBadge = (status: 'CAPTURED' | 'FAILED' | 'PENDING') => {
    switch (status) {
      case 'CAPTURED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            CAPTURED
          </span>
        )
      case 'FAILED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
            <XCircle className="w-3 h-3 mr-1" />
            FAILED
          </span>
        )
      case 'PENDING':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
            <Clock className="w-3 h-3 mr-1" />
            PENDING
          </span>
        )
    }
  }

  // Toggle expanded row
  const toggleExpand = (txnId: string) => {
    setExpandedTxn(expandedTxn === txnId ? null : txnId)
    setShowRawJson(null) // Reset raw JSON view when collapsing
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
        <div className="pt-20 p-6 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                <CreditCard className="w-8 h-8 text-primary-600" />
                Razorpay Transactions
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mt-1">
                View all Razorpay POS transaction notifications
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
              {/* Test Transaction Button */}
              <button
                onClick={() => { setShowTestModal(true); setTestResult(null) }}
                className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors whitespace-nowrap"
              >
                <Send className="w-4 h-4" />
                Test Transaction
              </button>
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
                <span className="text-sm whitespace-nowrap">{autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}</span>
              </button>
              <button
                onClick={() => fetchTransactions()}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
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
                      setPage(1)
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
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-8">
                      {/* Expand icon column */}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Transaction ID
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Amount (₹)
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Payment Mode
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Customer
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      RRN
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Settlement
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Date
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                        {loading ? 'Loading transactions...' : 'No transactions found'}
                      </td>
                    </tr>
                  ) : (
                    transactions.map((txn) => (
                      <>
                        {/* Main Row */}
                        <motion.tr
                          key={txn.txn_id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer ${
                            expandedTxn === txn.txn_id ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''
                          }`}
                          onClick={() => toggleExpand(txn.txn_id)}
                        >
                          <td className="px-4 py-4 whitespace-nowrap">
                            {expandedTxn === txn.txn_id ? (
                              <ChevronUp className="w-4 h-4 text-gray-400" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-gray-400" />
                            )}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm font-mono text-gray-900 dark:text-gray-100">
                            <div className="flex items-center gap-1">
                              <span className="truncate max-w-[200px]" title={txn.txn_id}>
                                {txn.txn_id.length > 24 ? txn.txn_id.substring(0, 12) + '...' + txn.txn_id.substring(txn.txn_id.length - 8) : txn.txn_id}
                              </span>
                              <button
                                onClick={(e) => { e.stopPropagation(); copyToClipboard(txn.txn_id) }}
                                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                title="Copy Transaction ID"
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                            </div>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm font-semibold text-gray-900 dark:text-gray-100">
                            {formatAmount(txn.amount)}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              txn.payment_mode === 'UPI' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' :
                              txn.payment_mode === 'CARD' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                              txn.payment_mode === 'CASH' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                              'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                            }`}>
                              {txn.payment_mode || 'N/A'}
                            </span>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                            {txn.customer_name || txn.payer_name || '-'}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm font-mono text-gray-600 dark:text-gray-400">
                            {txn.rrn || '-'}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            {getStatusBadge(txn.status)}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              txn.settlement_status === 'SETTLED' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                              'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                            }`}>
                              {txn.settlement_status || 'N/A'}
                            </span>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                            {formatDate(txn.created_time)}
                          </td>
                        </motion.tr>

                        {/* Expanded Detail Row */}
                        <AnimatePresence>
                          {expandedTxn === txn.txn_id && (
                            <motion.tr
                              key={`${txn.txn_id}-detail`}
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.2 }}
                            >
                              <td colSpan={9} className="px-0 py-0">
                                <div className="bg-gray-50 dark:bg-gray-900/50 border-t border-b border-gray-200 dark:border-gray-700">
                                  <div className="p-6">
                                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                                      <Receipt className="w-4 h-4" />
                                      Transaction Details
                                    </h3>
                                    
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-3">
                                      {/* Transaction Info */}
                                      <DetailItem icon={<Hash className="w-4 h-4" />} label="Transaction ID" value={txn.txn_id} mono copyable onCopy={copyToClipboard} />
                                      <DetailItem icon={<IndianRupee className="w-4 h-4" />} label="Amount" value={formatAmount(txn.amount)} />
                                      <DetailItem icon={<CreditCard className="w-4 h-4" />} label="Payment Mode" value={txn.payment_mode} />
                                      <DetailItem icon={<Hash className="w-4 h-4" />} label="Transaction Type" value={txn.txn_type} />
                                      <DetailItem label="Currency" value={txn.currency} />
                                      <DetailItem label="Auth Code" value={txn.auth_code} />
                                      
                                      {/* Customer Info */}
                                      <DetailItem icon={<User className="w-4 h-4" />} label="Customer Name" value={txn.customer_name} />
                                      <DetailItem icon={<User className="w-4 h-4" />} label="Payer Name" value={txn.payer_name} />
                                      <DetailItem label="Username" value={txn.username} />
                                      
                                      {/* Terminal / Device Info */}
                                      <DetailItem icon={<Terminal className="w-4 h-4" />} label="TID (Terminal ID)" value={txn.tid} mono />
                                      <DetailItem icon={<Building className="w-4 h-4" />} label="MID (Merchant ID)" value={txn.mid} mono />
                                      <DetailItem icon={<Smartphone className="w-4 h-4" />} label="Device Serial" value={txn.device_serial || '(empty)'} mono />
                                      <DetailItem label="Merchant Name" value={txn.merchant_name} />
                                      
                                      {/* Reference Numbers */}
                                      <DetailItem label="RRN" value={txn.rrn} mono copyable onCopy={copyToClipboard} />
                                      <DetailItem label="External Ref" value={txn.external_ref} mono />
                                      
                                      {/* Status Info */}
                                      <DetailItem label="Status" value={txn.status} />
                                      <DetailItem label="Settlement Status" value={txn.settlement_status} />
                                      
                                      {/* Card Info (if applicable) */}
                                      {(txn.card_brand || txn.card_type) && (
                                        <>
                                          <DetailItem label="Card Brand" value={txn.card_brand} />
                                          <DetailItem label="Card Type" value={txn.card_type} />
                                        </>
                                      )}
                                      
                                      {/* Dates */}
                                      <DetailItem icon={<Calendar className="w-4 h-4" />} label="Transaction Time" value={formatDate(txn.created_time)} />
                                      <DetailItem label="Posting Date" value={formatDate(txn.posting_date)} />
                                      
                                      {/* Receipt */}
                                      {txn.customer_receipt_url && (
                                        <div className="flex items-start gap-2">
                                          <ExternalLink className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
                                          <div>
                                            <span className="text-xs text-gray-500 dark:text-gray-400">Customer Receipt</span>
                                            <a 
                                              href={txn.customer_receipt_url} 
                                              target="_blank" 
                                              rel="noopener noreferrer"
                                              className="block text-sm text-blue-600 dark:text-blue-400 hover:underline truncate max-w-[250px]"
                                              onClick={(e) => e.stopPropagation()}
                                            >
                                              {txn.customer_receipt_url}
                                            </a>
                                          </div>
                                        </div>
                                      )}
                                    </div>

                                    {/* Raw JSON Toggle */}
                                    {txn.raw_data && (
                                      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setShowRawJson(showRawJson === txn.txn_id ? null : txn.txn_id) }}
                                          className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
                                        >
                                          <FileJson className="w-4 h-4" />
                                          {showRawJson === txn.txn_id ? 'Hide' : 'Show'} Raw JSON Payload
                                          {showRawJson === txn.txn_id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                        </button>
                                        
                                        <AnimatePresence>
                                          {showRawJson === txn.txn_id && (
                                            <motion.div
                                              initial={{ opacity: 0, height: 0 }}
                                              animate={{ opacity: 1, height: 'auto' }}
                                              exit={{ opacity: 0, height: 0 }}
                                              className="mt-2"
                                            >
                                              <div className="relative">
                                                <button
                                                  onClick={(e) => { e.stopPropagation(); copyToClipboard(JSON.stringify(txn.raw_data, null, 2)) }}
                                                  className="absolute top-2 right-2 p-1 bg-gray-600 hover:bg-gray-500 text-white rounded text-xs flex items-center gap-1"
                                                  title="Copy JSON"
                                                >
                                                  <Copy className="w-3 h-3" /> Copy
                                                </button>
                                                <pre className="bg-gray-900 text-green-400 p-4 rounded-lg text-xs overflow-x-auto max-h-96 overflow-y-auto">
                                                  {JSON.stringify(txn.raw_data, null, 2)}
                                                </pre>
                                              </div>
                                            </motion.div>
                                          )}
                                        </AnimatePresence>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </motion.tr>
                          )}
                        </AnimatePresence>
                      </>
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

      {/* Test Transaction Modal */}
      <AnimatePresence>
        {showTestModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={() => setShowTestModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <Send className="w-5 h-5 text-orange-500" />
                  Send Test Transaction
                </h2>
                <button
                  onClick={() => setShowTestModal(false)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-5 space-y-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Send a simulated POS transaction to test the webhook pipeline end-to-end.
                </p>

                {/* Amount */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Amount (₹)
                  </label>
                  <input
                    type="number"
                    value={testAmount}
                    onChange={(e) => setTestAmount(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="100"
                    min="1"
                  />
                </div>

                {/* Payment Mode */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Payment Mode
                  </label>
                  <select
                    value={testPaymentMode}
                    onChange={(e) => setTestPaymentMode(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value="UPI">UPI</option>
                    <option value="CARD">Card</option>
                    <option value="CASH">Cash</option>
                    <option value="WALLET">Wallet</option>
                    <option value="NETBANKING">Netbanking</option>
                    <option value="BHARATQR">BharatQR</option>
                  </select>
                </div>

                {/* Customer Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Customer Name
                  </label>
                  <input
                    type="text"
                    value={testCustomerName}
                    onChange={(e) => setTestCustomerName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="Test Customer"
                  />
                </div>

                {/* Status */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Transaction Status
                  </label>
                  <select
                    value={testStatus}
                    onChange={(e) => setTestStatus(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value="AUTHORIZED">AUTHORIZED (→ CAPTURED)</option>
                    <option value="FAILED">FAILED</option>
                    <option value="VOIDED">VOIDED (→ FAILED)</option>
                    <option value="PENDING">PENDING</option>
                  </select>
                </div>

                {/* Test Result */}
                {testResult && (
                  <div className={`p-3 rounded-lg text-sm ${
                    testResult.success 
                      ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-400' 
                      : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-400'
                  }`}>
                    {testResult.success ? (
                      <div>
                        <div className="flex items-center gap-1 font-medium mb-1">
                          <CheckCircle2 className="w-4 h-4" />
                          Test transaction sent successfully!
                        </div>
                        <div className="text-xs space-y-0.5 mt-2">
                          <p><span className="font-medium">Txn ID:</span> <span className="font-mono">{testResult.testTxnId}</span></p>
                          <p><span className="font-medium">Webhook Status:</span> {testResult.webhookResponse?.status}</p>
                          <p><span className="font-medium">Processed:</span> {testResult.webhookResponse?.processed ? 'Yes' : 'No'}</p>
                          <p><span className="font-medium">DB Status:</span> {testResult.webhookResponse?.status === 200 || testResult.webhookResponse?.processed ? 'Stored' : 'Check logs'}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <XCircle className="w-4 h-4" />
                        {testResult.error || 'Failed to send test transaction'}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                <button
                  onClick={() => setShowTestModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={sendTestTransaction}
                  disabled={testSending || !testAmount}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-orange-500 rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {testSending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Send Test
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// Detail Item component for the expanded view
function DetailItem({ 
  icon, 
  label, 
  value, 
  mono = false, 
  copyable = false, 
  onCopy 
}: { 
  icon?: React.ReactNode
  label: string
  value: string | null | undefined
  mono?: boolean
  copyable?: boolean
  onCopy?: (text: string) => void
}) {
  const displayValue = value || '-'
  const isEmpty = !value || value === '-' || value === ''
  
  return (
    <div className="flex items-start gap-2">
      {icon && <span className="text-gray-400 mt-0.5 flex-shrink-0">{icon}</span>}
      <div className="min-w-0">
        <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
        <div className="flex items-center gap-1">
          <span className={`text-sm ${isEmpty ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-gray-100'} ${mono ? 'font-mono' : ''} break-all`}>
            {displayValue}
          </span>
          {copyable && !isEmpty && onCopy && (
            <button
              onClick={(e) => { e.stopPropagation(); onCopy(displayValue) }}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0"
              title={`Copy ${label}`}
            >
              <Copy className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
