'use client'

import { useState, useEffect, useMemo, Suspense } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { Retailer, Distributor, MasterDistributor, POSMachine } from '@/types/database.types'
import AdminSidebar from '@/components/AdminSidebar'
import { 
  Plus, Edit, Trash2, Search, Filter, Download, 
  Users, Package, Crown, TrendingUp, Activity,
  X, Check, AlertCircle, Menu, ArrowUpDown, 
  ChevronLeft, ChevronRight, FileSpreadsheet, FileText,
  MoreVertical, Eye, RefreshCw, Settings, CreditCard, MapPin, Calendar
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

type TabType = 'retailers' | 'distributors' | 'master-distributors' | 'services' | 'pos-machines'
type SortField = 'name' | 'email' | 'partner_id' | 'created_at' | 'status'
type SortDirection = 'asc' | 'desc'

function AdminDashboardContent() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  
  // Initialize activeTab from URL or default to 'retailers'
  const getInitialTab = (): TabType => {
    const tab = searchParams.get('tab')
    if (tab && ['retailers', 'distributors', 'master-distributors', 'pos-machines', 'services'].includes(tab)) {
      return tab as TabType
    }
    return 'retailers'
  }
  
  const [activeTab, setActiveTab] = useState<TabType>(getInitialTab())
  const [showModal, setShowModal] = useState(false)
  const [editingItem, setEditingItem] = useState<any>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'suspended'>('all')
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(10)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  
  const [retailers, setRetailers] = useState<Retailer[]>([])
  const [distributors, setDistributors] = useState<Distributor[]>([])
  const [masterDistributors, setMasterDistributors] = useState<MasterDistributor[]>([])
  const [posMachines, setPosMachines] = useState<POSMachine[]>([])
  const [loading, setLoading] = useState(true)

  // Sync activeTab with URL query params
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab && ['retailers', 'distributors', 'master-distributors', 'pos-machines', 'services'].includes(tab)) {
      if (tab !== activeTab) {
        setActiveTab(tab as TabType)
      }
    }
  }, [searchParams, activeTab])

  // Sync activeTab with URL query params
  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab && ['retailers', 'distributors', 'master-distributors', 'pos-machines', 'services'].includes(tab)) {
      if (tab !== activeTab) {
        setActiveTab(tab as TabType)
      }
    } else if (!tab && activeTab !== 'retailers') {
      // If no tab in URL, default to retailers
      setActiveTab('retailers')
    }
  }, [searchParams])

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'admin')) {
      router.push('/admin/login')
    }
  }, [user, authLoading, router])

  useEffect(() => {
    if (user?.role === 'admin') {
      fetchData()
    }
  }, [activeTab, user])

  const fetchData = async () => {
    if (activeTab === 'services') {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      if (activeTab === 'retailers') {
        const { data, error } = await supabase
          .from('retailers')
          .select('*')
          .order('created_at', { ascending: false })
        if (error) throw error
        setRetailers(data || [])
      } else if (activeTab === 'distributors') {
        const { data, error } = await supabase
          .from('distributors')
          .select('*')
          .order('created_at', { ascending: false })
        if (error) throw error
        setDistributors(data || [])
      } else if (activeTab === 'pos-machines') {
        const { data, error } = await supabase
          .from('pos_machines')
          .select('*')
          .order('created_at', { ascending: false })
        if (error) throw error
        setPosMachines(data || [])
        // Also fetch retailers, distributors, and master distributors for dropdowns
        const [{ data: retailersData }, { data: distributorsData }, { data: masterDistributorsData }] = await Promise.all([
          supabase.from('retailers').select('*').order('name'),
          supabase.from('distributors').select('*').order('name'),
          supabase.from('master_distributors').select('*').order('name')
        ])
        if (retailersData) setRetailers(retailersData)
        if (distributorsData) setDistributors(distributorsData)
        if (masterDistributorsData) setMasterDistributors(masterDistributorsData)
      } else {
        const { data, error } = await supabase
          .from('master_distributors')
          .select('*')
          .order('created_at', { ascending: false })
        if (error) throw error
        setMasterDistributors(data || [])
      }
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return

    try {
      const tableName = activeTab === 'retailers' ? 'retailers' : 
                       activeTab === 'distributors' ? 'distributors' : 
                       activeTab === 'pos-machines' ? 'pos_machines' :
                       'master_distributors'
      
      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq('id', id)

      if (error) throw error
      fetchData()
      setSelectedItems(new Set())
    } catch (error) {
      console.error('Error deleting:', error)
      alert('Failed to delete item')
    }
  }

  const handleBulkDelete = async () => {
    if (selectedItems.size === 0) return
    if (!confirm(`Are you sure you want to delete ${selectedItems.size} item(s)?`)) return

    try {
      const tableName = activeTab === 'retailers' ? 'retailers' : 
                       activeTab === 'distributors' ? 'distributors' : 
                       activeTab === 'pos-machines' ? 'pos_machines' :
                       'master_distributors'
      
      const { error } = await supabase
        .from(tableName)
        .delete()
        .in('id', Array.from(selectedItems))

      if (error) throw error
      fetchData()
      setSelectedItems(new Set())
    } catch (error) {
      console.error('Error deleting:', error)
      alert('Failed to delete items')
    }
  }

  const getCurrentData = () => {
    if (activeTab === 'retailers') return retailers
    if (activeTab === 'distributors') return distributors
    if (activeTab === 'pos-machines') return posMachines
    if (activeTab === 'master-distributors') return masterDistributors
    return []
  }

  const filteredAndSortedData = useMemo(() => {
    const currentData = getCurrentData()
    let data = currentData.filter((item: any) => {
      const matchesSearch = 
        item.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.partner_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.phone?.includes(searchTerm)
      
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter
      
      return matchesSearch && matchesStatus
    })

    // Sort data
    data.sort((a: any, b: any) => {
      let aVal = a[sortField]
      let bVal = b[sortField]
      
      if (sortField === 'created_at') {
        aVal = new Date(aVal).getTime()
        bVal = new Date(bVal).getTime()
      } else {
        aVal = aVal?.toString().toLowerCase() || ''
        bVal = bVal?.toString().toLowerCase() || ''
      }

      if (sortDirection === 'asc') {
        return aVal > bVal ? 1 : -1
      } else {
        return aVal < bVal ? 1 : -1
      }
    })

    return data
  }, [retailers, distributors, masterDistributors, searchTerm, statusFilter, sortField, sortDirection, activeTab])

  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage
    const end = start + itemsPerPage
    return filteredAndSortedData.slice(start, end)
  }, [filteredAndSortedData, currentPage, itemsPerPage])

  const totalPages = Math.ceil(filteredAndSortedData.length / itemsPerPage)

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const handleExport = (format: 'csv' | 'json') => {
    const data = filteredAndSortedData.map((item: any) => ({
      'Partner ID': item.partner_id,
      'Name': item.name,
      'Email': item.email,
      'Phone': item.phone,
      'Status': item.status,
      'Commission Rate': item.commission_rate || 'N/A',
      'Business Name': item.business_name || '',
      'City': item.city || '',
      'State': item.state || '',
      'Created At': item.created_at,
    }))

    if (format === 'csv') {
      const headers = Object.keys(data[0] || {})
      const csv = [
        headers.join(','),
        ...data.map(row => headers.map(header => `"${row[header as keyof typeof row]}"`).join(','))
      ].join('\n')
      
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${activeTab}-${new Date().toISOString().split('T')[0]}.csv`
      a.click()
    } else {
      const json = JSON.stringify(data, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${activeTab}-${new Date().toISOString().split('T')[0]}.json`
      a.click()
    }
  }

  const stats = useMemo(() => {
    const data = getCurrentData()
    return {
      total: data.length,
      active: data.filter((item: any) => item.status === 'active').length,
      inactive: data.filter((item: any) => item.status === 'inactive').length,
      suspended: data.filter((item: any) => item.status === 'suspended').length,
    }
  }, [activeTab, retailers, distributors, masterDistributors, posMachines])

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 overflow-x-hidden">
      <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      
      <div className="flex-1 lg:ml-56 min-w-0 overflow-x-hidden pt-16 md:pt-16">
        {/* Mobile Menu Button */}
        <button
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden fixed top-20 left-2 md:left-4 z-30 p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700"
        >
          <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
        </button>

        <div className="p-2 sm:p-3 md:p-4 lg:p-5 max-w-full h-[calc(100vh-4rem)] overflow-y-auto overflow-x-hidden">
          {/* Page Header - Compact */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                  <h1 className="text-xl sm:text-2xl md:text-3xl font-bold bg-gradient-to-r from-primary-600 to-secondary-600 bg-clip-text text-transparent">
                    Admin Dashboard
                  </h1>
                  <div className="hidden md:flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-3 py-1 rounded-full">
                    <Crown className="w-3 h-3" />
                    <span>→</span>
                    <Package className="w-3 h-3" />
                    <span>→</span>
                    <Users className="w-3 h-3" />
                  </div>
                </div>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                  Manage retailers, distributors, and master distributors
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={fetchData}
                  className="p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  title="Refresh"
                >
                  <RefreshCw className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                </button>
              </div>
            </div>
          </motion.div>

          {/* Stats Cards - Compact */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 mb-3 sm:mb-4 w-full"
          >
            <StatCard
              label="Total"
              value={stats.total}
              icon={Users}
              gradient="from-blue-500 to-blue-600"
              delay={0}
            />
            <StatCard
              label="Active"
              value={stats.active}
              icon={Check}
              gradient="from-green-500 to-green-600"
              delay={0.1}
            />
            <StatCard
              label="Inactive"
              value={stats.inactive}
              icon={AlertCircle}
              gradient="from-yellow-500 to-yellow-600"
              delay={0.2}
            />
            <StatCard
              label="Suspended"
              value={stats.suspended}
              icon={X}
              gradient="from-red-500 to-red-600"
              delay={0.3}
            />
          </motion.div>

          {/* Tabs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 mb-6 overflow-hidden"
          >
            <div className="flex space-x-1 border-b border-gray-200 dark:border-gray-700 p-1 overflow-x-auto scrollbar-hide">
              {[
                { id: 'retailers' as TabType, label: 'Retailers', icon: Users },
                { id: 'distributors' as TabType, label: 'Distributors', icon: Package },
                { id: 'master-distributors' as TabType, label: 'Master Distributors', icon: Crown },
                { id: 'pos-machines' as TabType, label: 'POS Machines', icon: CreditCard },
                { id: 'services' as TabType, label: 'Services', icon: Activity },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id)
                    setCurrentPage(1)
                    setSelectedItems(new Set())
                    setSearchTerm('')
                    setStatusFilter('all')
                    // Update URL without page reload
                    router.push(`/admin?tab=${tab.id}`, { scroll: false })
                  }}
                  className={`relative flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 md:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium transition-all duration-200 rounded-lg whitespace-nowrap flex-shrink-0 ${
                    activeTab === tab.id
                      ? 'bg-gradient-to-r from-primary-500 to-secondary-500 text-white shadow-md'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <tab.icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span className="hidden min-[375px]:inline">{tab.label}</span>
                  <span className="min-[375px]:hidden">{tab.label.split(' ')[0]}</span>
                </button>
              ))}
            </div>
          </motion.div>

          {/* Conditional Content Based on Tab */}
          {activeTab === 'services' ? (
            <ServicesManagementTab />
          ) : activeTab === 'pos-machines' ? (
            <POSMachinesTab
              retailers={retailers}
              distributors={distributors}
              masterDistributors={masterDistributors}
              posMachines={posMachines}
              onRefresh={fetchData}
              onAdd={() => setShowModal(true)}
              onEdit={(item) => {
                setEditingItem(item)
                setShowModal(true)
              }}
              onDelete={handleDelete}
            />
          ) : (
            <>
          {/* Filters & Actions - Compact */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-3 mb-3"
          >
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              <div className="flex-1 relative min-w-0">
                <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  type="text"
                  placeholder="Search by name, email, partner ID, or phone..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value)
                    setCurrentPage(1)
                  }}
                  className="w-full pl-9 pr-3 py-2 sm:py-1.5 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:text-white"
                />
              </div>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setShowModal(true)}
                  className="btn-primary flex items-center gap-1.5 sm:gap-2 whitespace-nowrap text-xs sm:text-sm px-3 sm:px-4 py-2 flex-1 sm:flex-none"
                >
                  <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  <span className="hidden md:inline">
                    Add {
                      activeTab === 'retailers' ? 'Retailer' : 
                      activeTab === 'distributors' ? 'Distributor' : 
                      'Master Distributor'
                    }
                  </span>
                  <span className="hidden sm:inline md:hidden">Add</span>
                  <span className="sm:hidden">Add</span>
                </button>
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value as any)
                    setCurrentPage(1)
                  }}
                  className="px-2 sm:px-3 py-2 sm:py-1.5 text-xs sm:text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:text-white flex-1 sm:flex-none min-w-[120px]"
                >
                  <option value="all">All Status</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="suspended">Suspended</option>
                </select>
                <div className="relative group">
                  <button className="px-2 sm:px-3 py-2 sm:py-1.5 text-xs sm:text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-1.5">
                    <Download className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Export</span>
                  </button>
                  <div className="absolute right-0 mt-2 w-40 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10">
                    <button
                      onClick={() => handleExport('csv')}
                      className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
                    >
                      <FileSpreadsheet className="w-4 h-4" />
                      Export CSV
                    </button>
                    <button
                      onClick={() => handleExport('json')}
                      className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
                    >
                      <FileText className="w-4 h-4" />
                      Export JSON
                    </button>
                  </div>
                </div>
                {selectedItems.size > 0 && (
                  <button
                    onClick={handleBulkDelete}
                    className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete ({selectedItems.size})
                  </button>
                )}
              </div>
            </div>
          </motion.div>

          {/* Table - Compact */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden"
          >
            <div className="overflow-x-auto max-w-full -mx-2 sm:mx-0">
              <table className="w-full min-w-[600px] sm:min-w-[800px]">
                <thead className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-700 dark:to-gray-800 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="px-3 py-2 text-left">
                      <input
                        type="checkbox"
                        checked={selectedItems.size === paginatedData.length && paginatedData.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedItems(new Set(paginatedData.map((item: any) => item.id)))
                          } else {
                            setSelectedItems(new Set())
                          }
                        }}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                    </th>
                    <th className="px-2 sm:px-3 py-2 text-left text-[10px] sm:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                        onClick={() => handleSort('partner_id')}
                    >
                      <div className="flex items-center gap-1">
                        <span className="hidden sm:inline">Partner ID</span>
                        <span className="sm:hidden">ID</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </th>
                    <th className="px-2 sm:px-3 py-2 text-left text-[10px] sm:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                        onClick={() => handleSort('name')}
                    >
                      <div className="flex items-center gap-1">
                        Name
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </th>
                    <th className="px-2 sm:px-3 py-2 text-left text-[10px] sm:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 hidden md:table-cell"
                        onClick={() => handleSort('email')}
                    >
                      <div className="flex items-center gap-1">
                        Email
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </th>
                    <th className="px-2 sm:px-3 py-2 text-left text-[10px] sm:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden lg:table-cell">Phone</th>
                    <th className="px-2 sm:px-3 py-2 text-left text-[10px] sm:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
                        onClick={() => handleSort('status')}
                    >
                      <div className="flex items-center gap-1">
                        Status
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    </th>
                    <th className="px-2 sm:px-3 py-2 text-left text-[10px] sm:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden xl:table-cell">Commission</th>
                    <th className="px-2 sm:px-3 py-2 text-left text-[10px] sm:text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {paginatedData.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-2 sm:px-4 py-6 sm:py-8 text-center">
                        <div className="flex flex-col items-center">
                          <Users className="w-8 h-8 sm:w-10 sm:h-10 text-gray-400 mb-2" />
                          <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">No {activeTab} found</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    paginatedData.map((item: any, idx: number) => (
                      <motion.tr
                        key={item.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={selectedItems.has(item.id)}
                            onChange={(e) => {
                              const newSelected = new Set(selectedItems)
                              if (e.target.checked) {
                                newSelected.add(item.id)
                              } else {
                                newSelected.delete(item.id)
                              }
                              setSelectedItems(newSelected)
                            }}
                            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                        </td>
                        <td className="px-2 sm:px-3 py-2 whitespace-nowrap">
                          <span className="text-[10px] sm:text-xs font-medium text-gray-900 dark:text-white">{item.partner_id}</span>
                        </td>
                        <td className="px-2 sm:px-3 py-2 whitespace-nowrap min-w-[120px]">
                          <div className="text-[10px] sm:text-xs font-medium text-gray-900 dark:text-white truncate">{item.name}</div>
                          {item.business_name && (
                            <div className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 truncate">{item.business_name}</div>
                          )}
                        </td>
                        <td className="px-2 sm:px-3 py-2 whitespace-nowrap text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 hidden md:table-cell">{item.email}</td>
                        <td className="px-2 sm:px-3 py-2 whitespace-nowrap text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 hidden lg:table-cell">{item.phone}</td>
                        <td className="px-2 sm:px-3 py-2 whitespace-nowrap">
                          <span className={`px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs font-semibold rounded-full ${
                            item.status === 'active' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                            item.status === 'inactive' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                            'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                          }`}>
                            {item.status}
                          </span>
                        </td>
                        <td className="px-2 sm:px-3 py-2 whitespace-nowrap text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 hidden xl:table-cell">
                          {item.commission_rate ? `${item.commission_rate}%` : 'N/A'}
                        </td>
                        <td className="px-2 sm:px-3 py-2 whitespace-nowrap text-xs font-medium">
                          <div className="flex items-center gap-0.5 sm:gap-1">
                            <button
                              onClick={() => {
                                setEditingItem(item)
                                setShowModal(true)
                              }}
                              className="p-1 sm:p-1.5 text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded transition-colors"
                              title="Edit"
                            >
                              <Edit className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(item.id)}
                              className="p-1 sm:p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                            </button>
                          </div>
                        </td>
                      </motion.tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination - Compact */}
            {totalPages > 1 && (
              <div className="px-2 sm:px-3 py-2 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row items-center justify-between gap-2">
                <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start">
                  <span className="text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">Items per page:</span>
                  <select
                    value={itemsPerPage}
                    onChange={(e) => {
                      setItemsPerPage(Number(e.target.value))
                      setCurrentPage(1)
                    }}
                    className="px-2 py-1 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-xs"
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start">
                  <span className="text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">
                    <span className="hidden sm:inline">Page {currentPage} of {totalPages} ({filteredAndSortedData.length} total)</span>
                    <span className="sm:hidden">{currentPage}/{totalPages}</span>
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="p-1.5 rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="p-1.5 rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
          </>
          )}
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        activeTab === 'pos-machines' ? (
          <POSMachineModal
            item={editingItem as POSMachine | null}
            retailers={retailers}
            distributors={distributors}
            masterDistributors={masterDistributors}
            onClose={() => {
              setShowModal(false)
              setEditingItem(null)
            }}
            onSuccess={() => {
              setShowModal(false)
              setEditingItem(null)
              fetchData()
            }}
          />
        ) : (
          <PartnerModal
            type={activeTab}
            item={editingItem}
            onClose={() => {
              setShowModal(false)
              setEditingItem(null)
            }}
            onSuccess={() => {
              setShowModal(false)
              setEditingItem(null)
              fetchData()
            }}
          />
        )
      )}
    </div>
  )
}

