'use client'

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react'
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
  IndianRupee,
  Download,
  Upload,
  FileText,
  FileSpreadsheet,
  Archive,
  Search,
  SlidersHorizontal,
  RotateCcw,
  TrendingUp,
  AlertTriangle,
  Banknote
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
  // Customer & User Info
  customer_name: string | null
  payer_name: string | null
  username: string | null
  // Terminal & Device Info
  tid: string | null
  mid: string | null
  device_serial: string | null
  merchant_name: string | null
  // Company (POS webhook source)
  merchant_slug?: string | null
  // Transaction Details
  txn_type: string | null
  auth_code: string | null
  currency: string | null
  // Card Details
  card_brand: string | null
  card_type: string | null
  card_number: string | null
  issuing_bank: string | null
  card_classification: string | null
  // Reference Numbers
  rrn: string | null
  external_ref: string | null
  // Dates
  posting_date: string | null
  settled_on: string | null
  // Receipt
  customer_receipt_url: string | null
  // Raw payload
  raw_data: any | null
}

export default function RazorpayTransactionsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary-600" /></div>}>
      <RazorpayTransactionsPageContent />
    </Suspense>
  )
}

function RazorpayTransactionsPageContent() {
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
  const [expandedTxn, setExpandedTxn] = useState<string | null>(null)
  const [showRawJson, setShowRawJson] = useState<string | null>(null)
  
  // Filters
  const [statusFilter, setStatusFilter] = useState<'all' | 'CAPTURED' | 'FAILED' | 'PENDING'>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [paymentModeFilter, setPaymentModeFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [settlementFilter, setSettlementFilter] = useState('all')
  const [companyFilter, setCompanyFilter] = useState<string>('all')
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)

  // Export
  const [exporting, setExporting] = useState<string | null>(null)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  // Report upload (enrich) state
  const [showEnrichModal, setShowEnrichModal] = useState(false)
  const [enrichUploading, setEnrichUploading] = useState(false)
  const [enrichResult, setEnrichResult] = useState<any>(null)
  const enrichFileRef = useRef<HTMLInputElement>(null)

  // Test transaction modal state
  const [showTestModal, setShowTestModal] = useState(false)
  const [testAmount, setTestAmount] = useState('100')
  const [testPaymentMode, setTestPaymentMode] = useState('UPI')
  const [testCustomerName, setTestCustomerName] = useState('Test Customer')
  const [testStatus, setTestStatus] = useState('AUTHORIZED')
  const [testSending, setTestSending] = useState(false)
  const [testResult, setTestResult] = useState<any>(null)
  const limit = 20

  // Search debounce
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // Debounce search input
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery)
      setPage(1)
    }, 500)
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [searchQuery])

  // Close export menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', String(limit))
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      if (paymentModeFilter !== 'all') params.set('payment_mode', paymentModeFilter)
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (settlementFilter !== 'all') params.set('settlement_status', settlementFilter)
      if (companyFilter !== 'all') params.set('merchant_slug', companyFilter)

      const response = await apiFetch(`/api/admin/razorpay-transactions?${params.toString()}`)
      
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
  }, [user, page, limit, statusFilter, dateFrom, dateTo, paymentModeFilter, debouncedSearch, settlementFilter, companyFilter])

  // Initial fetch and auto-refresh polling
  useEffect(() => {
    if (!user || user.role !== 'admin') return

    fetchTransactions()

    let pollInterval: ReturnType<typeof setInterval> | null = null
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
      if (result.success) {
        setTimeout(() => fetchTransactions(), 1000)
      }
    } catch (err: any) {
      setTestResult({ success: false, error: err.message })
    } finally {
      setTestSending(false)
    }
  }

  // Export transactions
  const exportTransactions = async (format: 'csv' | 'pdf' | 'zip') => {
    setExporting(format)
    setShowExportMenu(false)
    try {
      const params = new URLSearchParams()
      params.set('format', format)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      if (paymentModeFilter !== 'all') params.set('payment_mode', paymentModeFilter)
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (settlementFilter !== 'all') params.set('settlement_status', settlementFilter)
      if (companyFilter !== 'all') params.set('merchant_slug', companyFilter)

      const response = await apiFetch(`/api/admin/razorpay-transactions/export?${params.toString()}`)
      
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData.error || 'Export failed')
      }

      if (format === 'zip') {
        // ZIP returns JSON with file contents, download as separate files
        const result = await response.json()
        if (result.success && result.files) {
          // Download CSV
          downloadFile(result.files.csv.content, result.files.csv.filename, result.files.csv.type)
          // Download JSON
          setTimeout(() => {
            downloadFile(result.files.json.content, result.files.json.filename, result.files.json.type)
          }, 500)
        }
      } else {
        // CSV or PDF - direct file download
        const blob = await response.blob()
        const contentDisposition = response.headers.get('Content-Disposition')
        const filenameMatch = contentDisposition?.match(/filename="?(.+?)"?$/)
        const filename = filenameMatch?.[1] || `razorpay_transactions.${format === 'pdf' ? 'html' : format}`
        
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
    } catch (err: any) {
      console.error('Export error:', err)
      alert(`Export failed: ${err.message}`)
    } finally {
      setExporting(null)
    }
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

  const handleEnrichUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setEnrichUploading(true)
    setEnrichResult(null)

    try {
      const text = await file.text()
      const response = await apiFetch('/api/admin/razorpay-transactions/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_text: text }),
      })
      const result = await response.json()
      setEnrichResult(result)
      if (result.success && result.summary?.updated > 0) {
        setTimeout(() => fetchTransactions(), 1000)
      }
    } catch (err: any) {
      setEnrichResult({ success: false, error: err.message })
    } finally {
      setEnrichUploading(false)
      if (enrichFileRef.current) enrichFileRef.current.value = ''
    }
  }

  // Reset all filters
  const resetFilters = () => {
    setStatusFilter('all')
    setDateFrom('')
    setDateTo('')
    setPaymentModeFilter('all')
    setSearchQuery('')
    setSettlementFilter('all')
    setCompanyFilter('all')
    setPage(1)
  }

  const hasActiveFilters = statusFilter !== 'all' || dateFrom || dateTo || paymentModeFilter !== 'all' || searchQuery || settlementFilter !== 'all' || companyFilter !== 'all'

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
    setShowRawJson(null)
  }

  // Compute summary stats from loaded transactions
  const capturedCount = transactions.filter(t => t.status === 'CAPTURED').length
  const failedCount = transactions.filter(t => t.status === 'FAILED').length
  const pendingCount = transactions.filter(t => t.status === 'PENDING').length
  const totalAmountOnPage = transactions.reduce((sum, t) => sum + (t.amount || 0), 0)
  const capturedAmount = transactions.filter(t => t.status === 'CAPTURED').reduce((sum, t) => sum + (t.amount || 0), 0)

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
              {/* Export Button */}
              <div className="relative" ref={exportMenuRef}>
                <button
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  disabled={!!exporting}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  {exporting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  {exporting ? `Exporting ${exporting.toUpperCase()}...` : 'Export'}
                  <ChevronDown className="w-3 h-3" />
                </button>
                
                <AnimatePresence>
                  {showExportMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: -5, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -5, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden"
                    >
                      <div className="p-2">
                        <p className="text-xs text-gray-500 dark:text-gray-400 px-3 py-1.5 font-medium uppercase tracking-wider">Download Report</p>
                        <button
                          onClick={() => exportTransactions('csv')}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        >
                          <FileSpreadsheet className="w-4 h-4 text-green-600" />
                          <div className="text-left">
                            <div className="font-medium">CSV Format</div>
                            <div className="text-xs text-gray-500">Spreadsheet compatible</div>
                          </div>
                        </button>
                        <button
                          onClick={() => exportTransactions('pdf')}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        >
                          <FileText className="w-4 h-4 text-red-600" />
                          <div className="text-left">
                            <div className="font-medium">PDF Format</div>
                            <div className="text-xs text-gray-500">Print-ready report</div>
                          </div>
                        </button>
                        <button
                          onClick={() => exportTransactions('zip')}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                        >
                          <Archive className="w-4 h-4 text-blue-600" />
                          <div className="text-left">
                            <div className="font-medium">ZIP Bundle</div>
                            <div className="text-xs text-gray-500">CSV + JSON combined</div>
                          </div>
                        </button>
                      </div>
                      {hasActiveFilters && (
                        <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-2">
                          <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                            <Filter className="w-3 h-3" />
                            Export will apply current filters
                          </p>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Upload Razorpay Report (Enrich) */}
              <button
                onClick={() => { setShowEnrichModal(true); setEnrichResult(null) }}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors whitespace-nowrap"
              >
                <Upload className="w-4 h-4" />
                Upload Report
              </button>

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
                <span className="text-sm whitespace-nowrap">{autoRefresh ? 'Auto ON' : 'Auto OFF'}</span>
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

          {/* Summary Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-1">
                <Receipt className="w-4 h-4 text-blue-500" />
                <span className="text-xs text-gray-500 dark:text-gray-400">Total</span>
              </div>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{total}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="w-4 h-4 text-green-500" />
                <span className="text-xs text-gray-500 dark:text-gray-400">Captured</span>
              </div>
              <p className="text-xl font-bold text-green-600">{capturedCount}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-1">
                <XCircle className="w-4 h-4 text-red-500" />
                <span className="text-xs text-gray-500 dark:text-gray-400">Failed</span>
              </div>
              <p className="text-xl font-bold text-red-600">{failedCount}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4 text-yellow-500" />
                <span className="text-xs text-gray-500 dark:text-gray-400">Pending</span>
              </div>
              <p className="text-xl font-bold text-yellow-600">{pendingCount}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-1">
                <Banknote className="w-4 h-4 text-emerald-500" />
                <span className="text-xs text-gray-500 dark:text-gray-400">Captured Amt</span>
              </div>
              <p className="text-lg font-bold text-emerald-600 truncate" title={formatAmount(capturedAmount)}>{formatAmount(capturedAmount)}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-1">
                <IndianRupee className="w-4 h-4 text-purple-500" />
                <span className="text-xs text-gray-500 dark:text-gray-400">Page Total</span>
              </div>
              <p className="text-lg font-bold text-purple-600 truncate" title={formatAmount(totalAmountOnPage)}>{formatAmount(totalAmountOnPage)}</p>
            </div>
          </div>

          {/* Filters Section */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
            {/* Search & Primary Filters */}
            <div className="p-4">
              <div className="flex flex-col lg:flex-row gap-4">
                {/* Search Box */}
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by TID, MID, RRN, Transaction ID, Customer Name..."
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder-gray-400"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Date Range */}
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
                    className="px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    title="From date"
                  />
                  <span className="text-gray-400 text-sm">to</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
                    className="px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    title="To date"
                  />
                </div>

                {/* Quick Date Buttons */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => { 
                      const today = new Date().toISOString().split('T')[0]
                      setDateFrom(today); setDateTo(today); setPage(1)
                    }}
                    className="px-3 py-2 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors whitespace-nowrap"
                  >
                    Today
                  </button>
                  <button
                    onClick={() => { 
                      const today = new Date()
                      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
                      setDateFrom(weekAgo.toISOString().split('T')[0])
                      setDateTo(today.toISOString().split('T')[0])
                      setPage(1)
                    }}
                    className="px-3 py-2 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors whitespace-nowrap"
                  >
                    7 Days
                  </button>
                  <button
                    onClick={() => { 
                      const today = new Date()
                      const monthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate())
                      setDateFrom(monthAgo.toISOString().split('T')[0])
                      setDateTo(today.toISOString().split('T')[0])
                      setPage(1)
                    }}
                    className="px-3 py-2 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors whitespace-nowrap"
                  >
                    30 Days
                  </button>
                </div>

                {/* Company (POS) Filter */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Building className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <select
                    value={companyFilter}
                    onChange={(e) => { setCompanyFilter(e.target.value); setPage(1) }}
                    className="px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent min-w-[200px]"
                    title="Filter by company"
                  >
                    <option value="all">All Companies</option>
                    <option value="ashvam">ASHVAM LEARNING PRIVATE LIMITED</option>
                    <option value="teachway">Teachway Education Private Limited</option>
                    <option value="newscenaric">New Scenaric Travels</option>
                    <option value="lagoon">LAGOON CRAFT LABS SOLUTIONS PRIVATE LIMITED</option>
                  </select>
                </div>
              </div>

              {/* Status Filter Pills + Advanced Toggle */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mr-1">Status:</span>
                  {(['all', 'CAPTURED', 'FAILED', 'PENDING'] as const).map((status) => (
                    <button
                      key={status}
                      onClick={() => { setStatusFilter(status); setPage(1) }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                        statusFilter === status
                          ? status === 'CAPTURED' ? 'bg-green-600 text-white' :
                            status === 'FAILED' ? 'bg-red-600 text-white' :
                            status === 'PENDING' ? 'bg-yellow-500 text-white' :
                            'bg-primary-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      {status === 'all' ? 'All' : status}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  {hasActiveFilters && (
                    <button
                      onClick={resetFilters}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Reset Filters
                    </button>
                  )}
                  <button
                    onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      showAdvancedFilters
                        ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    <SlidersHorizontal className="w-3 h-3" />
                    Advanced Filters
                    {showAdvancedFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Advanced Filters (collapsible) */}
            <AnimatePresence>
              {showAdvancedFilters && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 pt-2 border-t border-gray-100 dark:border-gray-700">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {/* Payment Mode */}
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Payment Mode</label>
                        <select
                          value={paymentModeFilter}
                          onChange={(e) => { setPaymentModeFilter(e.target.value); setPage(1) }}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        >
                          <option value="all">All Payment Modes</option>
                          <option value="CARD">Card</option>
                          <option value="UPI">UPI</option>
                          <option value="CASH">Cash</option>
                          <option value="WALLET">Wallet</option>
                          <option value="NETBANKING">Netbanking</option>
                          <option value="BHARATQR">BharatQR</option>
                        </select>
                      </div>

                      {/* Settlement Status */}
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Settlement Status</label>
                        <select
                          value={settlementFilter}
                          onChange={(e) => { setSettlementFilter(e.target.value); setPage(1) }}
                          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        >
                          <option value="all">All Settlement Status</option>
                          <option value="SETTLED">Settled</option>
                          <option value="PENDING">Pending</option>
                          <option value="FAILED">Failed</option>
                        </select>
                      </div>

                      {/* Page Size Info */}
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">Pagination</label>
                        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-900/50 rounded-lg text-sm text-gray-600 dark:text-gray-400">
                          <span>Page {page} of {totalPages}</span>
                          <span className="text-gray-300 dark:text-gray-600">|</span>
                          <span>{limit} per page</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Transactions Table */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-8">
                      {/* Expand icon column */}
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Transaction ID
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Consumer
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Company
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Amount (₹)
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Mode
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Card Number
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Brand
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Issuing Bank
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Card Class
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      RRN
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Settlement
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      MID
                    </th>
                    <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      TID
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {transactions.length === 0 ? (
                    <tr>
                      <td colSpan={16} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                        <div className="flex flex-col items-center gap-2">
                          {loading ? (
                            <>
                              <Loader2 className="w-6 h-6 animate-spin" />
                              <span>Loading transactions...</span>
                            </>
                          ) : hasActiveFilters ? (
                            <>
                              <AlertTriangle className="w-6 h-6 text-yellow-500" />
                              <span>No transactions match your filters</span>
                              <button onClick={resetFilters} className="text-primary-600 hover:underline text-sm mt-1">Clear all filters</button>
                            </>
                          ) : (
                            <span>No transactions found</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    transactions.map((txn) => (
                      <React.Fragment key={txn.txn_id}>
                        {/* Main Row */}
                        <motion.tr
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer ${
                            expandedTxn === txn.txn_id ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''
                          }`}
                          onClick={() => toggleExpand(txn.txn_id)}
                        >
                          <td className="px-3 py-3 whitespace-nowrap">
                            {expandedTxn === txn.txn_id ? (
                              <ChevronUp className="w-4 h-4 text-gray-400" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-gray-400" />
                            )}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-xs font-mono text-gray-900 dark:text-gray-100">
                            <div className="flex items-center gap-1">
                              <span className="truncate max-w-[160px]" title={txn.txn_id}>
                                {txn.txn_id.length > 20 ? txn.txn_id.substring(0, 10) + '...' + txn.txn_id.substring(txn.txn_id.length - 6) : txn.txn_id}
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
                          <td className="px-3 py-3 whitespace-nowrap text-xs text-gray-900 dark:text-gray-100">
                            {formatDate(txn.created_time)}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-xs text-gray-600 dark:text-gray-400 max-w-[140px] truncate" title={txn.customer_name || txn.payer_name || '-'}>
                            {txn.customer_name || txn.payer_name || '-'}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-xs text-gray-600 dark:text-gray-400 max-w-[140px] truncate" title={
                            txn.merchant_slug === 'ashvam' ? 'ASHVAM LEARNING PRIVATE LIMITED' :
                            txn.merchant_slug === 'teachway' ? 'Teachway Education Private Limited' :
                            txn.merchant_slug === 'newscenaric' ? 'New Scenaric Travels' :
                            txn.merchant_slug === 'lagoon' ? 'LAGOON CRAFT LABS SOLUTIONS PRIVATE LIMITED' : (txn.merchant_slug || 'ASHVAM')
                          }>
                            {txn.merchant_slug === 'ashvam' ? 'ASHVAM' :
                             txn.merchant_slug === 'teachway' ? 'Teachway' :
                             txn.merchant_slug === 'newscenaric' ? 'New Scenaric' :
                             txn.merchant_slug === 'lagoon' ? 'Lagoon' : (txn.merchant_slug ? String(txn.merchant_slug) : 'ASHVAM')}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-xs font-semibold text-gray-900 dark:text-gray-100">
                            {formatAmount(txn.amount)}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              txn.payment_mode === 'UPI' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' :
                              txn.payment_mode === 'CARD' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                              txn.payment_mode === 'CASH' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                              'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                            }`}>
                              {txn.payment_mode || 'N/A'}
                            </span>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-xs font-mono text-gray-600 dark:text-gray-400" title={txn.card_number || '-'}>
                            {txn.card_number || '-'}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-xs text-gray-600 dark:text-gray-400">
                            {txn.card_brand || '-'}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-xs text-gray-600 dark:text-gray-400 max-w-[120px] truncate" title={txn.issuing_bank || '-'}>
                            {txn.issuing_bank || '-'}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-xs text-gray-600 dark:text-gray-400">
                            {txn.card_classification ? (
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                                txn.card_classification.toLowerCase().includes('credit') ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' :
                                txn.card_classification.toLowerCase().includes('debit') ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400' :
                                'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                              }`}>
                                {txn.card_classification}
                              </span>
                            ) : '-'}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-xs font-mono text-gray-600 dark:text-gray-400">
                            <div className="flex items-center gap-1">
                              <span>{txn.rrn || '-'}</span>
                              {txn.rrn && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); copyToClipboard(txn.rrn!) }}
                                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                                  title="Copy RRN"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            {getStatusBadge(txn.status)}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-xs">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              txn.settlement_status === 'SETTLED' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                              txn.settlement_status === 'FAILED' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                              'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                            }`}>
                              {txn.settlement_status || 'PENDING'}
                            </span>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-xs font-mono text-gray-600 dark:text-gray-400">
                            {txn.mid || '-'}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-xs font-mono text-gray-600 dark:text-gray-400">
                            {txn.tid || '-'}
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
                              <td colSpan={15} className="px-0 py-0">
                                <div className="bg-gray-50 dark:bg-gray-900/50 border-t border-b border-gray-200 dark:border-gray-700">
                                  <div className="p-6">
                                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                                      <Receipt className="w-4 h-4" />
                                      Transaction Details
                                    </h3>
                                    
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-3">
                                      {/* Transaction Info */}
                                      <DetailItem icon={<Hash className="w-4 h-4" />} label="Transaction ID" value={txn.txn_id} mono copyable onCopy={copyToClipboard} />
                                      <DetailItem icon={<IndianRupee className="w-4 h-4" />} label="Amount" value={formatAmount(txn.amount)} />
                                      <DetailItem icon={<CreditCard className="w-4 h-4" />} label="Payment Mode" value={txn.payment_mode} />
                                      <DetailItem icon={<Hash className="w-4 h-4" />} label="Transaction Type" value={txn.txn_type} />
                                      <DetailItem label="Currency" value={txn.currency} />
                                      <DetailItem label="Auth Code" value={txn.auth_code} mono />
                                      
                                      {/* Customer Info */}
                                      <DetailItem icon={<User className="w-4 h-4" />} label="Consumer Name" value={txn.customer_name} />
                                      <DetailItem icon={<User className="w-4 h-4" />} label="Payer Name" value={txn.payer_name} />
                                      <DetailItem label="Username" value={txn.username} mono />
                                      
                                      {/* Terminal / Device Info */}
                                      <DetailItem icon={<Terminal className="w-4 h-4" />} label="TID (Terminal ID)" value={txn.tid} mono />
                                      <DetailItem icon={<Building className="w-4 h-4" />} label="MID (Merchant ID)" value={txn.mid} mono />
                                      <DetailItem icon={<Smartphone className="w-4 h-4" />} label="Device Serial" value={txn.device_serial || '(empty)'} mono />
                                      
                                      {/* Card Details */}
                                      <DetailItem icon={<CreditCard className="w-4 h-4" />} label="Card Number" value={txn.card_number} mono />
                                      <DetailItem label="Card Brand" value={txn.card_brand} />
                                      <DetailItem label="Card Type" value={txn.card_type} />
                                      <DetailItem label="Issuing Bank" value={txn.issuing_bank} />
                                      <DetailItem label="Card Classification" value={txn.card_classification} />
                                      
                                      {/* Reference Numbers */}
                                      <DetailItem label="RRN" value={txn.rrn} mono copyable onCopy={copyToClipboard} />
                                      <DetailItem label="External Ref" value={txn.external_ref} mono />
                                      
                                      {/* Status Info */}
                                      <DetailItem label="Status" value={txn.status} />
                                      <DetailItem label="Settlement Status" value={txn.settlement_status} />
                                      <DetailItem icon={<Building className="w-4 h-4" />} label="Company" value={
                                        txn.merchant_slug === 'ashvam' ? 'ASHVAM LEARNING PRIVATE LIMITED' :
                                        txn.merchant_slug === 'teachway' ? 'Teachway Education Private Limited' :
                                        txn.merchant_slug === 'newscenaric' ? 'New Scenaric Travels' :
                                        txn.merchant_slug === 'lagoon' ? 'LAGOON CRAFT LABS SOLUTIONS PRIVATE LIMITED' : (txn.merchant_slug || 'ASHVAM LEARNING PRIVATE LIMITED')
                                      } />
                                      
                                      {/* Dates */}
                                      <DetailItem icon={<Calendar className="w-4 h-4" />} label="Transaction Time" value={formatDate(txn.created_time)} />
                                      <DetailItem label="Posting Date" value={formatDate(txn.posting_date)} />
                                      <DetailItem label="Settled On" value={formatDate(txn.settled_on)} />
                                      
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
                                              View Receipt ↗
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
                      </React.Fragment>
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
                    onClick={() => setPage(1)}
                    disabled={page === 1 || loading}
                    className="flex items-center gap-1 px-2 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="First page"
                  >
                    <ChevronLeft className="w-4 h-4" /><ChevronLeft className="w-4 h-4 -ml-2" />
                  </button>
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1 || loading}
                    className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Previous
                  </button>
                  <span className="px-3 py-2 text-sm font-medium text-gray-900 dark:text-white bg-primary-50 dark:bg-primary-900/30 rounded-lg border border-primary-200 dark:border-primary-800">
                    {page}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages || loading}
                    className="flex items-center gap-1 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setPage(totalPages)}
                    disabled={page === totalPages || loading}
                    className="flex items-center gap-1 px-2 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Last page"
                  >
                    <ChevronRight className="w-4 h-4" /><ChevronRight className="w-4 h-4 -ml-2" />
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

      {/* Enrich / Upload Report Modal */}
      <AnimatePresence>
        {showEnrichModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={() => setShowEnrichModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <Upload className="w-5 h-5 text-indigo-500" />
                  Upload Razorpay Report
                </h2>
                <button
                  onClick={() => setShowEnrichModal(false)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Upload the Razorpay POS transaction report (tab-separated .txt/.csv) to enrich existing transactions with fields not available via webhook:
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg text-indigo-700 dark:text-indigo-400">
                    <CheckCircle2 className="w-3 h-3" /> Card Classification
                  </div>
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg text-indigo-700 dark:text-indigo-400">
                    <CheckCircle2 className="w-3 h-3" /> Card Txn Type
                  </div>
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg text-indigo-700 dark:text-indigo-400">
                    <CheckCircle2 className="w-3 h-3" /> Issuing Bank
                  </div>
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg text-indigo-700 dark:text-indigo-400">
                    <CheckCircle2 className="w-3 h-3" /> Acquiring Bank
                  </div>
                </div>

                <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-6 text-center hover:border-indigo-400 dark:hover:border-indigo-500 transition-colors">
                  <input
                    ref={enrichFileRef}
                    type="file"
                    accept=".txt,.csv,.tsv"
                    onChange={handleEnrichUpload}
                    className="hidden"
                    id="enrich-file-input"
                  />
                  <label htmlFor="enrich-file-input" className="cursor-pointer">
                    {enrichUploading ? (
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                        <span className="text-sm text-gray-600 dark:text-gray-400">Processing report...</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <Upload className="w-8 h-8 text-gray-400" />
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Click to select Razorpay report file</span>
                        <span className="text-xs text-gray-500">.txt or .csv (tab-separated)</span>
                      </div>
                    )}
                  </label>
                </div>

                {enrichResult && (
                  <div className={`p-4 rounded-lg text-sm ${
                    enrichResult.success
                      ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-800 dark:text-green-400'
                      : 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-400'
                  }`}>
                    {enrichResult.success ? (
                      <div>
                        <div className="flex items-center gap-1 font-medium mb-2">
                          <CheckCircle2 className="w-4 h-4" />
                          Report processed successfully
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          <p>Total in report: <span className="font-semibold">{enrichResult.summary?.total_in_report}</span></p>
                          <p>Updated: <span className="font-semibold text-green-600">{enrichResult.summary?.updated}</span></p>
                          <p>Skipped: <span className="font-semibold">{enrichResult.summary?.skipped}</span></p>
                          <p>Not found: <span className="font-semibold text-amber-600">{enrichResult.summary?.not_found}</span></p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <XCircle className="w-4 h-4" />
                        {enrichResult.error || 'Upload failed'}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                <button
                  onClick={() => setShowEnrichModal(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Close
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
