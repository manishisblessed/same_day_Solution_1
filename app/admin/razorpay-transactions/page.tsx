'use client'

import React, { useState, useEffect, useCallback, useRef, Suspense, useMemo } from 'react'
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
  X,
  Copy,
  FileJson,
  User,
  Users,
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
  RotateCcw,
  TrendingUp,
  AlertTriangle,
  Banknote,
  Check,
  Calculator,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
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
  service_provider?: string | null
  // Partner/Retailer assignment info (from POS machine)
  assigned_id: string | null
  assigned_name: string | null
  assigned_type: 'retailer' | 'partner' | null
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
  acquiring_bank?: string | null
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
  const [stats, setStats] = useState({ capturedAmount: 0, avgAmount: 0 })
  const [expandedTxn, setExpandedTxn] = useState<string | null>(null)
  const [showRawJson, setShowRawJson] = useState<string | null>(null)
  
  // Filters
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([])
  const [pendingCompanies, setPendingCompanies] = useState<string[]>([])
  const [showCompanyDropdown, setShowCompanyDropdown] = useState(false)
  const companyDropdownRef = useRef<HTMLDivElement>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [paymentModeFilter, setPaymentModeFilter] = useState('')
  const [cardBrandFilter, setCardBrandFilter] = useState('')

  // Column-level sort
  const [sortCol, setSortCol] = useState<string>('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // Column-level inline filters (client-side, current page)
  const [colFilters, setColFilters] = useState<Record<string, string>>({})

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  const setColFilter = (col: string, val: string) => {
    setColFilters(prev => ({ ...prev, [col]: val }))
  }
  
  // Company options
  const companyOptions = [
    { slug: 'ashvam', name: 'ASHVAM LEARNING PRIVATE LIMITED', shortName: 'ASHVAM' },
    { slug: 'teachway', name: 'Teachway Education Private Limited', shortName: 'Teachway' },
    { slug: 'newscenaric', name: 'New Scenaric Travels', shortName: 'New Scenaric' },
    { slug: 'lagoon', name: 'LAGOON CRAFT LABS SOLUTIONS PRIVATE LIMITED', shortName: 'Lagoon' },
  ]

  // Export
  const [exporting, setExporting] = useState<string | null>(null)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  // Report upload (enrich) state
  const [showEnrichModal, setShowEnrichModal] = useState(false)
  const [enrichUploading, setEnrichUploading] = useState(false)
  const [enrichResult, setEnrichResult] = useState<any>(null)
  const enrichFileRef = useRef<HTMLInputElement>(null)

  const [pageSize, setPageSize] = useState(25)

  // Applied filters — only updated when Search button is clicked
  const [appliedFilters, setAppliedFilters] = useState({
    dateFrom: '',
    dateTo: '',
    search: '',
    companies: [] as string[],
    status: '',
    paymentMode: '',
    cardBrand: '',
  })

  const applySearch = () => {
    setAppliedFilters({
      dateFrom,
      dateTo,
      search: searchQuery,
      companies: selectedCompanies,
      status: statusFilter,
      paymentMode: paymentModeFilter,
      cardBrand: cardBrandFilter,
    })
    setPage(1)
  }

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false)
      }
      if (companyDropdownRef.current && !companyDropdownRef.current.contains(e.target as Node)) {
        setShowCompanyDropdown(false)
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
      params.set('limit', String(pageSize))
      if (appliedFilters.dateFrom) params.set('date_from', appliedFilters.dateFrom)
      if (appliedFilters.dateTo) params.set('date_to', appliedFilters.dateTo)
      if (appliedFilters.search) params.set('search', appliedFilters.search)
      if (appliedFilters.companies.length > 0) params.set('merchant_slug', appliedFilters.companies.join(','))
      if (appliedFilters.status) params.set('status', appliedFilters.status)
      if (appliedFilters.paymentMode) params.set('payment_mode', appliedFilters.paymentMode)
      if (appliedFilters.cardBrand) params.set('card_brand', appliedFilters.cardBrand)

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
      setStats(result.stats || { capturedAmount: 0, avgAmount: 0 })
    } catch (err: any) {
      console.error('Error fetching transactions:', err)
      setError(err.message || 'Failed to load transactions')
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }, [user, page, pageSize, appliedFilters])

  // Initial fetch
  useEffect(() => {
    if (!user || user.role !== 'admin') return

    fetchTransactions()
  }, [fetchTransactions, user])

  // Set loading and clear old data when applied filters change
  useEffect(() => {
    setLoading(true)
    setTransactions([])
    setStats({ capturedAmount: 0, avgAmount: 0 })
  }, [appliedFilters])

  // Export transactions
  const exportTransactions = async (format: 'csv' | 'pdf' | 'zip') => {
    setExporting(format)
    setShowExportMenu(false)
    try {
      const params = new URLSearchParams()
      params.set('format', format)
      if (appliedFilters.dateFrom) params.set('date_from', appliedFilters.dateFrom)
      if (appliedFilters.dateTo) params.set('date_to', appliedFilters.dateTo)
      if (appliedFilters.search) params.set('search', appliedFilters.search)
      if (appliedFilters.companies.length > 0) params.set('merchant_slug', appliedFilters.companies.join(','))
      if (appliedFilters.status) params.set('status', appliedFilters.status)
      if (appliedFilters.paymentMode) params.set('payment_mode', appliedFilters.paymentMode)
      if (appliedFilters.cardBrand) params.set('card_brand', appliedFilters.cardBrand)

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
  };

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
  };

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
  };

  // Reset all filters
  const resetFilters = () => {
    setDateFrom('')
    setDateTo('')
    setSearchQuery('')
    setSelectedCompanies([])
    setPendingCompanies([])
    setStatusFilter('')
    setPaymentModeFilter('')
    setCardBrandFilter('')
    setAppliedFilters({ dateFrom: '', dateTo: '', search: '', companies: [], status: '', paymentMode: '', cardBrand: '' })
    setPage(1)
  };

  const hasActiveFilters = dateFrom || dateTo || searchQuery || selectedCompanies.length > 0 || statusFilter || paymentModeFilter || cardBrandFilter

  // Helper to get sortable value for a column
  const getSortVal = (txn: RazorpayTransaction, col: string): string | number => {
    switch (col) {
      case 'txn_id': return txn.txn_id || ''
      case 'date': return txn.created_time || ''
      case 'consumer': return txn.customer_name || txn.payer_name || ''
      case 'company': return txn.merchant_slug || ''
      case 'provider': return txn.service_provider || 'RAZORPAY'
      case 'amount': return txn.amount || 0
      case 'mode': return txn.payment_mode || ''
      case 'card_number': return txn.card_number || ''
      case 'brand': return txn.card_brand || ''
      case 'partner': return txn.assigned_name || ''
      case 'rrn': return txn.rrn || ''
      case 'status': return txn.status || ''
      case 'mid': return txn.mid || ''
      case 'tid': return txn.tid || ''
      default: return ''
    }
  }

  // Apply column filters and sort on current page data
  const displayedTransactions = useMemo(() => {
    let data = [...transactions]

    // Column filters
    Object.entries(colFilters).forEach(([col, val]) => {
      if (!val.trim()) return
      const v = val.trim().toLowerCase()
      data = data.filter(txn => {
        const field = getSortVal(txn, col)
        return String(field).toLowerCase().includes(v)
      })
    })

    // Sort
    if (sortCol) {
      data.sort((a, b) => {
        const av = getSortVal(a, sortCol)
        const bv = getSortVal(b, sortCol)
        if (typeof av === 'number' && typeof bv === 'number') {
          return sortDir === 'asc' ? av - bv : bv - av
        }
        const cmp = String(av).localeCompare(String(bv))
        return sortDir === 'asc' ? cmp : -cmp
      })
    }

    return data
  }, [transactions, colFilters, sortCol, sortDir])

  // Toggle company selection (pending - not applied until "Apply" is clicked)
  const toggleCompany = (slug: string) => {
    setPendingCompanies(prev => 
      prev.includes(slug) 
        ? prev.filter(s => s !== slug)
        : [...prev, slug]
    )
  }
  
  // Select all / deselect all companies (pending)
  const toggleAllCompanies = () => {
    if (pendingCompanies.length === companyOptions.length) {
      setPendingCompanies([])
    } else {
      setPendingCompanies(companyOptions.map(c => c.slug))
    }
  }

  // Apply company filter
  const applyCompanyFilter = () => {
    setSelectedCompanies(pendingCompanies)
    setShowCompanyDropdown(false)
  }
  
  // Format date helper function
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
        second: '2-digit',
        hour12: false
      })
    } catch {
      return 'Invalid Date'
    }
  };

  // Format amount
  const formatAmount = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2
    }).format(amount)
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  };

  const getStatusBadge = (status: 'CAPTURED' | 'FAILED' | 'PENDING') => {
    if (status === 'CAPTURED') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          CAPTURED
        </span>
      )
    }
    if (status === 'FAILED') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
          <XCircle className="w-3 h-3 mr-1" />
          FAILED
        </span>
      )
    }
    if (status === 'PENDING') {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
          <Clock className="w-3 h-3 mr-1" />
          PENDING
        </span>
      )
    }
    return null
  };

  const toggleExpand = (txnId: string) => {
    setExpandedTxn(expandedTxn === txnId ? null : txnId)
    setShowRawJson(null)
  };

  // Use stats from API (aggregated from all filtered transactions, not just current page)
  const capturedAmount = loading ? 0 : stats.capturedAmount
  const avgAmount = loading ? 0 : stats.avgAmount

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
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-1">
                <Receipt className="w-4 h-4 text-blue-500" />
                <span className="text-xs text-gray-500 dark:text-gray-400">Total Transactions</span>
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">{total.toLocaleString('en-IN')}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-1">
                <Banknote className="w-4 h-4 text-emerald-500" />
                <span className="text-xs text-gray-500 dark:text-gray-400">Captured Amount</span>
              </div>
              <p className="text-xl font-bold text-emerald-600 truncate" title={formatAmount(capturedAmount)}>{formatAmount(capturedAmount)}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-1">
                <Calculator className="w-4 h-4 text-purple-500" />
                <span className="text-xs text-gray-500 dark:text-gray-400">Avg Transaction</span>
              </div>
              <p className="text-xl font-bold text-purple-600 truncate" title={formatAmount(avgAmount)}>{formatAmount(avgAmount)}</p>
            </div>
          </div>

          {/* Filters Section */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
            {/* Search & Primary Filters */}
            <div className="p-4 space-y-3">
              {/* Row 1: Search Input */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') applySearch() }}
                  placeholder="Search by TID, MID, RRN, Transaction ID, Customer Name..."
                  className="w-full pl-10 pr-8 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent placeholder-gray-400"
                />
                {searchQuery && (
                  <button onClick={() => { setSearchQuery(''); setAppliedFilters(f => ({ ...f, search: '' })); setPage(1) }} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Row 2: Date Range + Quick Dates + Company + Search Button */}
              <div className="flex flex-wrap items-center gap-3">
                {/* Date Range */}
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    title="From date"
                  />
                  <span className="text-gray-400 text-sm">to</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    title="To date"
                  />
                </div>

                {/* Quick Date Buttons */}
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => { 
                      const today = new Date().toISOString().split('T')[0]
                      setDateFrom(today); setDateTo(today)
                    }}
                    className="px-3 py-2 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors whitespace-nowrap"
                  >
                    Today
                  </button>
                  <button
                    onClick={() => { 
                      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
                      setDateFrom(yesterday); setDateTo(yesterday)
                    }}
                    className="px-3 py-2 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors whitespace-nowrap"
                  >
                    Yesterday
                  </button>
                  <button
                    onClick={() => { 
                      const today = new Date()
                      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)
                      setDateFrom(weekAgo.toISOString().split('T')[0])
                      setDateTo(today.toISOString().split('T')[0])
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
                    }}
                    className="px-3 py-2 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors whitespace-nowrap"
                  >
                    30 Days
                  </button>
                </div>

                {/* Company (POS) Multi-Select Filter */}
                <div className="relative" ref={companyDropdownRef}>
                  <button
                    onClick={() => {
                      if (!showCompanyDropdown) setPendingCompanies([...selectedCompanies])
                      setShowCompanyDropdown(!showCompanyDropdown)
                    }}
                    className="flex items-center gap-2 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent min-w-[180px] hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors"
                    title="Filter by company"
                  >
                    <Building className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    <span className="flex-1 text-left truncate">
                      {selectedCompanies.length === 0 
                        ? 'All Companies' 
                        : selectedCompanies.length === companyOptions.length
                          ? 'All Companies'
                          : selectedCompanies.length === 1
                            ? companyOptions.find(c => c.slug === selectedCompanies[0])?.shortName
                            : `${selectedCompanies.length} Companies`}
                    </span>
                    <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showCompanyDropdown ? 'rotate-180' : ''}`} />
                  </button>
                  
                  <AnimatePresence>
                    {showCompanyDropdown && (
                      <motion.div
                        initial={{ opacity: 0, y: -5, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -5, scale: 0.95 }}
                        transition={{ duration: 0.15 }}
                        className="absolute right-0 mt-2 w-80 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden"
                      >
                        <div className="p-2">
                          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 mb-1">
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Select Companies</span>
                            <button
                              onClick={toggleAllCompanies}
                              className="text-xs text-primary-600 dark:text-primary-400 hover:underline font-medium"
                            >
                              {pendingCompanies.length === companyOptions.length ? 'Deselect All' : 'Select All'}
                            </button>
                          </div>
                          
                          {companyOptions.map((company) => (
                            <label
                              key={company.slug}
                              className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                            >
                              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                                pendingCompanies.includes(company.slug)
                                  ? 'bg-primary-600 border-primary-600'
                                  : 'border-gray-300 dark:border-gray-600'
                              }`}>
                                {pendingCompanies.includes(company.slug) && (
                                  <Check className="w-3.5 h-3.5 text-white" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-gray-900 dark:text-white">{company.shortName}</div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{company.name}</div>
                              </div>
                              <input
                                type="checkbox"
                                checked={pendingCompanies.includes(company.slug)}
                                onChange={() => toggleCompany(company.slug)}
                                className="sr-only"
                              />
                            </label>
                          ))}
                        </div>
                        
                        <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-2.5 bg-gray-50 dark:bg-gray-900/50 flex items-center justify-between gap-2">
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {pendingCompanies.length === 0
                              ? 'All companies'
                              : `${pendingCompanies.length} selected`}
                          </p>
                          <button
                            onClick={applyCompanyFilter}
                            className="px-4 py-1.5 text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
                          >
                            Apply
                          </button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Status Filter */}
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  title="Filter by status"
                >
                  <option value="">All Status</option>
                  <option value="CAPTURED">Captured</option>
                  <option value="FAILED">Failed</option>
                  <option value="PENDING">Pending</option>
                </select>

                {/* Mode Filter */}
                <select
                  value={paymentModeFilter}
                  onChange={(e) => setPaymentModeFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  title="Filter by payment mode"
                >
                  <option value="">All Modes</option>
                  <option value="CARD">Card</option>
                  <option value="UPI">UPI</option>
                  <option value="CASH">Cash</option>
                  <option value="NB">Net Banking</option>
                  <option value="WALLET">Wallet</option>
                </select>

                {/* Brand Filter */}
                <select
                  value={cardBrandFilter}
                  onChange={(e) => setCardBrandFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  title="Filter by card brand"
                >
                  <option value="">All Brands</option>
                  <option value="VISA">Visa</option>
                  <option value="MASTER_CARD">Mastercard</option>
                  <option value="RUPAY">RuPay</option>
                  <option value="AMEX">Amex</option>
                  <option value="DINERS">Diners</option>
                </select>

                {/* Search Button */}
                <button
                  onClick={applySearch}
                  className="flex items-center gap-1.5 px-5 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium whitespace-nowrap"
                >
                  <Search className="w-4 h-4" />
                  Search
                </button>

                {/* Reset Filters */}
                {hasActiveFilters && (
                  <button
                    onClick={resetFilters}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors whitespace-nowrap"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Transactions Table */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  {/* Sort row */}
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="px-3 py-2 w-8" />
                    {([
                      { key: 'txn_id', label: 'Transaction ID' },
                      { key: 'date', label: 'Date' },
                      { key: 'consumer', label: 'Consumer' },
                      { key: 'company', label: 'Company' },
                      { key: 'provider', label: 'Provider' },
                      { key: 'amount', label: 'Amount (₹)' },
                      { key: 'mode', label: 'Mode' },
                      { key: 'card_number', label: 'Card Number' },
                      { key: 'brand', label: 'Brand' },
                      { key: 'partner', label: 'Partner/Retailer Name' },
                      { key: 'rrn', label: 'RRN' },
                      { key: 'status', label: 'Status' },
                      { key: 'mid', label: 'MID' },
                      { key: 'tid', label: 'TID' },
                    ] as { key: string; label: string }[]).map(({ key, label }) => (
                      <th
                        key={key}
                        className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        onClick={() => handleSort(key)}
                      >
                        <div className="flex items-center gap-1 whitespace-nowrap">
                          {label}
                          {sortCol === key ? (
                            sortDir === 'asc'
                              ? <ArrowUp className="w-3 h-3 text-primary-600" />
                              : <ArrowDown className="w-3 h-3 text-primary-600" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 text-gray-300 dark:text-gray-600" />
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                  {/* Column filter row */}
                  <tr className="bg-gray-100 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
                    <th className="px-3 py-1.5 w-8" />
                    {/* Transaction ID */}
                    <th className="px-2 py-1.5">
                      <input value={colFilters['txn_id'] || ''} onChange={e => setColFilter('txn_id', e.target.value)} placeholder="Filter…" className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-primary-500 focus:border-transparent placeholder-gray-400 min-w-[100px]" />
                    </th>
                    {/* Date */}
                    <th className="px-2 py-1.5">
                      <input value={colFilters['date'] || ''} onChange={e => setColFilter('date', e.target.value)} placeholder="Filter…" className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-primary-500 focus:border-transparent placeholder-gray-400 min-w-[90px]" />
                    </th>
                    {/* Consumer */}
                    <th className="px-2 py-1.5">
                      <input value={colFilters['consumer'] || ''} onChange={e => setColFilter('consumer', e.target.value)} placeholder="Filter…" className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-primary-500 focus:border-transparent placeholder-gray-400 min-w-[90px]" />
                    </th>
                    {/* Company */}
                    <th className="px-2 py-1.5">
                      <select value={colFilters['company'] || ''} onChange={e => setColFilter('company', e.target.value)} className="w-full px-1 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-primary-500 focus:border-transparent min-w-[90px]">
                        <option value="">All</option>
                        <option value="ashvam">ASHVAM</option>
                        <option value="teachway">Teachway</option>
                        <option value="newscenaric">New Scenaric</option>
                        <option value="lagoon">Lagoon</option>
                      </select>
                    </th>
                    {/* Provider */}
                    <th className="px-2 py-1.5">
                      <input value={colFilters['provider'] || ''} onChange={e => setColFilter('provider', e.target.value)} placeholder="Filter…" className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-primary-500 focus:border-transparent placeholder-gray-400 min-w-[80px]" />
                    </th>
                    {/* Amount */}
                    <th className="px-2 py-1.5">
                      <input value={colFilters['amount'] || ''} onChange={e => setColFilter('amount', e.target.value)} placeholder="Filter…" type="number" className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-primary-500 focus:border-transparent placeholder-gray-400 min-w-[80px]" />
                    </th>
                    {/* Mode */}
                    <th className="px-2 py-1.5">
                      <select value={colFilters['mode'] || ''} onChange={e => setColFilter('mode', e.target.value)} className="w-full px-1 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-primary-500 focus:border-transparent min-w-[70px]">
                        <option value="">All</option>
                        <option value="CARD">Card</option>
                        <option value="UPI">UPI</option>
                        <option value="CASH">Cash</option>
                        <option value="NB">NB</option>
                        <option value="WALLET">Wallet</option>
                      </select>
                    </th>
                    {/* Card Number */}
                    <th className="px-2 py-1.5">
                      <input value={colFilters['card_number'] || ''} onChange={e => setColFilter('card_number', e.target.value)} placeholder="Filter…" className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-primary-500 focus:border-transparent placeholder-gray-400 min-w-[90px]" />
                    </th>
                    {/* Brand */}
                    <th className="px-2 py-1.5">
                      <select value={colFilters['brand'] || ''} onChange={e => setColFilter('brand', e.target.value)} className="w-full px-1 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-primary-500 focus:border-transparent min-w-[70px]">
                        <option value="">All</option>
                        <option value="VISA">Visa</option>
                        <option value="MASTER_CARD">Mastercard</option>
                        <option value="RUPAY">RuPay</option>
                        <option value="AMEX">Amex</option>
                        <option value="DINERS">Diners</option>
                      </select>
                    </th>
                    {/* Partner/Retailer Name */}
                    <th className="px-2 py-1.5">
                      <input value={colFilters['partner'] || ''} onChange={e => setColFilter('partner', e.target.value)} placeholder="Filter…" className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-primary-500 focus:border-transparent placeholder-gray-400 min-w-[110px]" />
                    </th>
                    {/* RRN */}
                    <th className="px-2 py-1.5">
                      <input value={colFilters['rrn'] || ''} onChange={e => setColFilter('rrn', e.target.value)} placeholder="Filter…" className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-primary-500 focus:border-transparent placeholder-gray-400 min-w-[90px]" />
                    </th>
                    {/* Status */}
                    <th className="px-2 py-1.5">
                      <select value={colFilters['status'] || ''} onChange={e => setColFilter('status', e.target.value)} className="w-full px-1 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-primary-500 focus:border-transparent min-w-[80px]">
                        <option value="">All</option>
                        <option value="CAPTURED">Captured</option>
                        <option value="FAILED">Failed</option>
                        <option value="PENDING">Pending</option>
                      </select>
                    </th>
                    {/* MID */}
                    <th className="px-2 py-1.5">
                      <input value={colFilters['mid'] || ''} onChange={e => setColFilter('mid', e.target.value)} placeholder="Filter…" className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-primary-500 focus:border-transparent placeholder-gray-400 min-w-[70px]" />
                    </th>
                    {/* TID */}
                    <th className="px-2 py-1.5">
                      <input value={colFilters['tid'] || ''} onChange={e => setColFilter('tid', e.target.value)} placeholder="Filter…" className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-primary-500 focus:border-transparent placeholder-gray-400 min-w-[70px]" />
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {displayedTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={15} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                        <div className="flex flex-col items-center gap-2">
                          {loading ? (
                            <>
                              <Loader2 className="w-6 h-6 animate-spin" />
                              <span>Loading transactions...</span>
                            </>
                          ) : Object.values(colFilters).some(v => v.trim()) ? (
                            <>
                              <AlertTriangle className="w-6 h-6 text-yellow-500" />
                              <span>No transactions match the column filters</span>
                              <button onClick={() => setColFilters({})} className="text-primary-600 hover:underline text-sm mt-1">Clear column filters</button>
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
                    displayedTransactions.map((txn) => (
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
                          <td className="px-3 py-3 whitespace-nowrap text-xs text-gray-600 dark:text-gray-400">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                              {txn.service_provider || 'RAZORPAY'}
                            </span>
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
                          <td className="px-3 py-3 whitespace-nowrap text-xs text-gray-600 dark:text-gray-400 max-w-[160px] truncate" title={txn.assigned_name || '-'}>
                            {txn.assigned_name || '-'}
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
                                      
                                      {/* Partner/Retailer Assignment Info */}
                                      <DetailItem icon={<User className="w-4 h-4" />} label="Partner/Retailer Name" value={txn.assigned_name} />
                                      <DetailItem label="Assignment Type" value={txn.assigned_type ? (txn.assigned_type === 'retailer' ? 'Retailer' : 'Partner') : null} />
                                      
                                      {/* Terminal / Device Info */}
                                      <DetailItem icon={<Terminal className="w-4 h-4" />} label="TID (Terminal ID)" value={txn.tid} mono />
                                      <DetailItem icon={<Building className="w-4 h-4" />} label="MID (Merchant ID)" value={txn.mid} mono />
                                      <DetailItem icon={<Smartphone className="w-4 h-4" />} label="Device Serial" value={txn.device_serial || '(empty)'} mono />
                                      
                                      {/* Card Details */}
                                      <DetailItem icon={<CreditCard className="w-4 h-4" />} label="Card Number" value={txn.card_number} mono />
                                      <DetailItem label="Card Brand" value={txn.card_brand} />
                                      <DetailItem label="Card Type" value={txn.card_type} />
                                      <DetailItem label="Issuing Bank" value={txn.issuing_bank} />
                                      <DetailItem label="Acquiring Bank" value={txn.acquiring_bank} />
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
                                      <DetailItem label="Service Provider" value={txn.service_provider || 'RAZORPAY'} />
                                      
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
            {total > 0 && (
              <div className="bg-gray-50 dark:bg-gray-900 px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-gray-200 dark:border-gray-700">
                <div className="flex flex-wrap items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500 dark:text-gray-400">Rows:</span>
                    <select
                      value={pageSize}
                      onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }}
                      className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-1 focus:ring-primary-500 focus:border-transparent"
                    >
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                  </div>
                </div>
                {totalPages > 1 && (
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
                )}
              </div>
            )}
          </div>
        </div>
      </div>

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