// Services Management Component
function ServicesManagementTab() {
  const services = [
    { id: 'banking-payments', name: 'Banking & Payments', icon: '🏦', status: 'active', transactions: 1250, revenue: '₹45,000' },
    { id: 'mini-atm', name: 'Mini-ATM, POS & WPOS', icon: '🏧', status: 'active', transactions: 890, revenue: '₹32,500' },
    { id: 'aeps', name: 'AEPS Services', icon: '👆', status: 'active', transactions: 2100, revenue: '₹78,000' },
    { id: 'merchant-payments', name: 'Aadhaar Pay', icon: '💳', status: 'active', transactions: 1560, revenue: '₹58,200' },
    { id: 'dmt', name: 'Domestic Money Transfer', icon: '💸', status: 'active', transactions: 3200, revenue: '₹125,000' },
    { id: 'bill-payments', name: 'Utility Bill Payments', icon: '📄', status: 'active', transactions: 4500, revenue: '₹95,000' },
    { id: 'recharge', name: 'Mobile Recharge', icon: '📱', status: 'active', transactions: 6800, revenue: '₹145,000' },
    { id: 'travel', name: 'Travel Services', icon: '✈️', status: 'active', transactions: 320, revenue: '₹28,500' },
    { id: 'cash-management', name: 'Cash Management', icon: '💰', status: 'active', transactions: 580, revenue: '₹42,000' },
    { id: 'lic-payment', name: 'LIC Bill Payment', icon: '🛡️', status: 'active', transactions: 750, revenue: '₹35,000' },
    { id: 'insurance', name: 'Insurance', icon: '🏥', status: 'active', transactions: 420, revenue: '₹52,000' },
  ]

  return (
    <div className="space-y-3">
      {/* Services Grid */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3"
      >
        {services.map((service, idx) => (
          <motion.div
            key={service.id}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: idx * 0.05 }}
            className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4 hover:shadow-lg transition-shadow"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="text-3xl">{service.icon}</div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">{service.name}</h3>
                  <span className={`inline-block mt-1 px-2 py-0.5 text-xs rounded-full ${
                    service.status === 'active' 
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' 
                      : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                  }`}>
                    {service.status}
                  </span>
                </div>
              </div>
            </div>
            <div className="space-y-2 pt-3 border-t border-gray-200 dark:border-gray-700">
              <div className="flex justify-between text-xs">
                <span className="text-gray-600 dark:text-gray-400">Transactions</span>
                <span className="font-semibold text-gray-900 dark:text-white">{service.transactions.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-600 dark:text-gray-400">Revenue</span>
                <span className="font-semibold text-green-600 dark:text-green-400">{service.revenue}</span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 flex gap-2">
              <button className="flex-1 px-2 py-1.5 text-xs bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 rounded hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors">
                Manage
              </button>
              <button className="px-2 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                <Settings className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* Service Statistics Summary */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-3 sm:p-4"
      >
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Service Overview</h3>
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Total Services</p>
            <p className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">{services.length}</p>
          </div>
          <div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Active Services</p>
            <p className="text-lg sm:text-xl font-bold text-green-600 dark:text-green-400">{services.filter(s => s.status === 'active').length}</p>
          </div>
          <div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Total Transactions</p>
            <p className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">{services.reduce((sum, s) => sum + s.transactions, 0).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Total Revenue</p>
            <p className="text-lg sm:text-xl font-bold text-green-600 dark:text-green-400">₹6.8L</p>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

function StatCard({ label, value, icon: Icon, gradient, delay }: { 
  label: string
  value: number
  icon: any
  gradient: string
  delay: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay }}
      className={`relative overflow-hidden rounded-lg bg-gradient-to-br ${gradient} text-white p-3 sm:p-4 shadow-md hover:shadow-lg transition-shadow`}
    >
      <div className="relative z-10 flex items-center justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-white/80 text-[10px] sm:text-xs font-medium mb-0.5 truncate">{label}</p>
          <p className="text-lg sm:text-xl md:text-2xl font-bold truncate">{value}</p>
        </div>
        <div className="p-1.5 sm:p-2 bg-white/20 rounded-lg backdrop-blur-sm flex-shrink-0 ml-2">
          <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
        </div>
      </div>
      <div className="absolute -bottom-3 -right-3 w-16 h-16 bg-white/10 rounded-full blur-xl"></div>
    </motion.div>
  )
}

function PartnerModal({ 
  type, 
  item, 
  onClose, 
  onSuccess 
}: { 
  type: TabType
  item: any
  onClose: () => void
  onSuccess: () => void
}) {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    business_name: '',
    address: '',
    city: '',
    state: '',
    pincode: '',
    gst_number: '',
    distributor_id: '',
    master_distributor_id: '',
    status: 'active' as 'active' | 'inactive' | 'suspended',
    commission_rate: '',
  })
  const [loading, setLoading] = useState(false)
  const [masterDistributors, setMasterDistributors] = useState<any[]>([])
  const [distributors, setDistributors] = useState<any[]>([])
  const [loadingParents, setLoadingParents] = useState(false)

  // Fetch parent entities based on type
  useEffect(() => {
    const fetchParents = async () => {
      setLoadingParents(true)
      try {
        if (type === 'distributors' || type === 'retailers') {
          // Fetch active master distributors
          const { data, error } = await supabase
            .from('master_distributors')
            .select('id, partner_id, name, email, status')
            .eq('status', 'active')
            .order('name', { ascending: true })
          
          if (error) throw error
          setMasterDistributors(data || [])
        }

        if (type === 'retailers') {
          // Fetch active distributors
          const { data, error } = await supabase
            .from('distributors')
            .select('id, partner_id, name, email, status, master_distributor_id')
            .eq('status', 'active')
            .order('name', { ascending: true })
          
          if (error) throw error
          setDistributors(data || [])
        }
      } catch (error) {
        console.error('Error fetching parent entities:', error)
      } finally {
        setLoadingParents(false)
      }
    }

    fetchParents()
  }, [type])

  // Update distributors when master distributor changes for retailers
  useEffect(() => {
    if (type === 'retailers' && formData.master_distributor_id) {
      const filtered = distributors.filter(
        (d: any) => d.master_distributor_id === formData.master_distributor_id
      )
      // If distributor was selected but doesn't match master, clear it
      if (formData.distributor_id && !filtered.find((d: any) => d.partner_id === formData.distributor_id)) {
        setFormData(prev => ({ ...prev, distributor_id: '' }))
      }
    }
  }, [formData.master_distributor_id, type, distributors])

  useEffect(() => {
    if (item) {
      setFormData({
        name: item.name || '',
        email: item.email || '',
        phone: item.phone || '',
        password: '',
        business_name: item.business_name || '',
        address: item.address || '',
        city: item.city || '',
        state: item.state || '',
        pincode: item.pincode || '',
        gst_number: item.gst_number || '',
        distributor_id: item.distributor_id || '',
        master_distributor_id: item.master_distributor_id || '',
        status: item.status || 'active',
        commission_rate: item.commission_rate?.toString() || '',
      })
    } else {
      // Reset form when creating new
      setFormData({
        name: '',
        email: '',
        phone: '',
        password: '',
        business_name: '',
        address: '',
        city: '',
        state: '',
        pincode: '',
        gst_number: '',
        distributor_id: '',
        master_distributor_id: '',
        status: 'active',
        commission_rate: '',
      })
    }
  }, [item])

  const generatePartnerId = () => {
    const prefix = type === 'retailers' ? 'RET' : type === 'distributors' ? 'DIS' : 'MD'
    return `${prefix}${Date.now().toString().slice(-8)}`
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validate hierarchy requirements
    if (!item) { // Only validate on create, not edit
      if (type === 'distributors' && !formData.master_distributor_id) {
        alert('Master Distributor is required to create a Distributor')
        return
      }
      if (type === 'retailers') {
        if (!formData.distributor_id) {
          alert('Distributor is required to create a Retailer')
          return
        }
        if (!formData.master_distributor_id) {
          alert('Master Distributor is required to create a Retailer')
          return
        }
        // Validate that distributor belongs to selected master distributor
        const selectedDistributor = distributors.find((d: any) => d.partner_id === formData.distributor_id)
        if (selectedDistributor && selectedDistributor.master_distributor_id !== formData.master_distributor_id) {
          alert('Selected Distributor does not belong to the selected Master Distributor')
          return
        }
      }
    }

    setLoading(true)

    try {
      const tableName = type === 'retailers' ? 'retailers' : 
                       type === 'distributors' ? 'distributors' : 
                       'master_distributors'

      const partnerData: any = {
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        business_name: formData.business_name || null,
        address: formData.address || null,
        city: formData.city || null,
        state: formData.state || null,
        pincode: formData.pincode || null,
        gst_number: formData.gst_number || null,
        status: formData.status,
        commission_rate: formData.commission_rate ? parseFloat(formData.commission_rate) : null,
      }

      if (type === 'retailers') {
        if (!formData.distributor_id) {
          throw new Error('Distributor is required for Retailers')
        }
        partnerData.distributor_id = formData.distributor_id
        partnerData.master_distributor_id = formData.master_distributor_id || null
      } else if (type === 'distributors') {
        if (!item && !formData.master_distributor_id) {
          throw new Error('Master Distributor is required for Distributors')
        }
        partnerData.master_distributor_id = formData.master_distributor_id || null
      }

      if (item) {
        const { error } = await supabase
          .from(tableName)
          .update(partnerData)
          .eq('id', item.id)

        if (error) throw error
      } else {
        partnerData.partner_id = generatePartnerId()
        
        if (formData.password) {
          const response = await fetch('/api/admin/create-user', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              email: formData.email,
              password: formData.password,
              role: type === 'retailers' ? 'retailer' : type === 'distributors' ? 'distributor' : 'master_distributor',
              tableName,
              userData: partnerData,
            }),
          })

          const result = await response.json()
          if (!response.ok) {
            throw new Error(result.error || 'Failed to create user')
          }
        } else {
          const { error } = await supabase
            .from(tableName)
            .insert([partnerData])

          if (error) throw error
        }
      }

      onSuccess()
    } catch (error: any) {
      console.error('Error saving:', error)
      alert(error.message || 'Failed to save')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white dark:bg-gray-800 rounded-xl max-w-2xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-y-auto shadow-2xl border border-gray-200 dark:border-gray-700"
      >
        <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900 dark:text-white">
              {item ? 'Edit' : 'Add'} {type === 'retailers' ? 'Retailer' : type === 'distributors' ? 'Distributor' : 'Master Distributor'}
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1">
              <X className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-3 sm:space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name *</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email *</label>
              <input
                type="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone *</label>
              <input
                type="tel"
                required
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
            {!item && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password *</label>
                <input
                  type="password"
                  required={!item}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Business Name</label>
              <input
                type="text"
                value={formData.business_name}
                onChange={(e) => setFormData({ ...formData, business_name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status *</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
            {type === 'retailers' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Master Distributor * 
                    <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">(Required)</span>
                  </label>
                  <select
                    required={!item}
                    value={formData.master_distributor_id}
                    onChange={(e) => {
                      setFormData({ 
                        ...formData, 
                        master_distributor_id: e.target.value,
                        distributor_id: '' // Clear distributor when master changes
                      })
                    }}
                    disabled={loadingParents}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="">Select Master Distributor</option>
                    {masterDistributors.map((md: any) => (
                      <option key={md.id} value={md.partner_id}>
                        {md.partner_id} - {md.name} ({md.email})
                      </option>
                    ))}
                  </select>
                  {masterDistributors.length === 0 && !loadingParents && (
                    <p className="text-xs text-red-500 mt-1">No active Master Distributors available. Please create one first.</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Distributor * 
                    <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">(Required)</span>
                  </label>
                  <select
                    required={!item}
                    value={formData.distributor_id}
                    onChange={(e) => {
                      const selectedDist = distributors.find((d: any) => d.partner_id === e.target.value)
                      setFormData({ 
                        ...formData, 
                        distributor_id: e.target.value,
                        master_distributor_id: selectedDist?.master_distributor_id || formData.master_distributor_id
                      })
                    }}
                    disabled={loadingParents || !formData.master_distributor_id}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="">Select Distributor</option>
                    {distributors
                      .filter((d: any) => !formData.master_distributor_id || d.master_distributor_id === formData.master_distributor_id)
                      .map((d: any) => (
                        <option key={d.id} value={d.partner_id}>
                          {d.partner_id} - {d.name} ({d.email})
                        </option>
                      ))}
                  </select>
                  {!formData.master_distributor_id && (
                    <p className="text-xs text-amber-500 mt-1">Please select a Master Distributor first</p>
                  )}
                  {formData.master_distributor_id && distributors.filter((d: any) => d.master_distributor_id === formData.master_distributor_id).length === 0 && !loadingParents && (
                    <p className="text-xs text-red-500 mt-1">No active Distributors available for this Master Distributor. Please create one first.</p>
                  )}
                </div>
              </>
            )}
            {type === 'distributors' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Master Distributor * 
                  <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">(Required)</span>
                </label>
                <select
                  required={!item}
                  value={formData.master_distributor_id}
                  onChange={(e) => setFormData({ ...formData, master_distributor_id: e.target.value })}
                  disabled={loadingParents}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">Select Master Distributor</option>
                  {masterDistributors.map((md: any) => (
                    <option key={md.id} value={md.partner_id}>
                      {md.partner_id} - {md.name} ({md.email})
                    </option>
                  ))}
                </select>
                {masterDistributors.length === 0 && !loadingParents && (
                  <p className="text-xs text-red-500 mt-1">No active Master Distributors available. Please create one first.</p>
                )}
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Commission Rate (%)</label>
              <input
                type="number"
                step="0.01"
                value={formData.commission_rate}
                onChange={(e) => setFormData({ ...formData, commission_rate: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">GST Number</label>
              <input
                type="text"
                value={formData.gst_number}
                onChange={(e) => setFormData({ ...formData, gst_number: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Address</label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">City</label>
              <input
                type="text"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">State</label>
              <input
                type="text"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Pincode</label>
              <input
                type="text"
                value={formData.pincode}
                onChange={(e) => setFormData({ ...formData, pincode: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row justify-end gap-2 sm:gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 order-2 sm:order-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary order-1 sm:order-2"
            >
              {loading ? 'Saving...' : item ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}

// POS Machines Management Component
function POSMachinesTab({
  retailers,
  distributors,
  masterDistributors,
  posMachines,
  onRefresh,
  onAdd,
  onEdit,
  onDelete,
}: {
  retailers: Retailer[]
  distributors: Distributor[]
  masterDistributors: MasterDistributor[]
  posMachines: POSMachine[]
  onRefresh: () => void
  onAdd: () => void
  onEdit: (item: POSMachine) => void
  onDelete: (id: string) => void
}) {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [sortField, setSortField] = useState<keyof POSMachine>('created_at')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())

  const filteredMachines = useMemo(() => {
    let filtered = posMachines.filter((machine) => {
      const matchesSearch = 
        machine.machine_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        machine.serial_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        machine.retailer_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        retailers.find(r => r.partner_id === machine.retailer_id)?.name.toLowerCase().includes(searchTerm.toLowerCase())
      
      const matchesStatus = statusFilter === 'all' || machine.status === statusFilter
      const matchesType = typeFilter === 'all' || machine.machine_type === typeFilter
      
      return matchesSearch && matchesStatus && matchesType
    })

    // Sort
    filtered.sort((a, b) => {
      let aVal: any = a[sortField]
      let bVal: any = b[sortField]
      
      if (sortField === 'created_at' || sortField === 'delivery_date' || sortField === 'installation_date') {
        aVal = new Date(aVal as string).getTime()
        bVal = new Date(bVal as string).getTime()
      } else {
        aVal = aVal?.toString().toLowerCase() || ''
        bVal = bVal?.toString().toLowerCase() || ''
      }

      if (sortDirection === 'asc') {
        return aVal < bVal ? -1 : 1
      } else {
        return aVal < bVal ? 1 : -1
      }
    })

    return filtered
  }, [posMachines, searchTerm, statusFilter, typeFilter, sortField, sortDirection, retailers])

  const getRetailerName = (retailerId: string) => {
    const retailer = retailers.find(r => r.partner_id === retailerId)
    return retailer?.name || retailerId
  }

  const getDistributorName = (distributorId?: string) => {
    if (!distributorId) return '-'
    const distributor = distributors.find(d => d.partner_id === distributorId)
    return distributor?.name || distributorId
  }

  const getMasterDistributorName = (masterDistributorId?: string) => {
    if (!masterDistributorId) return '-'
    const masterDistributor = masterDistributors.find(md => md.partner_id === masterDistributorId)
    return masterDistributor?.name || masterDistributorId
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
      case 'inactive': return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
      case 'maintenance': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
      case 'damaged': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
      case 'returned': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'POS': return '💳'
      case 'WPOS': return '📱'
      case 'Mini-ATM': return '🏧'
      default: return '💳'
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="space-y-4"
    >
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search machines..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
            />
          </div>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="maintenance">Maintenance</option>
          <option value="damaged">Damaged</option>
          <option value="returned">Returned</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
        >
          <option value="all">All Types</option>
          <option value="POS">POS</option>
          <option value="WPOS">WPOS</option>
          <option value="Mini-ATM">Mini-ATM</option>
        </select>
        <button
          onClick={onAdd}
          className="btn-primary flex items-center gap-2 text-sm px-4 py-1.5 whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          Add POS Machine
        </button>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead className="bg-gray-50 dark:bg-gray-900">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={selectedItems.size === filteredMachines.length && filteredMachines.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedItems(new Set(filteredMachines.map(m => m.id)))
                      } else {
                        setSelectedItems(new Set())
                      }
                    }}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 cursor-pointer" onClick={() => {
                  setSortField('machine_id')
                  setSortDirection(sortField === 'machine_id' && sortDirection === 'asc' ? 'desc' : 'asc')
                }}>
                  Machine ID <ArrowUpDown className="w-3 h-3 inline" />
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Type</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Retailer</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Distributor</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Master Distributor</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Status</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Delivery Date</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Location</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredMachines.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                    No POS machines found
                  </td>
                </tr>
              ) : (
                filteredMachines.map((machine) => (
                  <tr key={machine.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedItems.has(machine.id)}
                        onChange={(e) => {
                          const newSelected = new Set(selectedItems)
                          if (e.target.checked) {
                            newSelected.add(machine.id)
                          } else {
                            newSelected.delete(machine.id)
                          }
                          setSelectedItems(newSelected)
                        }}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                    </td>
                    <td className="px-3 py-2 text-sm font-medium text-gray-900 dark:text-white">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{getTypeIcon(machine.machine_type)}</span>
                        <div>
                          <div>{machine.machine_id}</div>
                          {machine.serial_number && (
                            <div className="text-xs text-gray-500 dark:text-gray-400">SN: {machine.serial_number}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{machine.machine_type}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{getRetailerName(machine.retailer_id)}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{getDistributorName(machine.distributor_id)}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{getMasterDistributorName(machine.master_distributor_id)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(machine.status)}`}>
                        {machine.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
                      {machine.delivery_date ? new Date(machine.delivery_date).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
                      {machine.location ? (
                        <div className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          <span>{machine.location}</span>
                        </div>
                      ) : '-'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => onEdit(machine)}
                          className="p-1.5 text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded transition-colors"
                          title="Edit"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onDelete(machine.id)}
                          className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {selectedItems.size > 0 && (
          <div className="px-3 py-2 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {selectedItems.size} selected
            </span>
            <button
              onClick={async () => {
                if (confirm(`Delete ${selectedItems.size} machine(s)?`)) {
                  for (const id of Array.from(selectedItems)) {
                    await onDelete(id)
                  }
                  setSelectedItems(new Set())
                  onRefresh()
                }
              }}
              className="text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            >
              Delete Selected
            </button>
          </div>
        )}
      </div>
    </motion.div>
  )
}

// POS Machine Modal Component
function POSMachineModal({
  item,
  retailers,
  distributors,
  masterDistributors,
  onClose,
  onSuccess,
}: {
  item: POSMachine | null
  retailers: Retailer[]
  distributors: Distributor[]
  masterDistributors: MasterDistributor[]
  onClose: () => void
  onSuccess: () => void
}) {
  const [formData, setFormData] = useState({
    machine_id: '',
    serial_number: '',
    retailer_id: '',
    distributor_id: '',
    master_distributor_id: '',
    machine_type: 'POS' as 'POS' | 'WPOS' | 'Mini-ATM',
    status: 'active' as 'active' | 'inactive' | 'maintenance' | 'damaged' | 'returned',
    delivery_date: '',
    installation_date: '',
    location: '',
    city: '',
    state: '',
    pincode: '',
    notes: '',
  })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (item) {
      setFormData({
        machine_id: item.machine_id || '',
        serial_number: item.serial_number || '',
        retailer_id: item.retailer_id || '',
        distributor_id: item.distributor_id || '',
        master_distributor_id: item.master_distributor_id || '',
        machine_type: item.machine_type || 'POS',
        status: item.status || 'active',
        delivery_date: item.delivery_date ? new Date(item.delivery_date).toISOString().split('T')[0] : '',
        installation_date: item.installation_date ? new Date(item.installation_date).toISOString().split('T')[0] : '',
        location: item.location || '',
        city: item.city || '',
        state: item.state || '',
        pincode: item.pincode || '',
        notes: item.notes || '',
      })
    } else {
      // Generate machine ID for new machines
      const prefix = formData.machine_type === 'POS' ? 'POS' : formData.machine_type === 'WPOS' ? 'WPOS' : 'MATM'
      setFormData(prev => ({
        ...prev,
        machine_id: `${prefix}${Date.now().toString().slice(-8)}`
      }))
    }
  }, [item])

  // Update distributor and master distributor when retailer is selected
  useEffect(() => {
    if (formData.retailer_id) {
      const retailer = retailers.find(r => r.partner_id === formData.retailer_id)
      if (retailer) {
        setFormData(prev => ({
          ...prev,
          distributor_id: retailer.distributor_id || prev.distributor_id,
          master_distributor_id: retailer.master_distributor_id || prev.master_distributor_id,
        }))
      }
    }
  }, [formData.retailer_id, retailers])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.retailer_id) {
      alert('Retailer is required')
      return
    }

    // Validate hierarchy
    const retailer = retailers.find(r => r.partner_id === formData.retailer_id)
    if (!retailer) {
      alert('Invalid retailer selected')
      return
    }

    if (!retailer.distributor_id) {
      alert('Selected retailer must be assigned to a distributor')
      return
    }

    if (!retailer.master_distributor_id) {
      alert('Selected retailer must be assigned to a master distributor')
      return
    }

    setLoading(true)

    try {
      const machineData: any = {
        machine_id: formData.machine_id,
        serial_number: formData.serial_number || null,
        retailer_id: formData.retailer_id,
        distributor_id: retailer.distributor_id,
        master_distributor_id: retailer.master_distributor_id,
        machine_type: formData.machine_type,
        status: formData.status,
        delivery_date: formData.delivery_date || null,
        installation_date: formData.installation_date || null,
        location: formData.location || null,
        city: formData.city || null,
        state: formData.state || null,
        pincode: formData.pincode || null,
        notes: formData.notes || null,
      }

      if (item) {
        const { error } = await supabase
          .from('pos_machines')
          .update(machineData)
          .eq('id', item.id)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from('pos_machines')
          .insert([machineData])

        if (error) throw error
      }

      onSuccess()
    } catch (error: any) {
      console.error('Error saving POS machine:', error)
      alert(error.message || 'Failed to save POS machine')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white dark:bg-gray-800 rounded-xl max-w-2xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-y-auto shadow-2xl border border-gray-200 dark:border-gray-700"
      >
        <div className="p-4 sm:p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900 dark:text-white">
              {item ? 'Edit' : 'Add'} POS Machine
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1">
              <X className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-3 sm:space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Machine ID *</label>
              <input
                type="text"
                required
                value={formData.machine_id}
                onChange={(e) => setFormData({ ...formData, machine_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Serial Number</label>
              <input
                type="text"
                value={formData.serial_number}
                onChange={(e) => setFormData({ ...formData, serial_number: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Machine Type *</label>
              <select
                required
                value={formData.machine_type}
                onChange={(e) => {
                  const newType = e.target.value as 'POS' | 'WPOS' | 'Mini-ATM'
                  const prefix = newType === 'POS' ? 'POS' : newType === 'WPOS' ? 'WPOS' : 'MATM'
                  setFormData({ 
                    ...formData, 
                    machine_type: newType,
                    machine_id: item ? formData.machine_id : `${prefix}${Date.now().toString().slice(-8)}`
                  })
                }}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              >
                <option value="POS">POS</option>
                <option value="WPOS">WPOS</option>
                <option value="Mini-ATM">Mini-ATM</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status *</label>
              <select
                required
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="maintenance">Maintenance</option>
                <option value="damaged">Damaged</option>
                <option value="returned">Returned</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Retailer * <span className="text-xs text-gray-500 dark:text-gray-400">(Required)</span>
              </label>
              <select
                required
                value={formData.retailer_id}
                onChange={(e) => {
                  const retailer = retailers.find(r => r.partner_id === e.target.value)
                  setFormData({ 
                    ...formData, 
                    retailer_id: e.target.value,
                    distributor_id: retailer?.distributor_id || '',
                    master_distributor_id: retailer?.master_distributor_id || ''
                  })
                }}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              >
                <option value="">Select Retailer</option>
                {retailers
                  .filter(r => r.status === 'active')
                  .map((r) => (
                    <option key={r.id} value={r.partner_id}>
                      {r.partner_id} - {r.name} ({r.email})
                    </option>
                  ))}
              </select>
              {retailers.filter(r => r.status === 'active').length === 0 && (
                <p className="text-xs text-red-500 mt-1">No active retailers available. Please create one first.</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Distributor</label>
              <input
                type="text"
                value={formData.distributor_id ? distributors.find(d => d.partner_id === formData.distributor_id)?.name || formData.distributor_id : 'Auto-filled from Retailer'}
                disabled
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Master Distributor</label>
              <input
                type="text"
                value={formData.master_distributor_id ? masterDistributors.find(md => md.partner_id === formData.master_distributor_id)?.name || formData.master_distributor_id : 'Auto-filled from Retailer'}
                disabled
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Delivery Date</label>
              <input
                type="date"
                value={formData.delivery_date}
                onChange={(e) => setFormData({ ...formData, delivery_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Installation Date</label>
              <input
                type="date"
                value={formData.installation_date}
                onChange={(e) => setFormData({ ...formData, installation_date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Location</label>
              <input
                type="text"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">City</label>
              <input
                type="text"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">State</label>
              <input
                type="text"
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Pincode</label>
              <input
                type="text"
                value={formData.pincode}
                onChange={(e) => setFormData({ ...formData, pincode: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row justify-end gap-2 sm:gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 order-2 sm:order-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary order-1 sm:order-2"
            >
              {loading ? 'Saving...' : item ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}

export default function AdminDashboard() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading dashboard...</p>
        </div>
      </div>
    }>
      <AdminDashboardContent />
    </Suspense>
  )
}
