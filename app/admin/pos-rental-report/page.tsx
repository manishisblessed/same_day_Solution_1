'use client'

import { useState, useEffect, Suspense, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import AdminSidebar from '@/components/AdminSidebar'
import { 
  Loader2,
  Download,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Search,
  Filter,
  X,
  Eye,
  Copy,
  Check
} from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { motion, AnimatePresence } from 'framer-motion'

type TabType = 'current_month' | 'last_month' | 'all_history'

interface RentalRecord {
  company_name: string
  partner_name: string
  partner_type: string
  pos_count: number
  pos_tids: string[]
  monthly_rate: number
  billing_period_start: string
  billing_period_end: string
  billable_days: number
  total_prorata_amount: number
  status: string
}

interface FilterState {
  dateFrom: string
  dateTo: string
  company: string
  partnerType: string
  status: string
}

// ── TID Modal ─────────────────────────────────────────────────────────────────
function TIDModal({
  partnerName,
  companyName,
  tids,
  onClose,
}: {
  partnerName: string
  companyName: string
  tids: string[]
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [tidSearch, setTidSearch] = useState('')

  const filtered = tids.filter(t => t.toLowerCase().includes(tidSearch.toLowerCase()))

  const handleCopyAll = () => {
    navigator.clipboard.writeText(tids.join(', '))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              All TIDs — {tids.length} POS
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {partnerName} · {companyName}
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Search inside modal */}
        <div className="px-5 pt-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={tidSearch}
              onChange={e => setTidSearch(e.target.value)}
              placeholder="Search TID..."
              autoFocus
              className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
          </div>
          {tidSearch && (
            <p className="text-xs text-gray-500 mt-1">{filtered.length} of {tids.length} matched</p>
          )}
        </div>

        {/* TID List */}
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          <div className="grid grid-cols-2 gap-2 mt-2">
            {filtered.map((tid, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700"
              >
                <span className="text-xs text-gray-400 w-5 shrink-0">{tids.indexOf(tid) + 1}.</span>
                <span className="font-mono text-sm text-gray-900 dark:text-white flex-1">{tid}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-between items-center">
          <span className="text-sm text-gray-500">Total: {tids.length} TIDs</span>
          <button
            onClick={handleCopyAll}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 transition-colors"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied!' : 'Copy All'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function POSRentalReportPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary-600" /></div>}>
      <POSRentalReportContent />
    </Suspense>
  )
}

function POSRentalReportContent() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('current_month')

  const [records, setRecords] = useState<RentalRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState({ totalPOS: 0, totalBillableDays: 0, totalRevenue: 0 })

  // Global search (all tabs)
  const [globalSearch, setGlobalSearch] = useState('')
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null)

  // Advanced filters (All History tab)
  const [filters, setFilters] = useState<FilterState>({
    dateFrom: '',
    dateTo: '',
    company: '',
    partnerType: '',
    status: '',
  })
  const [companies, setCompanies] = useState<string[]>([])
  const [showFilters, setShowFilters] = useState(false)

  // TID modal
  const [tidModal, setTidModal] = useState<{ partnerName: string; companyName: string; tids: string[] } | null>(null)

  // Auth check
  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'admin')) {
      router.push('/admin/login')
    }
  }, [user, authLoading, router])

  useEffect(() => {
    if (user && user.role === 'admin') fetchCompanies()
  }, [user])

  const fetchCompanies = async () => {
    try {
      const response = await apiFetch('/api/admin/pos-rental-report/companies')
      const result = await response.json()
      if (response.ok) setCompanies(result.companies || [])
    } catch (err) {
      console.error('Error fetching companies:', err)
    }
  }

  useEffect(() => {
    if (user && user.role === 'admin') fetchRentalData()
  }, [activeTab, page, filters, user])

  // Debounce global search
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => {
      setPage(1)
      fetchRentalData()
    }, 400)
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current) }
  }, [globalSearch])

  const fetchRentalData = async () => {
    if (!user || user.role !== 'admin') return
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.append('period', activeTab)
      params.append('page', page.toString())
      if (globalSearch) params.append('search', globalSearch)

      if (activeTab === 'all_history') {
        if (filters.dateFrom) params.append('dateFrom', filters.dateFrom)
        if (filters.dateTo) params.append('dateTo', filters.dateTo)
        if (filters.company) params.append('company', filters.company)
        if (filters.partnerType) params.append('partnerType', filters.partnerType)
        if (filters.status) params.append('status', filters.status)
      }

      const response = await apiFetch(`/api/admin/pos-rental-report?${params}`)
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Failed to fetch')

      setRecords(result.data || [])
      setTotalPages(result.pagination?.totalPages || 1)
      setTotal(result.pagination?.total || 0)
      setStats(result.stats || { totalPOS: 0, totalBillableDays: 0, totalRevenue: 0 })
    } catch (err: any) {
      console.error('Error:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async () => {
    try {
      const params = new URLSearchParams()
      params.append('period', activeTab)
      if (globalSearch) params.append('search', globalSearch)
      if (activeTab === 'all_history') {
        if (filters.dateFrom) params.append('dateFrom', filters.dateFrom)
        if (filters.dateTo) params.append('dateTo', filters.dateTo)
        if (filters.company) params.append('company', filters.company)
        if (filters.partnerType) params.append('partnerType', filters.partnerType)
        if (filters.status) params.append('status', filters.status)
      }

      const response = await apiFetch(`/api/admin/pos-rental-report/export?${params}`)
      if (!response.ok) throw new Error('Export failed')

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `POS_Rental_Report_${activeTab}_${new Date().toISOString().split('T')[0]}.xlsx`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err: any) {
      console.error('Export error:', err)
    }
  }

  const handleFilterChange = (key: keyof FilterState, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }))
    setPage(1)
  }

  const handleResetFilters = () => {
    setFilters({ dateFrom: '', dateTo: '', company: '', partnerType: '', status: '' })
    setGlobalSearch('')
    setPage(1)
  }

  const getTabPeriod = () => {
    const now = new Date()
    if (activeTab === 'current_month') {
      return `01 ${now.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })} — Today`
    }
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    if (activeTab === 'last_month') {
      return `${lm.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })} (Complete)`
    }
    return 'From First Assignment to Today'
  }

  const activeFilterCount = Object.values(filters).filter(Boolean).length

  if (authLoading) {
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
        <div className="p-6 space-y-5">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">📊 POS Rental Report</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Prorata basis · rates synced from subscription scheme</p>
          </div>

          {/* Tabs */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow">
            {/* Tab bar */}
            <div className="flex border-b border-gray-200 dark:border-gray-700">
              {(['current_month', 'last_month', 'all_history'] as TabType[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => { setActiveTab(tab); setPage(1) }}
                  className={`flex-1 px-4 py-3.5 text-sm font-medium text-center transition-all ${
                    activeTab === tab
                      ? 'border-b-2 border-primary-600 text-primary-600 dark:text-primary-400'
                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                  }`}
                >
                  {tab === 'current_month' && '📅 Current Month'}
                  {tab === 'last_month' && '📆 Last Month'}
                  {tab === 'all_history' && '📚 All History'}
                </button>
              ))}
            </div>

            <div className="p-5 space-y-5">
              {/* Period label + stats row */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-gray-500 dark:text-gray-400">{getTabPeriod()}</p>
              </div>

              {/* Stats Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 border border-blue-100 dark:border-blue-800">
                  <p className="text-xs text-blue-600 dark:text-blue-400">Total Partners</p>
                  <p className="text-xl font-bold text-blue-900 dark:text-blue-100 mt-0.5">{total}</p>
                </div>
                <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3 border border-purple-100 dark:border-purple-800">
                  <p className="text-xs text-purple-600 dark:text-purple-400">Total POS</p>
                  <p className="text-xl font-bold text-purple-900 dark:text-purple-100 mt-0.5">{stats.totalPOS}</p>
                </div>
                <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3 border border-orange-100 dark:border-orange-800">
                  <p className="text-xs text-orange-600 dark:text-orange-400">Avg Days / POS</p>
                  <p className="text-xl font-bold text-orange-900 dark:text-orange-100 mt-0.5">
                    {stats.totalPOS > 0 ? (stats.totalBillableDays / stats.totalPOS).toFixed(1) : 0} days
                  </p>
                </div>
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 border border-green-100 dark:border-green-800">
                  <p className="text-xs text-green-600 dark:text-green-400">Total Revenue</p>
                  <p className="text-xl font-bold text-green-900 dark:text-green-100 mt-0.5">
                    ₹{stats.totalRevenue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              </div>

              {/* ── Search + Action Bar (all tabs) ── */}
              <div className="flex flex-wrap gap-2 items-center">
                {/* Global search */}
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={globalSearch}
                    onChange={e => setGlobalSearch(e.target.value)}
                    placeholder="Search by Partner / Retailer name or TID..."
                    className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500"
                  />
                  {globalSearch && (
                    <button
                      onClick={() => setGlobalSearch('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Advanced filters toggle (All History only) */}
                {activeTab === 'all_history' && (
                  <button
                    onClick={() => setShowFilters(f => !f)}
                    className={`flex items-center gap-2 px-3 py-2 text-sm rounded-lg border transition-colors ${
                      showFilters || activeFilterCount > 0
                        ? 'bg-primary-50 border-primary-300 text-primary-700 dark:bg-primary-900/20 dark:border-primary-700 dark:text-primary-400'
                        : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    <Filter className="w-4 h-4" />
                    Filters
                    {activeFilterCount > 0 && (
                      <span className="ml-0.5 px-1.5 py-0.5 text-xs bg-primary-600 text-white rounded-full">{activeFilterCount}</span>
                    )}
                  </button>
                )}

                <button
                  onClick={() => fetchRentalData()}
                  disabled={loading}
                  className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>

                <button
                  onClick={handleExport}
                  disabled={loading || records.length === 0}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Export Excel
                </button>
              </div>

              {/* Advanced filters panel */}
              <AnimatePresence>
                {activeTab === 'all_history' && showFilters && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 border border-gray-200 dark:border-gray-700 space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Date From</label>
                          <input type="date" value={filters.dateFrom} onChange={e => handleFilterChange('dateFrom', e.target.value)}
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Date To</label>
                          <input type="date" value={filters.dateTo} onChange={e => handleFilterChange('dateTo', e.target.value)}
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Company</label>
                          <select value={filters.company} onChange={e => handleFilterChange('company', e.target.value)}
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                            <option value="">All Companies</option>
                            {companies.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Partner Type</label>
                          <select value={filters.partnerType} onChange={e => handleFilterChange('partnerType', e.target.value)}
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                            <option value="">All Types</option>
                            <option value="Retailer">Retailer</option>
                            <option value="Distributor">Distributor</option>
                            <option value="Master Distributor">Master Distributor</option>
                            <option value="Partner">Partner</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Status</label>
                          <select value={filters.status} onChange={e => handleFilterChange('status', e.target.value)}
                            className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                            <option value="">All</option>
                            <option value="active">Active</option>
                            <option value="returned">Returned</option>
                          </select>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={handleResetFilters}
                          className="px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50">
                          Reset All
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Result count */}
              <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
                <span>
                  {globalSearch
                    ? `${records.length} result${records.length !== 1 ? 's' : ''} for "${globalSearch}"`
                    : `${total} partner${total !== 1 ? 's' : ''} · ${stats.totalPOS} POS machines`}
                </span>
                {totalPages > 1 && <span>Page {page} of {totalPages}</span>}
              </div>

              {/* Table */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                        <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase w-10">Sr.</th>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Company</th>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Partner / Retailer</th>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Type</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase w-20">No. of POS</th>
                        <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">TIDs</th>
                        <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Rate/Month</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Rental Period</th>
                        <th className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Prorata (₹)</th>
                        <th className="px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-100 dark:divide-gray-700">
                      {loading ? (
                        <tr>
                        <td colSpan={10} className="py-16 text-center">
                            <Loader2 className="w-6 h-6 animate-spin text-primary-600 mx-auto" />
                          </td>
                        </tr>
                      ) : records.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="py-16 text-center text-gray-500 dark:text-gray-400">
                            {globalSearch ? `No results found for "${globalSearch}"` : 'No records found'}
                          </td>
                        </tr>
                      ) : (
                        records.map((record, idx) => (
                          <motion.tr
                            key={idx}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors"
                          >
                            <td className="px-3 py-3 text-gray-400 text-xs">
                              {((page - 1) * 25) + idx + 1}
                            </td>
                            <td className="px-3 py-3 font-medium text-gray-900 dark:text-white max-w-[180px]">
                              <div className="truncate" title={record.company_name}>{record.company_name || '—'}</div>
                            </td>
                            <td className="px-3 py-3 text-gray-700 dark:text-gray-300 max-w-[180px]">
                              <div className="truncate" title={record.partner_name}>{record.partner_name}</div>
                            </td>
                            <td className="px-3 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                              {record.partner_type}
                            </td>
                            <td className="px-3 py-3 text-center font-bold text-gray-900 dark:text-white">
                              {record.pos_count}
                            </td>
                            {/* TIDs cell with View button */}
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-500 truncate max-w-[120px]" title={record.pos_tids.join(', ')}>
                                  {record.pos_tids.slice(0, 2).join(', ')}
                                  {record.pos_tids.length > 2 && ` +${record.pos_tids.length - 2} more`}
                                </span>
                                <button
                                  onClick={() => setTidModal({ partnerName: record.partner_name, companyName: record.company_name, tids: record.pos_tids })}
                                  className="shrink-0 flex items-center gap-1 px-2 py-0.5 text-xs bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-800 rounded-full hover:bg-primary-100 transition-colors"
                                  title="View all TIDs"
                                >
                                  <Eye className="w-3 h-3" />
                                  All
                                </button>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right text-gray-900 dark:text-white whitespace-nowrap">
                              ₹{record.monthly_rate.toLocaleString('en-IN')}
                            </td>
                            <td className="px-3 py-3 text-center text-gray-700 dark:text-gray-300 whitespace-nowrap">
                              <div className="flex flex-col items-center gap-0.5">
                                <span className="font-semibold text-sm text-gray-900 dark:text-white">
                                  {record.billable_days} days
                                </span>
                                <span className="text-xs text-gray-400">
                                  {new Date(record.billing_period_start).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                                  {' → '}
                                  {new Date(record.billing_period_end).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right font-bold text-primary-600 dark:text-primary-400 whitespace-nowrap">
                              ₹{record.total_prorata_amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                                record.status === 'active'
                                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                  : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                              }`}>
                                {record.status === 'active' ? 'Active' : 'Returned'}
                              </span>
                            </td>
                          </motion.tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="bg-gray-50 dark:bg-gray-900 px-4 py-3 flex items-center justify-between border-t border-gray-200 dark:border-gray-700">
                    <span className="text-sm text-gray-500">Page {page} / {totalPages}</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1 || loading}
                        className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages || loading}
                        className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* TID Modal */}
      <AnimatePresence>
        {tidModal && (
          <TIDModal
            partnerName={tidModal.partnerName}
            companyName={tidModal.companyName}
            tids={tidModal.tids}
            onClose={() => setTidModal(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
