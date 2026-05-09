'use client'

import { useState, useEffect, Suspense } from 'react'
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
  Calendar,
  Filter,
  X
} from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { motion } from 'framer-motion'

type TabType = 'current_month' | 'last_month' | 'all_history'

interface RentalRecord {
  month: string
  company_name: string
  partner_name: string
  partner_type: string
  pos_count: number
  pos_tids: string[]
  monthly_rate: number
  assigned_date: string
  return_date: string | null
  rental_days: number
  prorata_amount: number
  status: 'active' | 'returned'
}

interface FilterState {
  dateFrom: string
  dateTo: string
  company: string
  partnerType: string
  status: string
  searchQuery: string
}

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
  const [stats, setStats] = useState({ totalPOS: 0, totalDays: 0, totalRevenue: 0 })
  
  const [filters, setFilters] = useState<FilterState>({
    dateFrom: '',
    dateTo: '',
    company: '',
    partnerType: '',
    status: '',
    searchQuery: ''
  })
  const [companies, setCompanies] = useState<string[]>([])

  // Auth check
  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'admin')) {
      router.push('/admin/login')
    }
  }, [user, authLoading, router])

  // Fetch companies for filter dropdown
  useEffect(() => {
    if (user && user.role === 'admin') {
      fetchCompanies()
    }
  }, [user])

  const fetchCompanies = async () => {
    try {
      const response = await apiFetch('/api/admin/pos-rental-report/companies')
      const result = await response.json()
      if (response.ok) {
        setCompanies(result.companies || [])
      }
    } catch (err) {
      console.error('Error fetching companies:', err)
    }
  }

  // Fetch data based on active tab
  useEffect(() => {
    if (user && user.role === 'admin') {
      fetchRentalData()
    }
  }, [activeTab, page, filters, user])

  const fetchRentalData = async () => {
    setLoading(true)
    try {
      let params = new URLSearchParams()
      params.append('period', activeTab)
      params.append('page', page.toString())

      if (activeTab === 'all_history') {
        if (filters.dateFrom) params.append('dateFrom', filters.dateFrom)
        if (filters.dateTo) params.append('dateTo', filters.dateTo)
        if (filters.company) params.append('company', filters.company)
        if (filters.partnerType) params.append('partnerType', filters.partnerType)
        if (filters.status) params.append('status', filters.status)
        if (filters.searchQuery) params.append('search', filters.searchQuery)
      }

      const response = await apiFetch(`/api/admin/pos-rental-report?${params.toString()}`)
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to fetch rental data')
      }

      setRecords(result.data || [])
      setTotalPages(result.pagination?.totalPages || 1)
      setTotal(result.pagination?.total || 0)
      setStats(result.stats || { totalPOS: 0, totalDays: 0, totalRevenue: 0 })
    } catch (err: any) {
      console.error('Error fetching rental data:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async () => {
    try {
      let params = new URLSearchParams()
      params.append('period', activeTab)

      if (activeTab === 'all_history') {
        if (filters.dateFrom) params.append('dateFrom', filters.dateFrom)
        if (filters.dateTo) params.append('dateTo', filters.dateTo)
        if (filters.company) params.append('company', filters.company)
        if (filters.partnerType) params.append('partnerType', filters.partnerType)
        if (filters.status) params.append('status', filters.status)
        if (filters.searchQuery) params.append('search', filters.searchQuery)
      }

      const response = await apiFetch(`/api/admin/pos-rental-report/export?${params.toString()}`)
      
      if (!response.ok) {
        throw new Error('Export failed')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      
      const now = new Date()
      const dateStr = now.toISOString().split('T')[0]
      a.download = `POS_Rental_Report_${activeTab}_${dateStr}.xlsx`
      
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (err: any) {
      console.error('Error exporting:', err)
    }
  }

  const handleFilterChange = (key: keyof FilterState, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }))
    setPage(1)
  }

  const handleResetFilters = () => {
    setFilters({
      dateFrom: '',
      dateTo: '',
      company: '',
      partnerType: '',
      status: '',
      searchQuery: ''
    })
    setPage(1)
  }

  const getTabLabel = () => {
    if (activeTab === 'current_month') return '📅 Current Month (May 2026)'
    if (activeTab === 'last_month') return '📆 Last Month (April 2026)'
    return '📚 All History (Jan 2024 to Now)'
  }

  const getTabPeriod = () => {
    if (activeTab === 'current_month') return 'Period: 01-May-2026 to Today'
    if (activeTab === 'last_month') return 'Period: 01-Apr-2026 to 30-Apr-2026'
    return 'Period: From First Assignment to Today'
  }

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
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                📊 POS Rental Report
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mt-1">
                Rental charges on prorata basis
              </p>
            </div>
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg"
            >
              <Filter className="w-6 h-6" />
            </button>
          </div>

          {/* Tabs */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
            <div className="flex border-b border-gray-200 dark:border-gray-700">
              {(['current_month', 'last_month', 'all_history'] as TabType[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => {
                    setActiveTab(tab)
                    setPage(1)
                  }}
                  className={`flex-1 px-4 py-4 font-medium text-center transition-all ${
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

            {/* Tab Content */}
            <div className="p-6 space-y-6">
              {/* Tab Header */}
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                  {getTabLabel()}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {getTabPeriod()}
                </p>
              </div>

              {/* Stats Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                  <p className="text-sm text-blue-600 dark:text-blue-400">Total POS</p>
                  <p className="text-2xl font-bold text-blue-900 dark:text-blue-100 mt-1">
                    {stats.totalPOS}
                  </p>
                </div>
                <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 border border-purple-200 dark:border-purple-800">
                  <p className="text-sm text-purple-600 dark:text-purple-400">Total Days</p>
                  <p className="text-2xl font-bold text-purple-900 dark:text-purple-100 mt-1">
                    {stats.totalDays.toLocaleString()}
                  </p>
                </div>
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 border border-green-200 dark:border-green-800">
                  <p className="text-sm text-green-600 dark:text-green-400">Total Revenue</p>
                  <p className="text-2xl font-bold text-green-900 dark:text-green-100 mt-1">
                    ₹{stats.totalRevenue.toLocaleString()}
                  </p>
                </div>
                <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-4 border border-orange-200 dark:border-orange-800">
                  <p className="text-sm text-orange-600 dark:text-orange-400">Avg Days</p>
                  <p className="text-2xl font-bold text-orange-900 dark:text-orange-100 mt-1">
                    {stats.totalPOS > 0 ? (stats.totalDays / stats.totalPOS).toFixed(1) : 0}
                  </p>
                </div>
              </div>

              {/* Filters (only for All History tab) */}
              {activeTab === 'all_history' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 border border-gray-200 dark:border-gray-700"
                >
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                    <Filter className="w-4 h-4" />
                    Filters
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Date From
                      </label>
                      <input
                        type="date"
                        value={filters.dateFrom}
                        onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Date To
                      </label>
                      <input
                        type="date"
                        value={filters.dateTo}
                        onChange={(e) => handleFilterChange('dateTo', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Company
                      </label>
                      <select
                        value={filters.company}
                        onChange={(e) => handleFilterChange('company', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      >
                        <option value="">All Companies</option>
                        {companies.map((company) => (
                          <option key={company} value={company}>
                            {company}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Partner Type
                      </label>
                      <select
                        value={filters.partnerType}
                        onChange={(e) => handleFilterChange('partnerType', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      >
                        <option value="">All Types</option>
                        <option value="Retailer">Retailer</option>
                        <option value="Distributor">Distributor</option>
                        <option value="Master Distributor">Master Distributor</option>
                        <option value="Partner">Partner</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Status
                      </label>
                      <select
                        value={filters.status}
                        onChange={(e) => handleFilterChange('status', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      >
                        <option value="">All Status</option>
                        <option value="active">Active</option>
                        <option value="returned">Returned</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Search
                      </label>
                      <input
                        type="text"
                        value={filters.searchQuery}
                        onChange={(e) => handleFilterChange('searchQuery', e.target.value)}
                        placeholder="Search company, partner, TID..."
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => fetchRentalData()}
                      className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors flex items-center gap-2"
                    >
                      <Search className="w-4 h-4" />
                      Apply Filters
                    </button>
                    <button
                      onClick={handleResetFilters}
                      className="px-4 py-2 bg-gray-300 dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg hover:bg-gray-400 dark:hover:bg-gray-600 transition-colors"
                    >
                      Reset
                    </button>
                  </div>
                </motion.div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => fetchRentalData()}
                  disabled={loading}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
                <button
                  onClick={handleExport}
                  disabled={loading || records.length === 0}
                  className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Export Excel
                </button>
              </div>

              {/* Results count */}
              {activeTab === 'all_history' && (
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Showing {records.length} results (filtered from {total} total)
                </p>
              )}

              {/* Table */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-900">
                      <tr>
                        {activeTab === 'all_history' && (
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Month</th>
                        )}
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Company</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Partner</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">POS</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">TIDs</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Rate/Month</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Assigned</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Return</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Days</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Prorata (₹)</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {loading ? (
                        <tr>
                          <td colSpan={activeTab === 'all_history' ? 12 : 11} className="px-6 py-12 text-center">
                            <Loader2 className="w-6 h-6 animate-spin text-primary-600 mx-auto" />
                          </td>
                        </tr>
                      ) : records.length === 0 ? (
                        <tr>
                          <td colSpan={activeTab === 'all_history' ? 12 : 11} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                            No records found
                          </td>
                        </tr>
                      ) : (
                        records.map((record, idx) => (
                          <motion.tr
                            key={idx}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                          >
                            {activeTab === 'all_history' && (
                              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                                {record.month}
                              </td>
                            )}
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                              {record.company_name}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                              {record.partner_name}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                              {record.partner_type}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                              {record.pos_count}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400">
                              <div className="max-w-xs truncate" title={record.pos_tids.join(', ')}>
                                {record.pos_tids.join(', ')}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                              ₹{record.monthly_rate.toLocaleString()}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                              {new Date(record.assigned_date).toLocaleDateString('en-IN', { month: 'short', day: '2-digit', year: '2-digit' })}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                              {record.return_date ? new Date(record.return_date).toLocaleDateString('en-IN', { month: 'short', day: '2-digit', year: '2-digit' }) : '-'}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                              {record.rental_days} d
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-primary-600 dark:text-primary-400">
                              ₹{record.prorata_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                record.status === 'active'
                                  ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                                  : 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
                              }`}>
                                {record.status === 'active' ? '🟢 Active' : '⊘ Returned'}
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
                  <div className="bg-gray-50 dark:bg-gray-900 px-6 py-4 flex items-center justify-between border-t border-gray-200 dark:border-gray-700">
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      Page {page} of {totalPages}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page === 1 || loading}
                        className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        disabled={page === totalPages || loading}
                        className="p-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
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
    </div>
  )
}
