'use client'

import React, { useState, useEffect, useMemo, Suspense } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { Retailer, Distributor, MasterDistributor, POSMachine } from '@/types/database.types'
import AdminSidebar from '@/components/AdminSidebar'
import { 
  Plus, Edit, Trash2, Search, Filter, Download, RotateCcw, 
  Users, Package, Crown, TrendingUp, Activity,
  X, Check, AlertCircle, Menu, ArrowUpDown, 
  ChevronLeft, ChevronRight, FileSpreadsheet, FileText,
  MoreVertical, RefreshCw, Settings, CreditCard, MapPin, Calendar, Receipt,
  ArrowUpCircle, ArrowDownCircle, Wallet, LogIn, Key, Eye, EyeOff, ZoomIn, ZoomOut, RotateCw, Image as ImageIcon,
  Upload, FileSpreadsheet as FileSpreadsheetIcon, LayoutDashboard, UserPlus,
  DollarSign, PiggyBank, ArrowRightLeft, BarChart3, PieChart, LineChart,
  Building2, Briefcase, Phone, Mail, Clock, Percent, IndianRupee,
  FileBarChart, Printer, Sheet, BadgeIndianRupee, Banknote,
  CheckCircle2, AlertTriangle, XCircle, Zap, Globe, Smartphone, FileDown,
  Shield, ShieldCheck, Loader2, CheckCircle, ChevronDown, ChevronUp, Info
} from 'lucide-react'
import TransactionsTable from '@/components/TransactionsTable'
import POSTransactionsTable from '@/components/POSTransactionsTable'
import POSPartnerAPIManagement from '@/components/POSPartnerAPIManagement'
import ServiceTransactionReport from '@/components/ServiceTransactionReport'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api-client'
import { useToast } from '@/components/Toast'
import T1SettlementControl from '@/components/T1SettlementControl'
import PerformanceTab from '@/components/PerformanceTab'
import POSMachineHistoryTab from '@/components/POSMachineHistoryTab'
import POSTrackingReport from '@/components/POSTrackingReport'
import AdminSubscriptionsTab from '@/components/AdminSubscriptionsTab'
import AdminWalletLedgerTab from '@/components/AdminWalletLedgerTab'
import AdminRevenueWalletTab from '@/components/AdminRevenueWalletTab'
import AdminAEPSManagement from '@/components/admin/AdminAEPSManagement'
import PortalManagementTab from '@/components/admin/PortalManagementTab'

type TabType = 'dashboard' | 'retailers' | 'distributors' | 'master-distributors' | 'services' | 'pos-machines' | 'pos-history' | 'pos-tracking-report' | 'transactions' | 'partners' | 'pos-partner-api' | 'reports' | 'settlement' | 'revenue-wallet' | 'performance' | 'subscriptions' | 'wallet-ledger' | 'aeps' | 'portal-management'
type SortField = 'name' | 'email' | 'partner_id' | 'created_at' | 'status'
type SortDirection = 'asc' | 'desc'

function AdminDashboardContent() {
  const { user, loading: authLoading, impersonate } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { showToast } = useToast()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [walletProcessing, setWalletProcessing] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [returningToStock, setReturningToStock] = useState<string | null>(null)
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  
  // Initialize activeTab from URL or default to 'dashboard'
  const getInitialTab = (): TabType => {
    const tab = searchParams?.get('tab')
    if (tab && ['dashboard', 'retailers', 'distributors', 'master-distributors', 'pos-machines', 'pos-history', 'pos-tracking-report', 'pos-partner-api', 'services', 'transactions', 'partners', 'reports', 'settlement', 'revenue-wallet', 'performance', 'subscriptions', 'wallet-ledger', 'aeps', 'portal-management'].includes(tab)) {
      return tab as TabType
    }
    return 'dashboard'
  }
  
  const [activeTab, setActiveTab] = useState<TabType>(getInitialTab())
  const [showModal, setShowModal] = useState(false)
  const [editingItem, setEditingItem] = useState<any>(null)
  const [showWalletModal, setShowWalletModal] = useState(false)
  const [walletAction, setWalletAction] = useState<'push' | 'pull'>('push')
  const [selectedWalletUser, setSelectedWalletUser] = useState<any>(null)
  const [currentBalance, setCurrentBalance] = useState<number | null>(null)
  const [loadingBalance, setLoadingBalance] = useState(false)
  const [walletFormData, setWalletFormData] = useState({
    amount: '',
    fund_category: 'cash' as 'cash' | 'online' | 'aeps',
    wallet_type: 'primary' as 'primary' | 'aeps',
    remarks: ''
  })
  const [showPasswordResetModal, setShowPasswordResetModal] = useState(false)
  const [selectedUserForReset, setSelectedUserForReset] = useState<any>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [resettingPassword, setResettingPassword] = useState(false)
  const [showBBPSLimitModal, setShowBBPSLimitModal] = useState(false)
  const [selectedRetailerForLimit, setSelectedRetailerForLimit] = useState<any>(null)
  const [bbpsLimitTier, setBbpsLimitTier] = useState<49999 | 99999 | 189999>(49999)
  const [updatingLimit, setUpdatingLimit] = useState(false)
  const [showSettlementLimitModal, setShowSettlementLimitModal] = useState(false)
  const [selectedRetailerForSettlementLimit, setSelectedRetailerForSettlementLimit] = useState<any>(null)
  const [settlementLimitTier, setSettlementLimitTier] = useState<100000 | 150000 | 200000>(100000)
  const [updatingSettlementLimit, setUpdatingSettlementLimit] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'suspended'>('all')
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [currentPage, setCurrentPage] = useState(1)
  const [itemsPerPage, setItemsPerPage] = useState(10)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  
  const [retailers, setRetailers] = useState<Retailer[]>([])
  const [distributors, setDistributors] = useState<Distributor[]>([])
  const [masterDistributors, setMasterDistributors] = useState<MasterDistributor[]>([])
  const [partners, setPartners] = useState<any[]>([])
  const [posMachines, setPosMachines] = useState<POSMachine[]>([])
  const [loading, setLoading] = useState(true)

  // Helper to get auth token for API calls (fallback for cookie issues)
  const getAuthToken = async (): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token || null
  }

  // Helper to make authenticated API calls
  const fetchWithAuth = async (url: string, options: RequestInit = {}): Promise<Response> => {
    const token = await getAuthToken()
    const headers = new Headers(options.headers || {})
    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }
    return fetch(url, {
      ...options,
      headers,
      credentials: 'include'
    })
  }

  // Sync activeTab with URL query params
  useEffect(() => {
    const tab = searchParams?.get('tab')
    if (tab && ['dashboard', 'retailers', 'distributors', 'master-distributors', 'pos-machines', 'pos-history', 'pos-tracking-report', 'pos-partner-api', 'services', 'transactions', 'partners', 'reports', 'settlement', 'revenue-wallet', 'performance', 'subscriptions', 'wallet-ledger', 'aeps', 'portal-management'].includes(tab)) {
      if (tab !== activeTab) {
        setActiveTab(tab as TabType)
      }
    } else if (!tab && activeTab !== 'dashboard') {
      // If no tab in URL, default to dashboard
      setActiveTab('dashboard')
    }
  }, [searchParams, activeTab])

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

  // Fetch wallet balance when modal opens or wallet type changes
  const fetchWalletBalance = async (userId: string, walletType: 'primary' | 'aeps' = 'primary') => {
    if (!userId) return
    setLoadingBalance(true)
    try {
      const { data, error } = await supabase.rpc('get_wallet_balance_v2', {
        p_user_id: userId,
        p_wallet_type: walletType
      })
      if (error) throw error
      setCurrentBalance(data || 0)
    } catch (error) {
      console.error('Error fetching wallet balance:', error)
      setCurrentBalance(0)
    } finally {
      setLoadingBalance(false)
    }
  }

  // Fetch balance when modal opens
  useEffect(() => {
    if (showWalletModal && selectedWalletUser) {
      fetchWalletBalance(selectedWalletUser.partner_id, walletFormData.wallet_type)
    }
  }, [showWalletModal, selectedWalletUser])

  const fetchData = async () => {
    if (activeTab === 'services') {
      setLoading(false)
      return
    }
    setLoading(true)
    setRefreshing(true)
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
        // PostgREST applies a max row cap per request (often 1000). Paginate in chunks so
        // client-side table pagination sees the full dataset.
        const chunkSize = 1000
        const allMachines: POSMachine[] = []
        for (let from = 0; ; from += chunkSize) {
          const { data, error } = await supabase
            .from('pos_machines')
            .select('*')
            .order('created_at', { ascending: false })
            .range(from, from + chunkSize - 1)
          if (error) throw error
          const batch = data || []
          allMachines.push(...batch)
          if (batch.length < chunkSize) break
        }
        setPosMachines(allMachines)
        // Also fetch retailers, distributors, master distributors, and partners for dropdowns
        const [{ data: retailersData }, { data: distributorsData }, { data: masterDistributorsData }, { data: partnersData }] = await Promise.all([
          supabase.from('retailers').select('*').order('name'),
          supabase.from('distributors').select('*').order('name'),
          supabase.from('master_distributors').select('*').order('name'),
          supabase.from('partners').select('id, name, email, business_name, status').order('name')
        ])
        if (retailersData) setRetailers(retailersData)
        if (distributorsData) setDistributors(distributorsData)
        if (masterDistributorsData) setMasterDistributors(masterDistributorsData)
        if (partnersData) setPartners(partnersData)
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
      showToast('Failed to fetch data', 'error')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const handleDelete = async (id: string) => {
    let label = id.slice(0, 8)
    if (activeTab === 'pos-machines') {
      const m = posMachines.find((pm) => pm.id === id)
      if (m) label = m.tid ? `TID: ${m.tid}` : m.machine_id
    }
    if (!confirm(`Are you sure you want to delete "${label}"?`)) return

    setDeletingId(id)
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
      showToast('Item deleted successfully', 'success')
      fetchData()
      setSelectedItems(new Set())
    } catch (error) {
      console.error('Error deleting:', error)
      showToast('Failed to delete item', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  const handleReturnToStock = async (machine: POSMachine) => {
    const assigned = ['assigned_to_retailer', 'assigned_to_distributor', 'assigned_to_master_distributor', 'assigned_to_partner'].includes(machine.inventory_status || '')
    if (!assigned) return

    const returnDate = prompt(`Return "${machine.machine_id}" to stock.\n\nEnter return date (YYYY-MM-DD):`, new Date().toISOString().slice(0, 10))
    if (!returnDate) return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) {
      showToast('Invalid date format. Use YYYY-MM-DD.', 'error')
      return
    }
    const returnReason = prompt('Enter return reason (optional):') || ''

    setReturningToStock(machine.id)
    try {
      const res = await apiFetch('/api/admin/pos-machines/return', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machine_id: machine.id,
          return_date: new Date(returnDate + 'T00:00:00').toISOString(),
          return_reason: returnReason.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (data.success) {
        showToast('Machine returned to stock successfully', 'success')
        fetchData()
      } else {
        showToast(data.error || 'Failed to return machine to stock', 'error')
      }
    } catch (e) {
      console.error('Return to stock error:', e)
      showToast('Failed to return machine to stock', 'error')
    } finally {
      setReturningToStock(null)
    }
  }

  const handleBulkDelete = async () => {
    if (selectedItems.size === 0) return
    if (!confirm(`Are you sure you want to delete ${selectedItems.size} item(s)?`)) return

    setBulkDeleting(true)
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
      showToast(`${selectedItems.size} item(s) deleted successfully`, 'success')
      fetchData()
      setSelectedItems(new Set())
    } catch (error) {
      console.error('Error deleting:', error)
      showToast('Failed to delete items', 'error')
    } finally {
      setBulkDeleting(false)
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
                  disabled={refreshing}
                  className="p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                  title="Refresh"
                >
                  <RefreshCw className={`w-4 h-4 text-gray-600 dark:text-gray-300 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>
          </motion.div>

          {/* Conditional Content Based on Tab */}
          {activeTab === 'dashboard' ? (
            <AdminDashboardOverview 
              retailers={retailers}
              distributors={distributors}
              masterDistributors={masterDistributors}
            />
          ) : activeTab === 'transactions' ? (
            <POSTransactionsTable autoPoll={true} pollInterval={10000} />
          ) : activeTab === 'services' ? (
            <ServicesManagementTab />
          ) : activeTab === 'pos-machines' ? (
            <POSMachinesTab
              retailers={retailers}
              distributors={distributors}
              masterDistributors={masterDistributors}
              partners={partners}
              posMachines={posMachines}
              onRefresh={fetchData}
              onAdd={() => setShowModal(true)}
              onEdit={(item) => {
                setEditingItem(item)
                setShowModal(true)
              }}
              onDelete={handleDelete}
              onReturnToStock={handleReturnToStock}
              onBulkDelete={async (ids: string[]) => {
                const tableName = 'pos_machines'
                const { error } = await supabase
                  .from(tableName)
                  .delete()
                  .in('id', ids)
                if (error) {
                  console.error('Bulk delete error:', error)
                  showToast('Failed to delete some machines', 'error')
                } else {
                  showToast('Machines deleted successfully', 'success')
                }
                fetchData()
              }}
              onBulkReturn={async (ids: string[], returnDate?: string, returnReason?: string) => {
                const results: { ok: number; fail: number } = { ok: 0, fail: 0 }
                for (const id of ids) {
                  try {
                    const res = await apiFetch('/api/admin/pos-machines/return', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        machine_id: id,
                        return_date: returnDate || undefined,
                        return_reason: returnReason || undefined,
                      }),
                    })
                    const data = await res.json()
                    if (data.success) results.ok++
                    else results.fail++
                  } catch {
                    results.fail++
                  }
                }
                fetchData()
                return results
              }}
            />
          ) : activeTab === 'pos-history' ? (
            <POSMachineHistoryTab />
          ) : activeTab === 'pos-tracking-report' ? (
            <POSTrackingReport />
          ) : activeTab === 'pos-partner-api' ? (
            <POSPartnerAPIManagement />
          ) : activeTab === 'partners' ? (
            <PartnersTab />
          ) : activeTab === 'reports' ? (
            <ReportsTab />
          ) : activeTab === 'settlement' ? (
            <T1SettlementControl />
          ) : activeTab === 'revenue-wallet' ? (
            <AdminRevenueWalletTab />
          ) : activeTab === 'wallet-ledger' ? (
            <AdminWalletLedgerTab />
          ) : activeTab === 'performance' ? (
            <PerformanceTab />
          ) : activeTab === 'subscriptions' ? (
            <AdminSubscriptionsTab />
          ) : activeTab === 'aeps' ? (
            <AdminAEPSManagement />
          ) : activeTab === 'portal-management' ? (
            <PortalManagementTab />
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
                {/* Only Admin can add Master Distributors - Distributors and Retailers are created by their parent hierarchy */}
                {activeTab === 'master-distributors' && (
                  <button
                    onClick={() => {
                      setEditingItem(null)
                      setShowModal(true)
                    }}
                    className="px-3 py-1.5 bg-gradient-to-r from-amber-500 to-amber-600 text-white text-sm rounded-lg hover:from-amber-600 hover:to-amber-700 flex items-center gap-1.5 shadow-sm"
                  >
                    <Plus className="w-4 h-4" />
                    <span className="hidden sm:inline">Add Master Distributor</span>
                    <span className="sm:hidden">Add</span>
                  </button>
                )}
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

          {/* Info banner for retailers/distributors tabs */}
          {(activeTab === 'retailers' || activeTab === 'distributors') && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg"
            >
              <div className="flex items-center gap-2 text-sm text-blue-800 dark:text-blue-300">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>
                  {activeTab === 'distributors' 
                    ? 'Distributors are created by Master Distributors. You can view, activate, and manage them here.'
                    : 'Retailers are created by Distributors. You can view, activate, and manage them here.'}
                </span>
              </div>
            </motion.div>
          )}

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
                      <React.Fragment key={item.id}>
                      <motion.tr
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${expandedRow === item.id ? 'bg-indigo-50/50 dark:bg-indigo-900/10' : ''}`}
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
                              onClick={async () => {
                                setSelectedWalletUser(item)
                                setWalletAction('push')
                                setWalletFormData({ amount: '', fund_category: 'cash', wallet_type: 'primary', remarks: '' })
                                setShowWalletModal(true)
                                // Balance will be fetched by useEffect when modal opens
                              }}
                              className="p-1 sm:p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded transition-colors"
                              title="Push Balance"
                            >
                              <ArrowUpCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                            </button>
                            <button
                              onClick={async () => {
                                setSelectedWalletUser(item)
                                setWalletAction('pull')
                                setWalletFormData({ amount: '', fund_category: 'cash', wallet_type: 'primary', remarks: '' })
                                setShowWalletModal(true)
                                // Balance will be fetched by useEffect when modal opens
                              }}
                              className="p-1 sm:p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                              title="Pull Balance"
                            >
                              <ArrowDownCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                            </button>
                            <button
                              disabled={impersonatingId === item.partner_id}
                              onClick={async () => {
                                setImpersonatingId(item.partner_id)
                                try {
                                  const userRole = activeTab === 'retailers' ? 'retailer' : 
                                                  activeTab === 'distributors' ? 'distributor' : 
                                                  'master_distributor'
                                  const response = await apiFetch('/api/admin/impersonate', {
                                    method: 'POST',
                                    body: JSON.stringify({ user_id: item.partner_id, user_role: userRole })
                                  })
                                  const data = await response.json()
                                  if (!response.ok) {
                                    throw new Error(data.error || 'Failed to login as user')
                                  }
                                  if (data.success && data.redirect_url) {
                                    if (data.impersonation_token) {
                                      localStorage.setItem('impersonation_token', data.impersonation_token)
                                      localStorage.setItem('impersonation_session_id', data.user.impersonation_session_id || '')
                                    }
                                    sessionStorage.setItem('impersonated_user', JSON.stringify(data.user))
                                    window.open(data.redirect_url, '_blank')
                                  }
                                } catch (error: any) {
                                  showToast(error.message || 'Failed to login as user', 'error')
                                } finally {
                                  setImpersonatingId(null)
                                }
                              }}
                              className="p-1 sm:p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors disabled:opacity-50"
                              title="Login As (Opens in new tab)"
                            >
                              {impersonatingId === item.partner_id ? <Loader2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-spin" /> : <LogIn className="w-3 h-3 sm:w-3.5 sm:h-3.5" />}
                            </button>
                            {activeTab === 'retailers' && (
                              <>
                                <button
                                  onClick={() => {
                                    setSelectedRetailerForLimit(item)
                                    setBbpsLimitTier(item.bbps_limit_tier || 49999)
                                    setShowBBPSLimitModal(true)
                                  }}
                                  className="p-1 sm:p-1.5 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded transition-colors"
                                  title="Set BBPS Limit"
                                >
                                  <TrendingUp className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                                </button>
                                <button
                                  onClick={() => {
                                    setSelectedRetailerForSettlementLimit(item)
                                    setSettlementLimitTier(item.settlement_limit_tier || 100000)
                                    setShowSettlementLimitModal(true)
                                  }}
                                  className="p-1 sm:p-1.5 text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-900/20 rounded transition-colors"
                                  title="Set Settlement Limit"
                                >
                                  <DollarSign className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                                </button>
                              </>
                            )}
                            <button
                              onClick={() => {
                                setSelectedUserForReset(item)
                                setNewPassword('')
                                setConfirmPassword('')
                                setShowPasswordResetModal(true)
                              }}
                              className="p-1 sm:p-1.5 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded transition-colors"
                              title="Reset Password"
                            >
                              <Key className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                            </button>
                            <button
                              onClick={() => setExpandedRow(expandedRow === item.id ? null : item.id)}
                              className={`p-1 sm:p-1.5 ${expandedRow === item.id ? 'text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20' : 'text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-900/20'} rounded transition-colors`}
                              title="View KYC Details"
                            >
                              {expandedRow === item.id ? <ChevronUp className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> : <ChevronDown className="w-3 h-3 sm:w-3.5 sm:h-3.5" />}
                            </button>
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
                              disabled={deletingId === item.id}
                              className="p-1 sm:p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors disabled:opacity-50"
                              title="Delete"
                            >
                              {deletingId === item.id ? <Loader2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-spin" /> : <Trash2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />}
                            </button>
                          </div>
                        </td>
                      </motion.tr>
                      {expandedRow === item.id && (
                        <tr key={`${item.id}-details`}>
                          <td colSpan={8} className="px-0 py-0">
                            <div className="bg-gray-50 dark:bg-gray-900/50 border-t border-b border-gray-200 dark:border-gray-700 p-4 sm:p-6">
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {/* Basic Information */}
                                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                                    <Users className="w-4 h-4 text-blue-500" /> Basic Information
                                  </h4>
                                  <div className="space-y-2 text-xs">
                                    <div className="flex justify-between"><span className="text-gray-500">Partner ID:</span><span className="font-medium text-gray-900 dark:text-white">{item.partner_id}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-500">Business Name:</span><span className="font-medium text-gray-900 dark:text-white">{item.business_name || 'N/A'}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-500">Phone:</span><span className="font-medium text-gray-900 dark:text-white">{item.phone || 'N/A'}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-500">Address:</span><span className="font-medium text-gray-900 dark:text-white text-right max-w-[180px]">{item.address || 'N/A'}</span></div>
                                    {item.city && <div className="flex justify-between"><span className="text-gray-500">City:</span><span className="font-medium text-gray-900 dark:text-white">{item.city}</span></div>}
                                    {item.state && <div className="flex justify-between"><span className="text-gray-500">State:</span><span className="font-medium text-gray-900 dark:text-white">{item.state}</span></div>}
                                    {item.pincode && <div className="flex justify-between"><span className="text-gray-500">Pincode:</span><span className="font-medium text-gray-900 dark:text-white">{item.pincode}</span></div>}
                                    <div className="flex justify-between"><span className="text-gray-500">Commission:</span><span className="font-medium text-gray-900 dark:text-white">{item.commission_rate ? `${item.commission_rate}%` : 'N/A'}</span></div>
                                    {item.auto_verification_score !== undefined && (
                                      <div className="flex justify-between items-center">
                                        <span className="text-gray-500">Verification Score:</span>
                                        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${item.auto_verification_score >= 80 ? 'bg-green-100 text-green-800' : item.auto_verification_score >= 40 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                                          {item.auto_verification_score}/100
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* PAN Verification */}
                                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                                    <CreditCard className="w-4 h-4 text-orange-500" /> PAN Verification
                                    {item.pan_verified ? <span className="ml-auto px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-[10px] font-bold">VERIFIED</span> : <span className="ml-auto px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-[10px] font-bold">NOT VERIFIED</span>}
                                  </h4>
                                  <div className="space-y-2 text-xs">
                                    <div className="flex justify-between"><span className="text-gray-500">PAN Number:</span><span className="font-medium text-gray-900 dark:text-white">{item.pan_number || 'N/A'}</span></div>
                                    {item.pan_registered_name && <div className="flex justify-between"><span className="text-gray-500">Registered Name:</span><span className="font-medium text-gray-900 dark:text-white">{item.pan_registered_name}</span></div>}
                                    {item.pan_type && <div className="flex justify-between"><span className="text-gray-500">PAN Type:</span><span className="font-medium text-gray-900 dark:text-white">{item.pan_type}</span></div>}
                                  </div>
                                </div>

                                {/* Bank Verification */}
                                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                                    <Building2 className="w-4 h-4 text-blue-500" /> Bank Verification
                                    {item.bank_verified ? <span className="ml-auto px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-[10px] font-bold">VERIFIED</span> : <span className="ml-auto px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-[10px] font-bold">NOT VERIFIED</span>}
                                  </h4>
                                  <div className="space-y-2 text-xs">
                                    <div className="flex justify-between"><span className="text-gray-500">Bank Name:</span><span className="font-medium text-gray-900 dark:text-white">{item.bank_name || 'N/A'}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-500">Account No:</span><span className="font-medium text-gray-900 dark:text-white">{item.account_number || 'N/A'}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-500">IFSC:</span><span className="font-medium text-gray-900 dark:text-white">{item.ifsc_code || 'N/A'}</span></div>
                                    {item.bank_verified_name && <div className="flex justify-between"><span className="text-gray-500">Verified Name:</span><span className="font-medium text-gray-900 dark:text-white">{item.bank_verified_name}</span></div>}
                                    {item.bank_utr && <div className="flex justify-between"><span className="text-gray-500">UTR:</span><span className="font-medium text-gray-900 dark:text-white">{item.bank_utr}</span></div>}
                                    {item.bank_branch && <div className="flex justify-between"><span className="text-gray-500">Branch:</span><span className="font-medium text-gray-900 dark:text-white">{item.bank_branch}</span></div>}
                                  </div>
                                </div>

                                {/* GST Verification */}
                                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-green-500" /> GST Verification
                                    {item.gst_verified ? <span className="ml-auto px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-[10px] font-bold">VERIFIED</span> : item.gst_number ? <span className="ml-auto px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-[10px] font-bold">NOT VERIFIED</span> : <span className="ml-auto px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[10px]">N/A</span>}
                                  </h4>
                                  <div className="space-y-2 text-xs">
                                    <div className="flex justify-between"><span className="text-gray-500">GST Number:</span><span className="font-medium text-gray-900 dark:text-white">{item.gst_number || 'N/A'}</span></div>
                                    {item.gst_legal_name && <div className="flex justify-between"><span className="text-gray-500">Legal Name:</span><span className="font-medium text-gray-900 dark:text-white">{item.gst_legal_name}</span></div>}
                                    {item.gst_trade_name && <div className="flex justify-between"><span className="text-gray-500">Trade Name:</span><span className="font-medium text-gray-900 dark:text-white">{item.gst_trade_name}</span></div>}
                                    {item.gst_status && <div className="flex justify-between"><span className="text-gray-500">GST Status:</span><span className={`font-medium ${item.gst_status === 'Active' ? 'text-green-600' : 'text-red-600'}`}>{item.gst_status}</span></div>}
                                    {item.gst_taxpayer_type && <div className="flex justify-between"><span className="text-gray-500">Taxpayer Type:</span><span className="font-medium text-gray-900 dark:text-white">{item.gst_taxpayer_type}</span></div>}
                                    {item.gst_constitution && <div className="flex justify-between"><span className="text-gray-500">Constitution:</span><span className="font-medium text-gray-900 dark:text-white">{item.gst_constitution}</span></div>}
                                    {item.gst_address && <div className="flex justify-between"><span className="text-gray-500">GST Address:</span><span className="font-medium text-gray-900 dark:text-white text-right max-w-[180px]">{item.gst_address}</span></div>}
                                  </div>
                                </div>

                                {/* CIN Verification */}
                                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                                    <Briefcase className="w-4 h-4 text-purple-500" /> CIN Verification
                                    {item.cin_verified ? <span className="ml-auto px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-[10px] font-bold">VERIFIED</span> : item.cin_number ? <span className="ml-auto px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-[10px] font-bold">NOT VERIFIED</span> : <span className="ml-auto px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[10px]">N/A</span>}
                                  </h4>
                                  <div className="space-y-2 text-xs">
                                    <div className="flex justify-between"><span className="text-gray-500">CIN Number:</span><span className="font-medium text-gray-900 dark:text-white">{item.cin_number || 'N/A'}</span></div>
                                    {item.cin_company_name && <div className="flex justify-between"><span className="text-gray-500">Company Name:</span><span className="font-medium text-gray-900 dark:text-white">{item.cin_company_name}</span></div>}
                                    {item.cin_status && <div className="flex justify-between"><span className="text-gray-500">CIN Status:</span><span className={`font-medium ${item.cin_status === 'Active' ? 'text-green-600' : 'text-red-600'}`}>{item.cin_status}</span></div>}
                                    {item.cin_incorporation_date && <div className="flex justify-between"><span className="text-gray-500">Incorporation:</span><span className="font-medium text-gray-900 dark:text-white">{item.cin_incorporation_date}</span></div>}
                                  </div>
                                </div>

                                {/* Aadhaar / Digilocker Verification */}
                                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                                    <ShieldCheck className="w-4 h-4 text-teal-500" /> Aadhaar (Digilocker)
                                    {item.aadhaar_verified ? <span className="ml-auto px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-[10px] font-bold">VERIFIED</span> : item.aadhar_number ? <span className="ml-auto px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-[10px] font-bold">NOT VERIFIED</span> : <span className="ml-auto px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[10px]">N/A</span>}
                                  </h4>
                                  <div className="space-y-2 text-xs">
                                    <div className="flex justify-between"><span className="text-gray-500">Aadhaar No:</span><span className="font-medium text-gray-900 dark:text-white">{item.aadhar_number ? `XXXX-XXXX-${item.aadhar_number.slice(-4)}` : 'N/A'}</span></div>
                                    {item.aadhaar_name && <div className="flex justify-between"><span className="text-gray-500">Name:</span><span className="font-medium text-gray-900 dark:text-white">{item.aadhaar_name}</span></div>}
                                    {item.aadhaar_dob && <div className="flex justify-between"><span className="text-gray-500">DOB:</span><span className="font-medium text-gray-900 dark:text-white">{item.aadhaar_dob}</span></div>}
                                    {item.aadhaar_gender && <div className="flex justify-between"><span className="text-gray-500">Gender:</span><span className="font-medium text-gray-900 dark:text-white">{item.aadhaar_gender}</span></div>}
                                    {item.aadhaar_address && <div className="flex justify-between"><span className="text-gray-500">Address:</span><span className="font-medium text-gray-900 dark:text-white text-right max-w-[180px]">{item.aadhaar_address}</span></div>}
                                    {item.digilocker_verification_id && <div className="flex justify-between"><span className="text-gray-500">Verification ID:</span><span className="font-medium text-gray-900 dark:text-white text-[10px]">{item.digilocker_verification_id}</span></div>}
                                  </div>
                                </div>

                                {/* UDHYAM */}
                                {item.udhyam_number && (
                                  <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                                    <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                                      <Shield className="w-4 h-4 text-amber-500" /> UDHYAM Registration
                                    </h4>
                                    <div className="space-y-2 text-xs">
                                      <div className="flex justify-between"><span className="text-gray-500">UDHYAM No:</span><span className="font-medium text-gray-900 dark:text-white">{item.udhyam_number}</span></div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination - Compact */}
            {filteredAndSortedData.length > 0 && (
              <div className="px-2 sm:px-3 py-2 border-t border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row items-center justify-between gap-2">
                <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start">
                  <span className="text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">Items per page:</span>
                  <select
                    value={itemsPerPage}
                    onChange={(e) => {
                      setItemsPerPage(Number(e.target.value) as 10 | 25 | 100)
                      setCurrentPage(1)
                    }}
                    className="px-2 py-1 border border-gray-300 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-xs"
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={100}>100</option>
                  </select>
                  <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {(currentPage - 1) * itemsPerPage + 1}–{Math.min(currentPage * itemsPerPage, filteredAndSortedData.length)} of {filteredAndSortedData.length}
                  </span>
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start">
                    <span className="text-xs text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      <span className="hidden sm:inline">Page {currentPage} of {totalPages}</span>
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
                )}
              </div>
            )}
          </motion.div>
          </>
          )}
        </div>
      </div>

      {/* Wallet Action Modal */}
      {showWalletModal && selectedWalletUser && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6"
          >
            <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
              {walletAction === 'push' ? 'Push Balance' : 'Pull Balance'}
            </h3>
            <div className="mb-4 space-y-2">
              <p className="text-sm text-gray-600 dark:text-gray-400">User: {selectedWalletUser.name}</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Partner ID: {selectedWalletUser.partner_id}</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Type: {selectedWalletUser.user_type || activeTab.replace('-', ' ')}</p>
              <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Current Balance ({walletFormData.wallet_type === 'primary' ? 'Primary' : 'AEPS'}):</span>
                  {loadingBalance ? (
                    <span className="text-sm text-gray-500 dark:text-gray-400">Loading...</span>
                  ) : (
                    <span className="text-lg font-bold text-green-600 dark:text-green-400">
                      ₹{currentBalance !== null ? currentBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                    </span>
                  )}
                </div>
                {walletFormData.amount && !isNaN(parseFloat(walletFormData.amount)) && (
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {walletAction === 'push' ? 'After Push' : 'After Pull'}:
                    </span>
                    <span className={`text-lg font-bold ${
                      walletAction === 'push' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                    }`}>
                      ₹{((currentBalance || 0) + (walletAction === 'push' ? 1 : -1) * parseFloat(walletFormData.amount)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Amount (₹)</label>
                <input
                  type="number"
                  value={walletFormData.amount}
                  onChange={(e) => setWalletFormData({ ...walletFormData, amount: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  placeholder="Enter amount"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Fund Category</label>
                <select
                  value={walletFormData.fund_category}
                  onChange={(e) => setWalletFormData({ ...walletFormData, fund_category: e.target.value as any })}
                  className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                >
                  <option value="cash">Cash</option>
                  <option value="online">Online</option>
                  <option value="aeps">AEPS</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Wallet Type</label>
                <select
                  value={walletFormData.wallet_type}
                  onChange={async (e) => {
                    const newWalletType = e.target.value as 'primary' | 'aeps'
                    setWalletFormData({ ...walletFormData, wallet_type: newWalletType })
                    // Fetch balance for the new wallet type
                    await fetchWalletBalance(selectedWalletUser.partner_id, newWalletType)
                  }}
                  className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                >
                  <option value="primary">Primary</option>
                  <option value="aeps">AEPS</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Remarks</label>
                <textarea
                  value={walletFormData.remarks}
                  onChange={(e) => setWalletFormData({ ...walletFormData, remarks: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                  rows={3}
                  placeholder="Enter remarks..."
                />
              </div>
              <div className="flex gap-3">
                <button
                  disabled={walletProcessing}
                  onClick={async () => {
                    setWalletProcessing(true)
                    try {
                      const endpoint = walletAction === 'push' ? '/api/admin/wallet/push' : '/api/admin/wallet/pull'
                      const userRole = selectedWalletUser.user_type || 
                        (activeTab === 'retailers' ? 'retailer' : 
                         activeTab === 'distributors' ? 'distributor' : 
                         'master_distributor')
                      
                      const response = await apiFetch(endpoint, {
                        method: 'POST',
                        body: JSON.stringify({
                          user_id: selectedWalletUser.partner_id,
                          user_role: userRole,
                          wallet_type: walletFormData.wallet_type,
                          fund_category: walletFormData.fund_category,
                          amount: parseFloat(walletFormData.amount),
                          remarks: walletFormData.remarks
                        })
                      })

                      const data = await response.json()
                      if (data.success) {
                        if (data.after_balance !== undefined) {
                          setCurrentBalance(data.after_balance)
                        }
                        showToast(data.message || 'Action completed successfully!', 'success')
                        setShowWalletModal(false)
                        setSelectedWalletUser(null)
                        setWalletFormData({ amount: '', fund_category: 'cash', wallet_type: 'primary', remarks: '' })
                        setCurrentBalance(null)
                        fetchData()
                      } else {
                        showToast(data.error || 'Action failed', 'error')
                      }
                    } catch (error) {
                      console.error('Wallet action error:', error)
                      showToast('Failed to perform action', 'error')
                    } finally {
                      setWalletProcessing(false)
                    }
                  }}
                  className={`flex-1 py-2 px-4 rounded-lg text-white disabled:opacity-50 ${
                    walletAction === 'push' 
                      ? 'bg-green-600 hover:bg-green-700' 
                      : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {walletProcessing ? 'Processing...' : walletAction === 'push' ? 'Push Balance' : 'Pull Balance'}
                </button>
                <button
                  disabled={walletProcessing}
                  onClick={() => {
                    setShowWalletModal(false)
                    setSelectedWalletUser(null)
                    setWalletFormData({ amount: '', fund_category: 'cash', wallet_type: 'primary', remarks: '' })
                    setCurrentBalance(null)
                  }}
                  className="flex-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 py-2 px-4 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Password Reset Modal */}
      {showPasswordResetModal && selectedUserForReset && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6"
          >
            <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
              Reset Password
            </h3>
            <div className="mb-4 space-y-2">
              <p className="text-sm text-gray-600 dark:text-gray-400">User: {selectedUserForReset.name}</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Partner ID: {selectedUserForReset.partner_id}</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Email: {selectedUserForReset.email}</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Type: {selectedUserForReset.user_type || activeTab.replace('-', ' ')}</p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">New Password *</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-4 py-2 pr-10 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    placeholder="Enter new password (min. 8 characters)"
                    minLength={8}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Confirm Password *</label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-4 py-2 pr-10 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    placeholder="Confirm new password"
                    minLength={8}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    if (!newPassword || !confirmPassword) {
                      showToast('Please fill in both password fields', 'error')
                      return
                    }
                    if (newPassword.length < 8) {
                      showToast('Password must be at least 8 characters long', 'error')
                      return
                    }
                    if (newPassword !== confirmPassword) {
                      showToast('Passwords do not match', 'error')
                      return
                    }

                    setResettingPassword(true)
                    try {
                      const userRole = activeTab === 'retailers' ? 'retailer' : 
                                      activeTab === 'distributors' ? 'distributor' : 
                                      'master_distributor'
                      
                      const response = await apiFetch('/api/admin/reset-password', {
                        method: 'POST',
                        body: JSON.stringify({
                          user_id: selectedUserForReset.partner_id,
                          user_role: userRole,
                          new_password: newPassword
                        })
                      })

                      const data = await response.json()
                      if (data.success) {
                        showToast(data.message || 'Password reset successfully!', 'success')
                        setShowPasswordResetModal(false)
                        setSelectedUserForReset(null)
                        setNewPassword('')
                        setConfirmPassword('')
                      } else {
                        showToast(data.error || 'Failed to reset password', 'error')
                      }
                    } catch (error: any) {
                      console.error('Password reset error:', error)
                      showToast(error.message || 'Failed to reset password', 'error')
                    } finally {
                      setResettingPassword(false)
                    }
                  }}
                  disabled={resettingPassword}
                  className="flex-1 py-2 px-4 rounded-lg text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {resettingPassword ? 'Resetting...' : 'Reset Password'}
                </button>
                <button
                  onClick={() => {
                    setShowPasswordResetModal(false)
                    setSelectedUserForReset(null)
                    setNewPassword('')
                    setConfirmPassword('')
                  }}
                  className="flex-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 py-2 px-4 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* BBPS Limit Tier Modal */}
      {showBBPSLimitModal && selectedRetailerForLimit && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6"
          >
            <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
              Set BBPS Payment Limit
            </h3>
            <div className="mb-4 space-y-2">
              <p className="text-sm text-gray-600 dark:text-gray-400">Retailer: {selectedRetailerForLimit.name}</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Partner ID: {selectedRetailerForLimit.partner_id}</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Current Limit: ₹{(selectedRetailerForLimit.bbps_limit_tier || 49999).toLocaleString('en-IN')}
              </p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                  Select BBPS Payment Limit Tier
                </label>
                <div className="space-y-2">
                  <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <input
                      type="radio"
                      name="bbps_limit_tier"
                      value="49999"
                      checked={bbpsLimitTier === 49999}
                      onChange={() => setBbpsLimitTier(49999)}
                      className="mr-3"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-gray-900 dark:text-white">₹49,999 (Default)</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Standard limit for all retailers</div>
                    </div>
                  </label>
                  <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <input
                      type="radio"
                      name="bbps_limit_tier"
                      value="99999"
                      checked={bbpsLimitTier === 99999}
                      onChange={() => setBbpsLimitTier(99999)}
                      className="mr-3"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-gray-900 dark:text-white">₹99,999</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Higher limit - ensure scheme charges are configured</div>
                    </div>
                  </label>
                  <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <input
                      type="radio"
                      name="bbps_limit_tier"
                      value="189999"
                      checked={bbpsLimitTier === 189999}
                      onChange={() => setBbpsLimitTier(189999)}
                      className="mr-3"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-gray-900 dark:text-white">₹1,89,999</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Maximum limit - ensure scheme charges are configured</div>
                    </div>
                  </label>
                </div>
                <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                  <p className="text-xs text-yellow-800 dark:text-yellow-300">
                    <strong>Note:</strong> For limits above ₹49,999, ensure the retailer's scheme has charges configured for the higher amount ranges.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    setUpdatingLimit(true)
                    try {
                      const response = await apiFetch('/api/admin/retailers/bbps-limit', {
                        method: 'POST',
                        body: JSON.stringify({
                          retailer_id: selectedRetailerForLimit.partner_id,
                          bbps_limit_tier: bbpsLimitTier
                        })
                      })

                      const data = await response.json()
                      if (data.success) {
                        showToast(data.message || 'BBPS limit updated successfully!', 'success')
                        setShowBBPSLimitModal(false)
                        setSelectedRetailerForLimit(null)
                        fetchData()
                      } else {
                        showToast(data.error || 'Failed to update BBPS limit', 'error')
                      }
                    } catch (error: any) {
                      console.error('BBPS limit update error:', error)
                      showToast(error.message || 'Failed to update BBPS limit', 'error')
                    } finally {
                      setUpdatingLimit(false)
                    }
                  }}
                  disabled={updatingLimit}
                  className="flex-1 py-2 px-4 rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {updatingLimit ? 'Updating...' : 'Update Limit'}
                </button>
                <button
                  onClick={() => {
                    setShowBBPSLimitModal(false)
                    setSelectedRetailerForLimit(null)
                  }}
                  className="flex-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 py-2 px-4 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Settlement Limit Tier Modal */}
      {showSettlementLimitModal && selectedRetailerForSettlementLimit && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6"
          >
            <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
              Set Settlement Payment Limit
            </h3>
            <div className="mb-4 space-y-2">
              <p className="text-sm text-gray-600 dark:text-gray-400">Retailer: {selectedRetailerForSettlementLimit.name}</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">Partner ID: {selectedRetailerForSettlementLimit.partner_id}</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Current Limit: ₹{(selectedRetailerForSettlementLimit.settlement_limit_tier || 100000).toLocaleString('en-IN')}
              </p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                  Select Settlement Payment Limit Tier
                </label>
                <div className="space-y-2">
                  <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <input
                      type="radio"
                      name="settlement_limit_tier"
                      value="100000"
                      checked={settlementLimitTier === 100000}
                      onChange={() => setSettlementLimitTier(100000)}
                      className="mr-3"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-gray-900 dark:text-white">₹1,00,000 (Default)</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Standard limit for all retailers</div>
                    </div>
                  </label>
                  <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <input
                      type="radio"
                      name="settlement_limit_tier"
                      value="150000"
                      checked={settlementLimitTier === 150000}
                      onChange={() => setSettlementLimitTier(150000)}
                      className="mr-3"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-gray-900 dark:text-white">₹1,50,000</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Higher limit - ensure scheme charges are configured</div>
                    </div>
                  </label>
                  <label className="flex items-center p-3 border rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <input
                      type="radio"
                      name="settlement_limit_tier"
                      value="200000"
                      checked={settlementLimitTier === 200000}
                      onChange={() => setSettlementLimitTier(200000)}
                      className="mr-3"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-gray-900 dark:text-white">₹2,00,000</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Maximum limit - ensure scheme charges are configured</div>
                    </div>
                  </label>
                </div>
                <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                  <p className="text-xs text-yellow-800 dark:text-yellow-300">
                    <strong>Note:</strong> For limits above ₹1,00,000, ensure the retailer's scheme has charges configured for the higher amount ranges.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    setUpdatingSettlementLimit(true)
                    try {
                      const response = await apiFetch('/api/admin/retailers/settlement-limit', {
                        method: 'POST',
                        body: JSON.stringify({
                          retailer_id: selectedRetailerForSettlementLimit.partner_id,
                          settlement_limit_tier: settlementLimitTier
                        })
                      })

                      const data = await response.json()
                      if (data.success) {
                        showToast(data.message || 'Settlement limit updated successfully!', 'success')
                        setShowSettlementLimitModal(false)
                        setSelectedRetailerForSettlementLimit(null)
                        fetchData()
                      } else {
                        showToast(data.error || 'Failed to update settlement limit', 'error')
                      }
                    } catch (error: any) {
                      console.error('Settlement limit update error:', error)
                      showToast(error.message || 'Failed to update settlement limit', 'error')
                    } finally {
                      setUpdatingSettlementLimit(false)
                    }
                  }}
                  disabled={updatingSettlementLimit}
                  className="flex-1 py-2 px-4 rounded-lg text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {updatingSettlementLimit ? 'Updating...' : 'Update Limit'}
                </button>
                <button
                  onClick={() => {
                    setShowSettlementLimitModal(false)
                    setSelectedRetailerForSettlementLimit(null)
                  }}
                  className="flex-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 py-2 px-4 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        activeTab === 'pos-machines' ? (
          <POSMachineModal
            item={editingItem as POSMachine | null}
            retailers={retailers}
            distributors={distributors}
            masterDistributors={masterDistributors}
            partners={partners}
            onClose={() => {
              setShowModal(false)
              setEditingItem(null)
            }}
            onSuccess={() => {
              showToast(editingItem ? 'POS machine updated successfully' : 'POS machine created successfully', 'success')
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
              showToast(editingItem ? 'Updated successfully' : 'Created successfully', 'success')
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

// Admin Dashboard Overview - Financial Analytics Component
function AdminDashboardOverview({ 
  retailers, 
  distributors, 
  masterDistributors 
}: { 
  retailers: Retailer[]
  distributors: Distributor[]
  masterDistributors: MasterDistributor[]
}) {
  const { showToast } = useToast()
  const [downloading, setDownloading] = useState(false)
  const [analyticsData, setAnalyticsData] = useState({
    totalTransactionVolume: 0,
    todayTransactionVolume: 0,
    weeklyTransactionVolume: 0,
    monthlyTransactionVolume: 0,
    totalCommissionEarned: 0,
    todayCommissionEarned: 0,
    monthlyCommissionEarned: 0,
    activePartners: 0,
    pendingVerifications: 0,
    totalWalletBalance: 0,
    aepsTransactions: 0,
    bbpsTransactions: 0
  })
  const [loading, setLoading] = useState(true)
  const [selectedPeriod, setSelectedPeriod] = useState<'today' | 'week' | 'month' | 'year'>('today')
  
  // Sparkup Balance State
  const [sparkupBalance, setSparkupBalance] = useState<{
    bbps: {
      balance: number | null
      lien: number | null
      available_balance: number | null
      success: boolean
      error?: string
      setup_hint?: string
      route_not_found?: boolean
    }
    payout: { balance: number; lien: number; available_balance: number; success: boolean; error?: string }
    summary: { total_available: number; all_services_healthy: boolean }
    last_checked: string
  } | null>(null)
  const [sparkupLoading, setSparkupLoading] = useState(false)

  // SHADVAL PAY Balance State
  const [shadvalBalance, setShadvalBalance] = useState<{
    success: boolean
    balance: number
    available_balance: number
    verification_balance: number
    verification_success: boolean
    verification_error?: string
    error?: string
    last_checked: string
  } | null>(null)
  const [shadvalLoading, setShadvalLoading] = useState(false)

  // Helper to get auth token for API calls
  const getAuthToken = async (): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token || null
  }

  // Fetch Sparkup Balance (uses EC2 backend for whitelisted IP access)
  const fetchSparkupBalance = async () => {
    setSparkupLoading(true)
    const checkedAt = new Date().toISOString()
    const unreachable = (msg: string) => ({
      bbps: {
        success: false,
        error: msg,
        balance: 0,
        lien: 0,
        available_balance: 0,
      },
      payout: { success: false, balance: 0, lien: 0, available_balance: 0 },
      summary: { total_available: 0, all_services_healthy: false },
      last_checked: checkedAt,
    })

    try {
      const response = await apiFetch('/api/admin/sparkup-balance', { timeout: 20000 })
      let data: any = {}
      try {
        data = await response.json()
      } catch {
        data = {}
      }

      if (response.ok && data.success) {
        setSparkupBalance({
          bbps: data.bbps,
          payout: data.payout,
          summary: data.summary,
          last_checked: data.last_checked || checkedAt,
        })
      } else {
        const hint =
          typeof window !== 'undefined' && window.location.hostname.endsWith('samedaysolution.in')
            ? ' Check that api.samedaysolution.in is reachable (DNS, firewall, EC2).'
            : ''
        setSparkupBalance(
          unreachable(
            data.error ||
              data.message ||
              (!response.ok
                ? `HTTP ${response.status}${hint}`
                : `Balance service did not return success.${hint}`)
          )
        )
      }
    } catch (error: any) {
      console.error('Error fetching Sparkup balance:', error)
      const msg =
        error?.message?.includes('timeout') || error?.name === 'AbortError'
          ? 'Request timed out — API server may be slow or unreachable.'
          : error?.message || 'Failed to fetch — API server may be unreachable.'
      setSparkupBalance(unreachable(msg))
    } finally {
      setSparkupLoading(false)
    }
  }

  // Fetch SHADVAL PAY Balance
  const fetchShadvalBalance = async () => {
    setShadvalLoading(true)
    const checkedAt = new Date().toISOString()
    try {
      const response = await apiFetch('/api/admin/shadval-pay-balance', { timeout: 20000 })
      let data: any = {}
      try { data = await response.json() } catch { data = {} }

      if (response.ok && data.success) {
        setShadvalBalance({
          success: true,
          balance: data.balance || 0,
          available_balance: data.available_balance || 0,
          verification_balance: data.verification_balance || 0,
          verification_success: data.verification_success ?? false,
          verification_error: data.verification_error || undefined,
          last_checked: data.last_checked || checkedAt,
        })
      } else {
        setShadvalBalance({
          success: false,
          balance: 0,
          available_balance: 0,
          verification_balance: 0,
          verification_success: false,
          error: data.error || data.message || `HTTP ${response.status}`,
          last_checked: checkedAt,
        })
      }
    } catch (error: any) {
      console.error('Error fetching SHADVAL PAY balance:', error)
      setShadvalBalance({
        success: false,
        balance: 0,
        available_balance: 0,
        verification_balance: 0,
        verification_success: false,
        error: error?.message?.includes('timeout')
          ? 'Request timed out — SHADVAL PAY server may be slow or unreachable.'
          : error?.message || 'Failed to fetch — server may be unreachable.',
        last_checked: checkedAt,
      })
    } finally {
      setShadvalLoading(false)
    }
  }

  useEffect(() => {
    fetchAnalytics()
  }, [selectedPeriod])
  
  // Fetch Sparkup balance on mount
  useEffect(() => {
    fetchSparkupBalance()
    fetchShadvalBalance()
  }, [])

  const fetchAnalytics = async () => {
    setLoading(true)
    try {
      const since = getDateRange(selectedPeriod)
      // `transactions` in DB is the MDR scheme table (no transaction_type / status columns).
      // Dashboard volume/counts: BBPS + AEPS only. DMT/recharge are not live yet — do not query
      // those sources here (avoids errors and extra load); extend this when those services launch.
      const [bbpsRes, aepsRes] = await Promise.all([
        supabase.from('bbps_transactions').select('bill_amount, created_at, status').gte('created_at', since),
        supabase.from('aeps_transactions').select('amount, created_at, status').gte('created_at', since),
      ])
      if (bbpsRes.error) console.error('Analytics BBPS error:', bbpsRes.error)
      if (aepsRes.error) console.error('Analytics AEPS error:', aepsRes.error)

      const bbpsOk = (bbpsRes.data || []).filter(t => (t.status || '').toLowerCase() === 'success')
      const aepsOk = (aepsRes.data || []).filter(t => (t.status || '').toLowerCase() === 'success')
      const bbpsVolume = bbpsOk.reduce((sum, t) => sum + parseFloat(String(t.bill_amount ?? 0)), 0)
      const aepsVolume = aepsOk.reduce((sum, t) => sum + parseFloat(String(t.amount ?? 0)), 0)
      const totalVolume = bbpsVolume + aepsVolume

      setAnalyticsData(prev => ({
        ...prev,
        totalTransactionVolume: totalVolume,
        todayTransactionVolume: totalVolume,
        aepsTransactions: aepsOk.length,
        bbpsTransactions: bbpsOk.length,
        activePartners: retailers.filter(r => r.status === 'active').length +
          distributors.filter(d => d.status === 'active').length +
          masterDistributors.filter(m => m.status === 'active').length,
        pendingVerifications: retailers.filter(r => r.verification_status === 'pending').length +
          distributors.filter(d => d.verification_status === 'pending').length +
          masterDistributors.filter(m => m.verification_status === 'pending').length,
      }))
    } catch (err) {
      console.error('Error fetching analytics:', err)
      showToast('Failed to fetch analytics data', 'error')
    } finally {
      setLoading(false)
    }
  }

  const getDateRange = (period: string) => {
    const now = new Date()
    switch (period) {
      case 'today':
        return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      case 'week':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
      case 'month':
        return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
      case 'year':
        return new Date(now.getFullYear(), 0, 1).toISOString()
      default:
        return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(amount)
  }

  // Download reports function (MDR `transactions` table: settlement_status, retailer_id, mode, etc.)
  const downloadReport = async (format: 'csv' | 'excel' | 'pdf' | 'json') => {
    setDownloading(true)
    try {
      const { data: transactions } = await supabase
        .from('transactions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000)
      
      if (!transactions) return

      const rowForExport = (t: any) => [
        new Date(t.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
        t.razorpay_payment_id || t.transaction_id || t.id,
        t.transaction_type || (t.mode && t.settlement_type ? `${t.mode} (${t.settlement_type})` : 'MDR'),
        t.amount,
        t.settlement_status === 'completed' ? 'completed' : (t.settlement_status || t.status || ''),
        t.retailer_id || t.partner_id
      ]

      if (format === 'csv') {
        const headers = ['Date', 'Transaction ID', 'Type', 'Amount', 'Status', 'Partner ID']
        const rows = transactions.map(rowForExport)
        const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
        downloadFile(csvContent, 'transactions_report.csv', 'text/csv')
      } else if (format === 'json') {
        downloadFile(JSON.stringify(transactions, null, 2), 'transactions_report.json', 'application/json')
      } else if (format === 'excel') {
        const headers = ['Date', 'Transaction ID', 'Type', 'Amount', 'Status', 'Partner ID']
        const rows = transactions.map(rowForExport)
        const excelContent = [headers.join('\t'), ...rows.map(r => r.join('\t'))].join('\n')
        downloadFile(excelContent, 'transactions_report.xls', 'application/vnd.ms-excel')
      }
      showToast(`Report downloaded as ${format.toUpperCase()}`, 'success')
    } catch (err) {
      console.error('Error downloading report:', err)
      showToast('Failed to download report', 'error')
    } finally {
      setDownloading(false)
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

  return (
    <div className="space-y-6">
      {/* Period Selector & Report Downloads */}
      <div className="flex flex-wrap justify-between items-center gap-4">
        <div className="flex gap-2">
          {(['today', 'week', 'month', 'year'] as const).map((period) => (
            <button
              key={period}
              onClick={() => setSelectedPeriod(period)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                selectedPeriod === period
                  ? 'bg-gradient-to-r from-primary-500 to-secondary-500 text-white shadow-lg'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:border-primary-500'
              }`}
            >
              {period.charAt(0).toUpperCase() + period.slice(1)}
            </button>
          ))}
        </div>
        
        {/* Report Downloads */}
        <div className="flex gap-2">
          <button
            onClick={() => downloadReport('csv')}
            disabled={downloading}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-all shadow-md hover:shadow-lg disabled:opacity-50"
          >
            {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
            CSV
          </button>
          <button
            onClick={() => downloadReport('excel')}
            disabled={downloading}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-all shadow-md hover:shadow-lg disabled:opacity-50"
          >
            {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sheet className="w-4 h-4" />}
            Excel
          </button>
          <button
            onClick={() => downloadReport('json')}
            disabled={downloading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-all shadow-md hover:shadow-lg disabled:opacity-50"
          >
            {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileBarChart className="w-4 h-4" />}
            JSON
          </button>
        </div>
      </div>

      {/* Financial KPIs - Premium Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 rounded-2xl p-6 text-white shadow-xl"
        >
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-white/10 rounded-full blur-2xl"></div>
          <div className="absolute bottom-0 left-0 -mb-4 -ml-4 w-32 h-32 bg-white/5 rounded-full blur-3xl"></div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm">
                <IndianRupee className="w-6 h-6" />
              </div>
              <span className="text-xs font-medium bg-white/20 px-2 py-1 rounded-full">
                {selectedPeriod.toUpperCase()}
              </span>
            </div>
            <p className="text-sm text-blue-100 mb-1">Transaction Volume</p>
            <p className="text-3xl font-bold tracking-tight">
              {loading ? '...' : formatCurrency(analyticsData.totalTransactionVolume)}
            </p>
            <div className="mt-3 flex items-center gap-1 text-xs text-blue-200">
              <TrendingUp className="w-3 h-3" />
              <span>All successful transactions</span>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="relative overflow-hidden bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 rounded-2xl p-6 text-white shadow-xl"
        >
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-white/10 rounded-full blur-2xl"></div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm">
                <Users className="w-6 h-6" />
              </div>
              <CheckCircle2 className="w-5 h-5 text-emerald-200" />
            </div>
            <p className="text-sm text-emerald-100 mb-1">Active Partners</p>
            <p className="text-3xl font-bold tracking-tight">
              {loading ? '...' : analyticsData.activePartners.toLocaleString()}
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div className="bg-white/10 rounded-lg px-2 py-1 text-center">
                <p className="font-semibold">{retailers.filter(r => r.status === 'active').length}</p>
                <p className="text-emerald-200">Retailers</p>
              </div>
              <div className="bg-white/10 rounded-lg px-2 py-1 text-center">
                <p className="font-semibold">{distributors.filter(d => d.status === 'active').length}</p>
                <p className="text-emerald-200">Dist.</p>
              </div>
              <div className="bg-white/10 rounded-lg px-2 py-1 text-center">
                <p className="font-semibold">{masterDistributors.filter(m => m.status === 'active').length}</p>
                <p className="text-emerald-200">MD</p>
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="relative overflow-hidden bg-gradient-to-br from-amber-500 via-orange-600 to-red-600 rounded-2xl p-6 text-white shadow-xl"
        >
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-white/10 rounded-full blur-2xl"></div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <Clock className="w-5 h-5 text-amber-200" />
            </div>
            <p className="text-sm text-amber-100 mb-1">Pending Verifications</p>
            <p className="text-3xl font-bold tracking-tight">
              {loading ? '...' : analyticsData.pendingVerifications}
            </p>
            <div className="mt-3 text-xs text-amber-200">
              <span>Requires attention</span>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="relative overflow-hidden bg-gradient-to-br from-purple-600 via-purple-700 to-pink-700 rounded-2xl p-6 text-white shadow-xl"
        >
          <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-white/10 rounded-full blur-2xl"></div>
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm">
                <CreditCard className="w-6 h-6" />
              </div>
              <Zap className="w-5 h-5 text-purple-200" />
            </div>
            <p className="text-sm text-purple-100 mb-1">Total POS Machines</p>
            <p className="text-3xl font-bold tracking-tight">
              {loading ? '...' : (retailers.length + distributors.length)}
            </p>
            <div className="mt-3 text-xs text-purple-200">
              <span>Active deployments</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Chagans Technologies Balance Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="bg-gradient-to-br from-indigo-950 via-indigo-900 to-indigo-950 rounded-2xl p-6 shadow-xl border border-indigo-700"
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-lg">
              <Globe className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Chagans Technologies Limited</h3>
              <p className="text-sm text-indigo-300">BBPS Bill Payment Provider</p>
            </div>
          </div>
          <button
            onClick={fetchSparkupBalance}
            disabled={sparkupLoading}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-700 hover:bg-indigo-600 text-white rounded-lg text-sm font-medium transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${sparkupLoading ? 'animate-spin' : ''}`} />
            {sparkupLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {sparkupBalance ? (
          <div className={`rounded-xl p-5 border ${
            sparkupBalance.bbps.success
              ? 'bg-gradient-to-r from-indigo-600/20 to-purple-600/20 border-indigo-500/30'
              : 'bg-red-900/20 border-red-500/30'
          }`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-600 rounded-lg">
                  <Wallet className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-white">Chagans BBPS Wallet</p>
                  <p className="text-xs text-indigo-300">Bill Fetch &amp; Pay Services</p>
                </div>
              </div>
              {sparkupBalance.bbps.success ? (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/20 text-green-400">
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="text-sm font-medium">Active</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/20 text-red-400">
                  <XCircle className="w-4 h-4" />
                  <span className="text-sm font-medium">Error</span>
                </div>
              )}
            </div>

            {sparkupBalance.bbps.success &&
            sparkupBalance.bbps.balance != null &&
            sparkupBalance.bbps.available_balance != null ? (
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-3 bg-indigo-800/50 rounded-lg">
                  <p className="text-xs text-indigo-300 mb-1">Total Balance</p>
                  <p className="text-xl font-bold text-white">₹{sparkupBalance.bbps.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="text-center p-3 bg-indigo-800/50 rounded-lg">
                  <p className="text-xs text-indigo-300 mb-1">Lien Amount</p>
                  <p className="text-xl font-bold text-orange-400">₹{(sparkupBalance.bbps.lien ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                </div>
                <div className="text-center p-3 bg-green-900/30 rounded-lg border border-green-500/30">
                  <p className="text-xs text-green-300 mb-1">Available</p>
                  <p className="text-xl font-bold text-green-400">₹{sparkupBalance.bbps.available_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-red-400">{sparkupBalance.bbps.error || 'Unable to fetch Chagans wallet balance from API'}</p>
                {sparkupBalance.bbps.setup_hint && (
                  <p className="text-xs text-indigo-300">{sparkupBalance.bbps.setup_hint}</p>
                )}
              </div>
            )}

            {sparkupBalance.last_checked && (
              <p className="text-xs text-indigo-300 mt-4 text-right">
                Last updated: {new Date(sparkupBalance.last_checked).toLocaleString('en-IN')}
              </p>
            )}
          </div>
        ) : (
          <div className="text-center py-8">
            {sparkupLoading ? (
              <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin mx-auto" />
            ) : (
              <p className="text-indigo-400">Unable to fetch Chagans balance</p>
            )}
          </div>
        )}
      </motion.div>

      {/* Sparkup Provider Balance Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl p-6 shadow-xl border border-slate-700"
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl shadow-lg">
              <Globe className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Sparkup Provider Balance</h3>
              <p className="text-sm text-slate-400">API Service Provider Wallet Status</p>
            </div>
          </div>
          <button
            onClick={fetchSparkupBalance}
            disabled={sparkupLoading}
            className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${sparkupLoading ? 'animate-spin' : ''}`} />
            {sparkupLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {sparkupBalance ? (
          <div className="space-y-4">
            {/* Payout Balance Card (real Sparkup balance) */}
            <div className={`rounded-xl p-5 border ${
              sparkupBalance.payout.success 
                ? 'bg-gradient-to-r from-cyan-600/20 to-blue-600/20 border-cyan-500/30' 
                : 'bg-red-900/20 border-red-500/30'
            }`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-cyan-600 rounded-lg">
                    <Wallet className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold text-white">Sparkup Master Wallet</p>
                    <p className="text-xs text-slate-400">Payout, DMT, IMPS/NEFT Services</p>
                  </div>
                </div>
                {sparkupBalance.payout.success ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/20 text-green-400">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-sm font-medium">Active</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/20 text-red-400">
                    <XCircle className="w-4 h-4" />
                    <span className="text-sm font-medium">Error</span>
                  </div>
                )}
              </div>
              
              {sparkupBalance.payout.success ? (
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-3 bg-slate-800/50 rounded-lg">
                    <p className="text-xs text-slate-400 mb-1">Total Balance</p>
                    <p className="text-xl font-bold text-white">₹{sparkupBalance.payout.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                  </div>
                  <div className="text-center p-3 bg-slate-800/50 rounded-lg">
                    <p className="text-xs text-slate-400 mb-1">Lien Amount</p>
                    <p className="text-xl font-bold text-orange-400">₹{sparkupBalance.payout.lien.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                  </div>
                  <div className="text-center p-3 bg-green-900/30 rounded-lg border border-green-500/30">
                    <p className="text-xs text-green-300 mb-1">Available</p>
                    <p className="text-xl font-bold text-green-400">₹{sparkupBalance.payout.available_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-red-400">{sparkupBalance.payout.error || 'Failed to fetch balance'}</p>
              )}
              
              {sparkupBalance.last_checked && (
                <p className="text-xs text-slate-400 mt-4 text-right">
                  Last updated: {new Date(sparkupBalance.last_checked).toLocaleString('en-IN')}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            {sparkupLoading ? (
              <div className="flex flex-col items-center gap-3">
                <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
                <p className="text-slate-400">Fetching Sparkup balance...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <AlertTriangle className="w-8 h-8 text-amber-400" />
                <p className="text-slate-400">Unable to fetch Sparkup balance</p>
                <button
                  onClick={fetchSparkupBalance}
                  className="mt-2 px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm font-medium transition-all"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>
        )}
      </motion.div>

      {/* SHADVAL PAY Balance Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="bg-gradient-to-br from-violet-950 via-purple-900 to-violet-950 rounded-2xl p-6 shadow-xl border border-violet-700"
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl shadow-lg">
              <Banknote className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">SHADVAL PAY Balance</h3>
              <p className="text-sm text-violet-300/70">Payout Service Provider Wallet</p>
            </div>
          </div>
          <button
            onClick={fetchShadvalBalance}
            disabled={shadvalLoading}
            className="flex items-center gap-2 px-4 py-2 bg-violet-800 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${shadvalLoading ? 'animate-spin' : ''}`} />
            {shadvalLoading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {shadvalBalance ? (
          <div className="space-y-4">
            {/* Main Wallet */}
            <div className={`rounded-xl p-5 border ${
              shadvalBalance.success
                ? 'bg-gradient-to-r from-violet-600/20 to-purple-600/20 border-violet-500/30'
                : 'bg-red-900/20 border-red-500/30'
            }`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-violet-600 rounded-lg">
                    <Wallet className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold text-white">Main Wallet</p>
                    <p className="text-xs text-violet-300/60">Payout, IMPS/NEFT/RTGS Services</p>
                  </div>
                </div>
                {shadvalBalance.success ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/20 text-green-400">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-sm font-medium">Active</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/20 text-red-400">
                    <XCircle className="w-4 h-4" />
                    <span className="text-sm font-medium">Error</span>
                  </div>
                )}
              </div>

              {shadvalBalance.success ? (
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-3 bg-violet-900/40 rounded-lg">
                    <p className="text-xs text-violet-300/60 mb-1">Total Balance</p>
                    <p className="text-xl font-bold text-white">₹{shadvalBalance.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                  </div>
                  <div className="text-center p-3 bg-green-900/30 rounded-lg border border-green-500/30">
                    <p className="text-xs text-green-300 mb-1">Available Balance</p>
                    <p className="text-xl font-bold text-green-400">₹{shadvalBalance.available_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-red-400">{shadvalBalance.error || 'Failed to fetch balance'}</p>
              )}
            </div>

            {/* Verification Wallet */}
            <div className={`rounded-xl p-5 border ${
              shadvalBalance.verification_success
                ? 'bg-gradient-to-r from-cyan-600/20 to-teal-600/20 border-cyan-500/30'
                : 'bg-red-900/20 border-red-500/30'
            }`}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-cyan-600 rounded-lg">
                    <Wallet className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold text-white">Verification Wallet</p>
                    <p className="text-xs text-cyan-300/60">KYC & Verification Services</p>
                  </div>
                </div>
                {shadvalBalance.verification_success ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/20 text-green-400">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-sm font-medium">Active</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/20 text-red-400">
                    <XCircle className="w-4 h-4" />
                    <span className="text-sm font-medium">Error</span>
                  </div>
                )}
              </div>

              {shadvalBalance.verification_success ? (
                <div className="text-center p-3 bg-cyan-900/30 rounded-lg border border-cyan-500/30">
                  <p className="text-xs text-cyan-300 mb-1">Available Balance</p>
                  <p className="text-xl font-bold text-cyan-400">₹{shadvalBalance.verification_balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                </div>
              ) : (
                <p className="text-sm text-red-400">{shadvalBalance.verification_error || 'Failed to fetch verification balance'}</p>
              )}
            </div>

            {shadvalBalance.last_checked && (
              <p className="text-xs text-violet-300/50 text-right">
                Last updated: {new Date(shadvalBalance.last_checked).toLocaleString('en-IN')}
              </p>
            )}
          </div>
        ) : (
          <div className="text-center py-8">
            {shadvalLoading ? (
              <div className="flex flex-col items-center gap-3">
                <RefreshCw className="w-8 h-8 text-violet-400 animate-spin" />
                <p className="text-violet-300/70">Fetching SHADVAL PAY balance...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <AlertTriangle className="w-8 h-8 text-amber-400" />
                <p className="text-violet-300/70">Unable to fetch SHADVAL PAY balance</p>
                <button
                  onClick={fetchShadvalBalance}
                  className="mt-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-all"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>
        )}
      </motion.div>

      {/* eKYC Hub Balance & API Testing Card */}
      <EkycHubCard />

      {/* Reports & Analytics */}
      <ReportsTab />
    </div>
  )
}

// All services config
const ALL_SERVICES = [
  { key: 'banking_payments', label: 'Banking & Payments', icon: '🏦', short: 'Banking' },
  { key: 'mini_atm_pos', label: 'Mini-ATM, POS & WPOS', icon: '🏧', short: 'POS' },
  { key: 'aeps', label: 'AEPS Services', icon: '👆', short: 'AEPS' },
  { key: 'aadhaar_pay', label: 'Aadhaar Pay', icon: '💳', short: 'AadhaarPay' },
  { key: 'dmt', label: 'Domestic Money Transfer', icon: '💸', short: 'DMT' },
  { key: 'bbps', label: 'Utility Bill Payments (BBPS)', icon: '📄', short: 'BBPS' },
  { key: 'recharge', label: 'Mobile Recharge', icon: '📱', short: 'Recharge' },
  { key: 'travel', label: 'Travel Services', icon: '✈️', short: 'Travel' },
  { key: 'cash_management', label: 'Cash Management', icon: '💰', short: 'Cash' },
  { key: 'lic', label: 'LIC Bill Payment', icon: '🛡️', short: 'LIC' },
  { key: 'insurance', label: 'Insurance', icon: '🏥', short: 'Insurance' },
] as const

const SERVICE_FIELDS = ALL_SERVICES.map(s => `${s.key}_enabled`)

// Services Management Component with Permission Control
function ServicesManagementTab() {
  type ServiceSubTab = 'overview' | 'permissions'
  const { showToast } = useToast()
  const [subTab, setSubTab] = useState<ServiceSubTab>('permissions')
  const [services, setServices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [allUsers, setAllUsers] = useState<any[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | 'retailer' | 'distributor' | 'master_distributor'>('all')
  const [serviceFilter, setServiceFilter] = useState<string>('all')
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set())
  const [userPage, setUserPage] = useState(1)
  const [togglingUser, setTogglingUser] = useState<string | null>(null)
  const [bulkAction, setBulkAction] = useState(false)
  const [roleToggling, setRoleToggling] = useState<string | null>(null)
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean
    title: string
    message: string
    onConfirm: () => void
  }>({ open: false, title: '', message: '', onConfirm: () => {} })
  const usersPerPage = 15

  const [bbpsProviderBalance, setBbpsProviderBalance] = useState<{
    balance: number | null
    lien: number | null
    available: number | null
    loading: boolean
    error: string | null
    lastChecked: string | null
  }>({
    balance: null,
    lien: null,
    available: null,
    loading: true,
    error: null,
    lastChecked: null
  })

  const fetchBBPSProviderBalance = async () => {
    setBbpsProviderBalance(prev => ({ ...prev, loading: true, error: null }))
    try {
      const response = await apiFetch('/api/bbps/wallet-balance')
      const data = await response.json()
      if (data.success) {
        setBbpsProviderBalance({
          balance: data.balance || 0,
          lien: data.lien || 0,
          available: data.available_balance || (data.balance || 0) - (data.lien || 0),
          loading: false,
          error: null,
          lastChecked: data.last_checked || new Date().toISOString()
        })
      } else {
        setBbpsProviderBalance({ balance: null, lien: null, available: null, loading: false, error: data.error || 'Failed to fetch BBPS balance', lastChecked: new Date().toISOString() })
      }
    } catch (error: any) {
      setBbpsProviderBalance({ balance: null, lien: null, available: null, loading: false, error: error.message || 'Failed to fetch BBPS balance', lastChecked: new Date().toISOString() })
    }
  }

  const fetchServicesData = async () => {
    setLoading(true)
    try {
      const [bbpsData, aepsData, settlementData] = await Promise.all([
        supabase.from('bbps_transactions').select('bill_amount, created_at, status').eq('status', 'success'),
        supabase.from('aeps_transactions').select('amount, created_at, status').eq('status', 'success'),
        supabase.from('settlements').select('amount, created_at, status').eq('status', 'success')
      ])
      const bbpsTransactions = bbpsData.data || []
      const aepsTransactions = aepsData.data || []
      const settlementTransactions = settlementData.data || []
      const bbpsCount = bbpsTransactions.length
      const bbpsRevenue = bbpsTransactions.reduce((sum, t) => sum + parseFloat(t.bill_amount?.toString() || '0'), 0)
      const aepsCount = aepsTransactions.length
      const aepsRevenue = aepsTransactions.reduce((sum, t) => sum + parseFloat(t.amount?.toString() || '0'), 0)
      const settlementCount = settlementTransactions.length
      const settlementRevenue = settlementTransactions.reduce((sum, t) => sum + parseFloat(t.amount?.toString() || '0'), 0)
      setServices([
        { id: 'bbps', name: 'BBPS (Bill Payments)', icon: '📄', status: 'active', transactions: bbpsCount, revenue: `₹${bbpsRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` },
        { id: 'aeps', name: 'AEPS Services', icon: '👆', status: 'active', transactions: aepsCount, revenue: `₹${aepsRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` },
        { id: 'settlement', name: 'Settlement', icon: '💰', status: 'active', transactions: settlementCount, revenue: `₹${settlementRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` },
        { id: 'pos', name: 'POS Transactions', icon: '💳', status: 'active', transactions: 0, revenue: '₹0' },
      ])
    } catch (error) {
      console.error('Error fetching services data:', error)
      showToast('Failed to fetch services data', 'error')
      setServices([])
    } finally {
      setLoading(false)
    }
  }

  const fetchAllUsers = async () => {
    setUsersLoading(true)
    try {
      const kycFields = ', address, city, state, pincode, gst_number, pan_number, aadhar_number, bank_name, account_number, ifsc_code, udhyam_number, commission_rate, pan_verified, pan_registered_name, pan_type, bank_verified, bank_verified_name, bank_utr, bank_branch, bank_city, gst_verified, gst_legal_name, gst_trade_name, gst_status, gst_taxpayer_type, gst_constitution, gst_address, cin_number, cin_verified, cin_company_name, cin_status, cin_incorporation_date, aadhaar_verified, aadhaar_name, aadhaar_dob, aadhaar_gender, aadhaar_address, aadhaar_uid, digilocker_verification_id, ekychub_order_ids, auto_verification_score'
      const baseFields = 'partner_id, name, email, phone, business_name, status, created_at' + kycFields
      const partnerBaseFields = 'id, name, email, phone, business_name, status, created_at'
      const allFieldsList = SERVICE_FIELDS.join(', ')
      const serviceFields = `${baseFields}, ${allFieldsList}`
      const partnerServiceFields = `${partnerBaseFields}, ${allFieldsList}`

      const defaultServices: Record<string, boolean> = {}
      ALL_SERVICES.forEach(s => { defaultServices[`${s.key}_enabled`] = false })

      const fetchTable = async (table: string, role: string) => {
        const isPartner = role === 'partner'
        const fields = isPartner ? partnerServiceFields : serviceFields
        const fallbackFields = isPartner ? partnerBaseFields : baseFields
        
        const { data, error } = await supabase.from(table).select(fields).order('created_at', { ascending: false })
        if (error) {
          console.warn(`Service columns not found in ${table}, fetching without them:`, error.message)
          const { data: fallbackData } = await supabase.from(table).select(fallbackFields).order('created_at', { ascending: false })
          return (fallbackData || []).map(u => {
            // Partners use 'id' instead of 'partner_id', normalize to partner_id for consistency
            const partnerId = isPartner ? (u as any).id : (u as any).partner_id
            return { ...u, partner_id: partnerId, role, ...defaultServices }
          })
        }
        return (data || []).map(u => {
          // Partners use 'id' instead of 'partner_id', normalize to partner_id for consistency
          const partnerId = isPartner ? (u as any).id : (u as any).partner_id
          const user = { ...u, partner_id: partnerId, role }
          ALL_SERVICES.forEach(s => {
            const field = `${s.key}_enabled`
            user[field] = u[field] ?? false
          })
          return user
        })
      }

      const [retailers, distributors, mds, partners] = await Promise.all([
        fetchTable('retailers', 'retailer'),
        fetchTable('distributors', 'distributor'),
        fetchTable('master_distributors', 'master_distributor'),
        fetchTable('partners', 'partner'),
      ])

      setAllUsers([...retailers, ...distributors, ...mds, ...partners])
    } catch (error) {
      console.error('Error fetching users:', error)
      showToast('Failed to fetch users', 'error')
      setAllUsers([])
    } finally {
      setUsersLoading(false)
    }
  }

  useEffect(() => {
    fetchServicesData()
    fetchBBPSProviderBalance()
    fetchAllUsers()
    const interval = setInterval(fetchBBPSProviderBalance, 60000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    setUserPage(1)
    setSelectedUsers(new Set())
  }, [userSearch, roleFilter, serviceFilter])

  const handleToggleService = async (userId: string, userRole: string, serviceType: string, enabled: boolean) => {
    setTogglingUser(`${userId}-${serviceType}`)
    try {
      const response = await apiFetch('/api/admin/user/services/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, user_role: userRole, service_type: serviceType, enabled })
      })
      const data = await response.json()
      if (data.success) {
        setAllUsers(prev => prev.map(u => u.partner_id === userId ? { ...u, [`${serviceType}_enabled`]: enabled } : u))
        showToast(`${serviceType.toUpperCase()} ${enabled ? 'enabled' : 'disabled'} successfully`, 'success')
      } else {
        showToast(data.error || 'Failed to toggle service', 'error')
      }
    } catch {
      showToast('Failed to toggle service', 'error')
    } finally {
      setTogglingUser(null)
    }
  }

  const handleRoleToggle = async (userRole: string, serviceType: string, enabled: boolean) => {
    const roleLabel = userRole.replace('_', ' ')
    setConfirmModal({
      open: true,
      title: `${enabled ? 'Enable' : 'Disable'} ${serviceType.toUpperCase()} for all ${roleLabel}s?`,
      message: `This will ${enabled ? 'enable' : 'disable'} ${serviceType.toUpperCase()} for every ${roleLabel} in the system. This action can be reversed.`,
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, open: false }))
        setRoleToggling(`${userRole}-${serviceType}`)
        try {
          const response = await apiFetch('/api/admin/user/services/role-toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_role: userRole, service_type: serviceType, enabled })
          })
          const data = await response.json()
          if (data.success) {
            setAllUsers(prev => prev.map(u => u.role === userRole ? { ...u, [`${serviceType}_enabled`]: enabled } : u))
            showToast(data.message, 'success')
          } else {
            showToast(data.error || 'Failed to toggle service', 'error')
          }
        } catch {
          showToast('Failed to toggle service by role', 'error')
        } finally {
          setRoleToggling(null)
        }
      }
    })
  }

  const handleBulkToggle = async (serviceType: string, enabled: boolean) => {
    if (selectedUsers.size === 0) return
    const usersToToggle = allUsers.filter(u => selectedUsers.has(u.partner_id)).map(u => ({ user_id: u.partner_id, user_role: u.role }))
    setConfirmModal({
      open: true,
      title: `${enabled ? 'Enable' : 'Disable'} ${serviceType.toUpperCase()} for ${usersToToggle.length} selected users?`,
      message: `This will ${enabled ? 'enable' : 'disable'} ${serviceType.toUpperCase()} for the selected users.`,
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, open: false }))
        setBulkAction(true)
        try {
          const response = await apiFetch('/api/admin/user/services/bulk-toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ users: usersToToggle, service_type: serviceType, enabled })
          })
          const data = await response.json()
          if (data.success) {
            const successIds = new Set(data.results.filter((r: any) => r.success).map((r: any) => r.user_id))
            setAllUsers(prev => prev.map(u => successIds.has(u.partner_id) ? { ...u, [`${serviceType}_enabled`]: enabled } : u))
            showToast(data.message, 'success')
            setSelectedUsers(new Set())
          } else {
            showToast(data.error || 'Bulk toggle failed', 'error')
          }
        } catch {
          showToast('Bulk toggle failed', 'error')
        } finally {
          setBulkAction(false)
        }
      }
    })
  }

  const filteredUsers = useMemo(() => {
    return allUsers.filter(u => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false
      if (serviceFilter !== 'all') {
        const match = serviceFilter.match(/^(.+)_(enabled|disabled)$/)
        if (match) {
          const field = `${match[1]}_enabled`
          const wantEnabled = match[2] === 'enabled'
          if (wantEnabled && !u[field]) return false
          if (!wantEnabled && u[field]) return false
        }
      }
      if (userSearch) {
        const q = userSearch.toLowerCase()
        return (u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || u.partner_id?.toLowerCase().includes(q) || u.business_name?.toLowerCase().includes(q) || u.phone?.includes(q))
      }
      return true
    })
  }, [allUsers, roleFilter, serviceFilter, userSearch])

  const totalUserPages = Math.ceil(filteredUsers.length / usersPerPage)
  const paginatedUsers = filteredUsers.slice((userPage - 1) * usersPerPage, userPage * usersPerPage)

  const roleCounts = useMemo(() => {
    const counts: Record<string, { total: number; services: Record<string, number> }> = {
      retailer: { total: 0, services: {} },
      distributor: { total: 0, services: {} },
      master_distributor: { total: 0, services: {} },
      partner: { total: 0, services: {} },
    }
    ALL_SERVICES.forEach(s => {
      counts.retailer.services[s.key] = 0
      counts.distributor.services[s.key] = 0
      counts.master_distributor.services[s.key] = 0
      counts.partner.services[s.key] = 0
    })
    allUsers.forEach(u => {
      if (counts[u.role]) {
        counts[u.role].total++
        ALL_SERVICES.forEach(s => {
          if (u[`${s.key}_enabled`]) counts[u.role].services[s.key]++
        })
      }
    })
    return counts
  }, [allUsers])

  const toggleSelectAll = () => {
    if (selectedUsers.size === paginatedUsers.length) {
      setSelectedUsers(new Set())
    } else {
      setSelectedUsers(new Set(paginatedUsers.map(u => u.partner_id)))
    }
  }

  const toggleSelectUser = (partnerId: string) => {
    setSelectedUsers(prev => {
      const next = new Set(prev)
      if (next.has(partnerId)) next.delete(partnerId)
      else next.add(partnerId)
      return next
    })
  }

  const roleLabel = (role: string) => {
    switch (role) {
      case 'retailer': return 'Retailer'
      case 'distributor': return 'Distributor'
      case 'master_distributor': return 'Master Distributor'
      case 'partner': return 'Partner'
      default: return role
    }
  }

  const roleBadgeColor = (role: string) => {
    switch (role) {
      case 'retailer': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
      case 'distributor': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400'
      case 'master_distributor': return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
      case 'partner': return 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400'
      default: return 'bg-gray-100 text-gray-800'
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmModal.open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={() => setConfirmModal(prev => ({ ...prev, open: false }))}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 max-w-md w-full"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">{confirmModal.title}</h3>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">{confirmModal.message}</p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setConfirmModal(prev => ({ ...prev, open: false }))}
                  className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmModal.onConfirm}
                  className="px-4 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition-colors"
                >
                  Confirm
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sub-tab Navigation */}
      <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 pb-2">
        {[
          { id: 'permissions' as ServiceSubTab, label: 'Permission Control', icon: Shield },
          { id: 'overview' as ServiceSubTab, label: 'Service Overview', icon: Activity },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setSubTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              subTab === tab.id
                ? 'bg-gradient-to-r from-primary-500 to-secondary-500 text-white shadow-md'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {subTab === 'overview' ? (
        <ServiceOverviewPanel services={services} bbpsProviderBalance={bbpsProviderBalance} onRefreshBalance={fetchBBPSProviderBalance} />
      ) : (
        <>
          {/* Role-wise Service Activation */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
              <Crown className="w-4 h-4 text-amber-500" />
              Role-wise Service Activation
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              {(['retailer', 'distributor', 'master_distributor', 'partner'] as const).map((role) => {
                const counts = roleCounts[role]
                const roleIcons: Record<string, any> = { retailer: Users, distributor: Package, master_distributor: Crown, partner: Shield }
                const RoleIcon = roleIcons[role]
                const gradients: Record<string, string> = {
                  retailer: 'from-blue-500 to-blue-600',
                  distributor: 'from-purple-500 to-purple-600',
                  master_distributor: 'from-amber-500 to-amber-600',
                  partner: 'from-pink-500 to-pink-600',
                }
                return (
                  <motion.div
                    key={role}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden"
                  >
                    <div className={`bg-gradient-to-r ${gradients[role]} px-4 py-3 flex items-center gap-2`}>
                      <RoleIcon className="w-4 h-4 text-white" />
                      <span className="text-sm font-semibold text-white">{roleLabel(role)}s</span>
                      <span className="ml-auto text-xs text-white/80">{counts.total} users</span>
                    </div>
                    <div className="p-3 space-y-2 max-h-[400px] overflow-y-auto">
                      {ALL_SERVICES.map(service => {
                        const enabledCount = counts.services[service.key] || 0
                        const toggleKey = `${role}-${service.key}`
                        return (
                          <div key={service.key} className="flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm">{service.icon}</span>
                                <span className="text-xs font-medium text-gray-900 dark:text-white truncate">{service.short}</span>
                                <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-auto mr-1">
                                  {enabledCount}/{counts.total}
                                </span>
                              </div>
                              <div className="mt-0.5 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-green-500 rounded-full transition-all duration-500"
                                  style={{ width: counts.total > 0 ? `${(enabledCount / counts.total) * 100}%` : '0%' }}
                                />
                              </div>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <button
                                disabled={roleToggling === toggleKey}
                                onClick={() => handleRoleToggle(role, service.key, true)}
                                className="px-1.5 py-0.5 text-[10px] rounded bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors disabled:opacity-50"
                              >
                                {roleToggling === toggleKey ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : 'On'}
                              </button>
                              <button
                                disabled={roleToggling === toggleKey}
                                onClick={() => handleRoleToggle(role, service.key, false)}
                                className="px-1.5 py-0.5 text-[10px] rounded bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors disabled:opacity-50"
                              >
                                Off
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </motion.div>

          {/* User-wise Service Control */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700"
          >
            {/* Header + Search */}
            <div className="p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary-500" />
                  User-wise Service Control
                  <span className="text-xs font-normal text-gray-500 dark:text-gray-400">({filteredUsers.length} users)</span>
                </h3>
                <div className="flex-1" />
                <button
                  onClick={() => { fetchAllUsers() }}
                  disabled={usersLoading}
                  className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${usersLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 mt-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search by name, email, ID, phone..."
                    value={userSearch}
                    onChange={e => setUserSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
                <select
                  value={roleFilter}
                  onChange={e => setRoleFilter(e.target.value as any)}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500"
                >
                  <option value="all">All Roles</option>
                  <option value="retailer">Retailers</option>
                  <option value="distributor">Distributors</option>
                  <option value="master_distributor">Master Distributors</option>
                  <option value="partner">Partners</option>
                </select>
                <select
                  value={serviceFilter}
                  onChange={e => setServiceFilter(e.target.value)}
                  className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500"
                >
                  <option value="all">All Services</option>
                  {ALL_SERVICES.map(s => (
                    <optgroup key={s.key} label={`${s.icon} ${s.short}`}>
                      <option value={`${s.key}_enabled`}>{s.short} Enabled</option>
                      <option value={`${s.key}_disabled`}>{s.short} Disabled</option>
                    </optgroup>
                  ))}
                </select>
              </div>
            </div>

            {/* Bulk Action Bar */}
            <AnimatePresence>
              {selectedUsers.size > 0 && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 py-3 bg-primary-50 dark:bg-primary-900/20 border-b border-primary-200 dark:border-primary-800">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="text-xs font-medium text-primary-700 dark:text-primary-300">
                        {selectedUsers.size} user{selectedUsers.size > 1 ? 's' : ''} selected
                      </span>
                      <div className="h-4 w-px bg-primary-300 dark:bg-primary-600" />
                      <select
                        id="bulk-service-select"
                        defaultValue="aeps"
                        className="px-2 py-1 text-xs border border-primary-300 dark:border-primary-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      >
                        {ALL_SERVICES.map(s => (
                          <option key={s.key} value={s.key}>{s.icon} {s.short}</option>
                        ))}
                      </select>
                      <button disabled={bulkAction}
                        onClick={() => {
                          const sel = (document.getElementById('bulk-service-select') as HTMLSelectElement)?.value || 'aeps'
                          handleBulkToggle(sel as any, true)
                        }}
                        className="px-2.5 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center gap-1"
                      >
                        {bulkAction ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                        Enable
                      </button>
                      <button disabled={bulkAction}
                        onClick={() => {
                          const sel = (document.getElementById('bulk-service-select') as HTMLSelectElement)?.value || 'aeps'
                          handleBulkToggle(sel as any, false)
                        }}
                        className="px-2.5 py-1 text-xs rounded bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center gap-1"
                      >
                        <X className="w-3 h-3" /> Disable
                      </button>
                      <button onClick={() => setSelectedUsers(new Set())}
                        className="ml-auto px-2.5 py-1 text-xs rounded border border-primary-300 dark:border-primary-600 text-primary-700 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/40 transition-colors"
                      >
                        Clear Selection
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Users Table */}
            {usersLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-600"></div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: '900px' }}>
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                      <th className="px-3 py-3 text-left w-8">
                        <input
                          type="checkbox"
                          checked={paginatedUsers.length > 0 && selectedUsers.size === paginatedUsers.length}
                          onChange={toggleSelectAll}
                          className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                        />
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">User</th>
                      <th className="px-2 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Role</th>
                      {ALL_SERVICES.map(s => (
                        <th key={s.key} className="px-1 py-3 text-center text-[10px] font-semibold text-gray-600 dark:text-gray-400 uppercase" title={s.label}>
                          <div className="flex flex-col items-center gap-0.5">
                            <span>{s.icon}</span>
                            <span className="leading-tight">{s.short}</span>
                          </div>
                        </th>
                      ))}
                      <th className="px-2 py-3 text-center text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {paginatedUsers.length === 0 ? (
                      <tr>
                        <td colSpan={3 + ALL_SERVICES.length + 1} className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                          No users found matching your filters.
                        </td>
                      </tr>
                    ) : paginatedUsers.map(user => (
                      <tr key={user.partner_id} className={`hover:bg-gray-50 dark:hover:bg-gray-900/30 transition-colors ${selectedUsers.has(user.partner_id) ? 'bg-primary-50/50 dark:bg-primary-900/10' : ''}`}>
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={selectedUsers.has(user.partner_id)}
                            onChange={() => toggleSelectUser(user.partner_id)}
                            className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-gray-900 dark:text-white text-xs">{user.name}</p>
                          <p className="text-[10px] text-gray-500 dark:text-gray-400">{user.email}</p>
                        </td>
                        <td className="px-2 py-2.5">
                          <span className={`inline-block px-1.5 py-0.5 text-[10px] rounded-full font-medium ${roleBadgeColor(user.role)}`}>
                            {roleLabel(user.role)}
                          </span>
                        </td>
                        {ALL_SERVICES.map(s => {
                          const field = `${s.key}_enabled`
                          const isEnabled = user[field]
                          const isToggling = togglingUser === `${user.partner_id}-${s.key}`
                          return (
                            <td key={s.key} className="px-1 py-2.5 text-center">
                              <button
                                disabled={isToggling}
                                onClick={() => handleToggleService(user.partner_id, user.role, s.key, !isEnabled)}
                                className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
                                  isEnabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
                                }`}
                                title={`${s.label}: ${isEnabled ? 'Enabled' : 'Disabled'}`}
                              >
                                <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform duration-200 ${
                                  isEnabled ? 'translate-x-3' : 'translate-x-0.5'
                                }`} />
                              </button>
                            </td>
                          )
                        })}
                        <td className="px-2 py-2.5 text-center">
                          <span className={`inline-block px-1.5 py-0.5 text-[10px] rounded-full font-medium ${
                            user.status === 'active' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                            user.status === 'suspended' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                            'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                          }`}>{user.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {totalUserPages > 1 && (
              <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Showing {((userPage - 1) * usersPerPage) + 1}-{Math.min(userPage * usersPerPage, filteredUsers.length)} of {filteredUsers.length}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setUserPage(p => Math.max(1, p - 1))}
                    disabled={userPage === 1}
                    className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  {Array.from({ length: Math.min(5, totalUserPages) }, (_, i) => {
                    let page: number
                    if (totalUserPages <= 5) {
                      page = i + 1
                    } else if (userPage <= 3) {
                      page = i + 1
                    } else if (userPage >= totalUserPages - 2) {
                      page = totalUserPages - 4 + i
                    } else {
                      page = userPage - 2 + i
                    }
                    return (
                      <button
                        key={page}
                        onClick={() => setUserPage(page)}
                        className={`w-8 h-8 text-xs rounded-lg transition-colors ${
                          userPage === page
                            ? 'bg-primary-600 text-white'
                            : 'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                        }`}
                      >
                        {page}
                      </button>
                    )
                  })}
                  <button
                    onClick={() => setUserPage(p => Math.min(totalUserPages, p + 1))}
                    disabled={userPage === totalUserPages}
                    className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </div>
  )
}

function ServiceOverviewPanel({ services, bbpsProviderBalance, onRefreshBalance }: {
  services: any[]
  bbpsProviderBalance: { balance: number | null; lien: number | null; available: number | null; loading: boolean; error: string | null; lastChecked: string | null }
  onRefreshBalance: () => void
}) {
  return (
    <>
      {/* BBPS Provider Balance */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg shadow-md p-4 text-white"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Wallet className="w-4 h-4" />
            BBPS Provider Balance (SparkUpTech)
          </h3>
          <button onClick={onRefreshBalance} disabled={bbpsProviderBalance.loading}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${bbpsProviderBalance.loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {bbpsProviderBalance.error ? (
          <p className="text-xs text-red-200">{bbpsProviderBalance.error}</p>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-blue-200">Total Balance</p>
              <p className="text-xl font-bold">₹{(bbpsProviderBalance.balance || 0).toLocaleString('en-IN')}</p>
            </div>
            <div>
              <p className="text-xs text-blue-200">Lien Amount</p>
              <p className="text-xl font-bold">₹{(bbpsProviderBalance.lien || 0).toLocaleString('en-IN')}</p>
            </div>
            <div>
              <p className="text-xs text-blue-200">Available</p>
              <p className="text-xl font-bold text-green-300">₹{(bbpsProviderBalance.available || 0).toLocaleString('en-IN')}</p>
            </div>
          </div>
        )}
        {bbpsProviderBalance.lastChecked && (
          <p className="text-xs text-blue-200 mt-2">Last checked: {new Date(bbpsProviderBalance.lastChecked).toLocaleString('en-IN')}</p>
        )}
      </motion.div>

      {/* All 11 Services Grid */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3"
      >
        {ALL_SERVICES.map((service, idx) => {
          const matchedService = services.find(s => s.id === service.key)
          return (
            <motion.div key={service.key} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: idx * 0.03 }}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-3 hover:shadow-lg transition-shadow"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">{service.icon}</span>
                <div className="flex-1 min-w-0">
                  <h3 className="text-xs font-semibold text-gray-900 dark:text-white truncate">{service.label}</h3>
                  <span className="inline-block mt-0.5 px-1.5 py-0.5 text-[10px] rounded-full bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">active</span>
                </div>
              </div>
              {matchedService ? (
                <div className="space-y-1 pt-2 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500 dark:text-gray-400">Txns</span>
                    <span className="font-semibold text-gray-900 dark:text-white">{matchedService.transactions.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500 dark:text-gray-400">Revenue</span>
                    <span className="font-semibold text-green-600 dark:text-green-400">{matchedService.revenue}</span>
                  </div>
                </div>
              ) : (
                <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 italic">Coming soon</p>
                </div>
              )}
            </motion.div>
          )
        })}
      </motion.div>

      {/* Summary Stats */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-3 sm:p-4"
      >
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Platform Statistics</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          <div className="p-3 bg-gray-50 dark:bg-gray-900/30 rounded-lg">
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Total Services</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{ALL_SERVICES.length}</p>
          </div>
          <div className="p-3 bg-green-50 dark:bg-green-900/10 rounded-lg">
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Active (with data)</p>
            <p className="text-xl font-bold text-green-600 dark:text-green-400">{services.filter(s => s.transactions > 0).length}</p>
          </div>
          <div className="p-3 bg-blue-50 dark:bg-blue-900/10 rounded-lg">
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Total Transactions</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{services.reduce((sum, s) => sum + s.transactions, 0).toLocaleString()}</p>
          </div>
          <div className="p-3 bg-amber-50 dark:bg-amber-900/10 rounded-lg">
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Total Revenue</p>
            <p className="text-xl font-bold text-green-600 dark:text-green-400">
              ₹{services.reduce((sum, s) => {
                const revenueStr = s.revenue.replace('₹', '').replace(/,/g, '')
                return sum + parseFloat(revenueStr || '0')
              }, 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </p>
          </div>
        </div>
      </motion.div>
    </>
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
  const { showToast } = useToast()
  const [currentStep, setCurrentStep] = useState(1) // 1: Basic Details, 2: Documents (only for new partners)
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
    status: 'inactive' as 'active' | 'inactive' | 'suspended' | 'pending_verification',
    commission_rate: '',
    bank_name: '',
    account_number: '',
    ifsc_code: '',
    aadhar_number: '',
    pan_number: '',
    udhyam_applicable: false,
    udhyam_number: '',
    gst_applicable: false,
    cin_applicable: false,
    cin_number: '',
  })
  const [loading, setLoading] = useState(false)
  const [showFormPassword, setShowFormPassword] = useState(false)
  const [masterDistributors, setMasterDistributors] = useState<any[]>([])
  const [distributors, setDistributors] = useState<any[]>([])
  const [loadingParents, setLoadingParents] = useState(false)

  const [panVerified, setPanVerified] = useState(false)
  const [panRegisteredName, setPanRegisteredName] = useState('')
  const [panType, setPanType] = useState('')
  const [verifyingPan, setVerifyingPan] = useState(false)
  const [panError, setPanError] = useState('')

  const [bankVerified, setBankVerified] = useState(false)
  const [bankVerifiedName, setBankVerifiedName] = useState('')
  const [bankUtr, setBankUtr] = useState('')
  const [verifyingBank, setVerifyingBank] = useState(false)
  const [bankError, setBankError] = useState('')
  const [bankNameMismatch, setBankNameMismatch] = useState('')

  const [gstVerified, setGstVerified] = useState(false)
  const [gstLegalName, setGstLegalName] = useState('')
  const [gstTradeName, setGstTradeName] = useState('')
  const [gstGstStatus, setGstGstStatus] = useState('')
  const [gstTaxpayerType, setGstTaxpayerType] = useState('')
  const [gstConstitution, setGstConstitution] = useState('')
  const [gstAddress, setGstAddress] = useState('')
  const [verifyingGst, setVerifyingGst] = useState(false)
  const [gstError, setGstError] = useState('')

  const [cinVerified, setCinVerified] = useState(false)
  const [cinCompanyName, setCinCompanyName] = useState('')
  const [cinStatus, setCinStatus] = useState('')
  const [cinIncorporationDate, setCinIncorporationDate] = useState('')
  const [verifyingCin, setVerifyingCin] = useState(false)
  const [cinError, setCinError] = useState('')

  const [aadhaarVerified, setAadhaarVerified] = useState(false)
  const [aadhaarName, setAadhaarName] = useState('')
  const [aadhaarGender, setAadhaarGender] = useState('')
  const [aadhaarDob, setAadhaarDob] = useState('')
  const [aadhaarAddress, setAadhaarAddress] = useState('')
  const [aadhaarUid, setAadhaarUid] = useState('')
  const [digilockerLoading, setDigilockerLoading] = useState(false)
  const [digilockerError, setDigilockerError] = useState('')
  const [digilockerUrl, setDigilockerUrl] = useState('')
  const [digilockerVerificationId, setDigilockerVerificationId] = useState('')

  const [ekychubOrderIds, setEkychubOrderIds] = useState<Record<string, string>>({})

  useEffect(() => {
    if (gstVerified && (gstTradeName || gstLegalName)) {
      setFormData(prev => ({
        ...prev,
        business_name: gstTradeName || gstLegalName,
        address: gstAddress || prev.address,
      }))
    }
  }, [gstVerified, gstTradeName, gstLegalName, gstAddress])

  useEffect(() => {
    if (aadhaarVerified && aadhaarAddress && !formData.gst_applicable) {
      setFormData(prev => ({
        ...prev,
        address: aadhaarAddress || prev.address,
      }))
    }
  }, [aadhaarVerified, aadhaarAddress])

  // Helper to get auth token for uploads (fallback for cookie issues)
  const getAuthToken = async (): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token || null
  }

  // Fetch parent entities based on type
  useEffect(() => {
    const fetchParents = async () => {
      setLoadingParents(true)
      try {
        if (type === 'distributors' || type === 'retailers') {
          // Fetch master distributors - include all for editing (so existing MD shows up even if inactive)
          const { data, error } = await supabase
            .from('master_distributors')
            .select('id, partner_id, name, email, status')
            .order('name', { ascending: true })
          
          if (error) throw error
          setMasterDistributors(data || [])
        }

        if (type === 'retailers') {
          // Fetch distributors - include all for editing (so existing distributor shows up even if inactive)
          const { data, error } = await supabase
            .from('distributors')
            .select('id, partner_id, name, email, status, master_distributor_id')
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
  // Only clear distributor_id if distributors have been loaded (not during initial loading)
  const [parentsLoaded, setParentsLoaded] = useState(false)
  useEffect(() => {
    if (!loadingParents && distributors.length >= 0) {
      // Small delay to ensure parents are fully loaded before allowing clears
      setParentsLoaded(!loadingParents && (distributors.length > 0 || type !== 'retailers'))
    }
  }, [loadingParents, distributors, type])

  useEffect(() => {
    if (type === 'retailers' && formData.master_distributor_id && parentsLoaded) {
      const filtered = distributors.filter(
        (d: any) => d.master_distributor_id === formData.master_distributor_id
      )
      // If distributor was selected but doesn't match master, clear it
      // But only if user manually changed the master distributor (not initial load)
      if (formData.distributor_id && !filtered.find((d: any) => d.partner_id === formData.distributor_id)) {
        // Check if this is an edit and the distributor_id matches the original item
        // Don't clear if it's the original value (distributor might be inactive but still valid)
        if (!item || formData.distributor_id !== (item.distributor_id || '')) {
          setFormData(prev => ({ ...prev, distributor_id: '' }))
        }
      }
    }
  }, [formData.master_distributor_id, type, distributors, parentsLoaded])

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
        status: item.status || 'inactive',
        commission_rate: item.commission_rate?.toString() || '',
        bank_name: item.bank_name || '',
        account_number: item.account_number || '',
        ifsc_code: item.ifsc_code || '',
        aadhar_number: item.aadhar_number || '',
        pan_number: item.pan_number || '',
        udhyam_applicable: !!(item.udhyam_number),
        udhyam_number: item.udhyam_number || '',
        gst_applicable: !!(item.gst_number),
        cin_applicable: !!(item.cin_number),
        cin_number: item.cin_number || '',
      })
      setPanVerified(item.pan_verified || false)
      setPanRegisteredName(item.pan_registered_name || '')
      setPanType(item.pan_type || '')
      setBankVerified(item.bank_verified || false)
      setBankVerifiedName(item.bank_verified_name || '')
      setBankUtr(item.bank_utr || '')
      setGstVerified(item.gst_verified || false)
      setGstLegalName(item.gst_legal_name || '')
      setGstTradeName(item.gst_trade_name || '')
      setGstGstStatus(item.gst_status || '')
      setGstTaxpayerType(item.gst_taxpayer_type || '')
      setGstConstitution(item.gst_constitution || '')
      setGstAddress(item.gst_address || '')
      setPanError(''); setBankError(''); setGstError('')
      setEkychubOrderIds(item.ekychub_order_ids || {})
      setCurrentStep(1)
    } else {
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
        status: 'pending_verification' as 'active' | 'inactive' | 'suspended' | 'pending_verification',
        commission_rate: '',
        bank_name: '',
        account_number: '',
        ifsc_code: '',
        aadhar_number: '',
        pan_number: '',
        udhyam_applicable: false,
        udhyam_number: '',
        gst_applicable: false,
        cin_applicable: false,
        cin_number: '',
      })
      setPanVerified(false); setPanRegisteredName(''); setPanType('')
      setBankVerified(false); setBankVerifiedName(''); setBankUtr('')
      setGstVerified(false); setGstLegalName(''); setGstTradeName('')
      setGstGstStatus(''); setGstTaxpayerType(''); setGstConstitution(''); setGstAddress('')
      setPanError(''); setBankError(''); setGstError('')
      setEkychubOrderIds({})
      setCurrentStep(1)
    }
  }, [item])

  const generatePartnerId = () => {
    const prefix = type === 'retailers' ? 'RET' : type === 'distributors' ? 'DIS' : 'MD'
    return `${prefix}${Date.now().toString().slice(-8)}`
  }

  const handleVerifyPan = async () => {
    if (!formData.pan_number || !/^[A-Z]{5}\d{4}[A-Z]$/.test(formData.pan_number.toUpperCase())) {
      setPanError('Enter valid 10-character PAN')
      return
    }
    setVerifyingPan(true)
    setPanError('')
    try {
      const res = await apiFetch('/api/kyc/verify-pan', {
        method: 'POST',
        body: JSON.stringify({ pan: formData.pan_number.toUpperCase() })
      })
      const data = await res.json()
      if (data.success) {
        setPanVerified(true)
        setPanRegisteredName(data.data.registered_name || '')
        setPanType(data.data.type || '')
        setEkychubOrderIds(prev => ({ ...prev, pan: data.orderid }))
      } else {
        setPanError(data.error || 'PAN verification failed')
        setPanVerified(false)
      }
    } catch (err: any) {
      setPanError(err.message || 'PAN verification failed')
      setPanVerified(false)
    } finally {
      setVerifyingPan(false)
    }
  }

  const fuzzyNameMatch = (name1: string, name2: string): boolean => {
    if (!name1 || !name2) return false
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
    const n1 = normalize(name1), n2 = normalize(name2)
    if (n1 === n2) return true
    if (n1.includes(n2) || n2.includes(n1)) return true
    const words1 = n1.split(' '), words2 = n2.split(' ')
    const common = words1.filter(w => w.length > 1 && words2.includes(w))
    return common.length >= Math.min(2, Math.min(words1.length, words2.length))
  }

  const handleVerifyBank = async () => {
    if (!formData.account_number || !formData.ifsc_code) {
      setBankError('Account number and IFSC code required')
      return
    }
    setVerifyingBank(true)
    setBankError('')
    setBankNameMismatch('')
    try {
      const res = await apiFetch('/api/kyc/verify-bank', {
        method: 'POST',
        body: JSON.stringify({ account_number: formData.account_number, ifsc: formData.ifsc_code.toUpperCase() })
      })
      const data = await res.json()
      if (data.success) {
        setBankVerified(true)
        const holderName = data.data.nameAtBank || ''
        setBankVerifiedName(holderName)
        setBankUtr(data.data.utr || '')
        setEkychubOrderIds(prev => ({ ...prev, bank: data.orderid }))
        if (holderName) {
          const matchesBusiness = fuzzyNameMatch(holderName, formData.business_name)
          const matchesAadhaar = fuzzyNameMatch(holderName, aadhaarName)
          if (!matchesBusiness && !matchesAadhaar) {
            setBankNameMismatch(`Account holder name "${holderName}" does not match Business Name "${formData.business_name}"${aadhaarName ? ` or Aadhaar Name "${aadhaarName}"` : ''}. Please verify the correct bank account.`)
            setBankVerified(false)
          }
        }
      } else {
        setBankError(data.error || 'Bank verification failed')
        setBankVerified(false)
      }
    } catch (err: any) {
      setBankError(err.message || 'Bank verification failed')
      setBankVerified(false)
    } finally {
      setVerifyingBank(false)
    }
  }

  const handleVerifyGst = async () => {
    if (!formData.gst_number || formData.gst_number.length < 15) {
      setGstError('Enter valid GST number')
      return
    }
    setVerifyingGst(true)
    setGstError('')
    try {
      const res = await apiFetch('/api/kyc/verify-gst', {
        method: 'POST',
        body: JSON.stringify({ gst: formData.gst_number.toUpperCase() })
      })
      const data = await res.json()
      if (data.success) {
        setGstVerified(true)
        setGstLegalName(data.data.legal_name || '')
        setGstTradeName(data.data.trade_name || '')
        setGstGstStatus(data.data.status || '')
        setGstTaxpayerType(data.data.taxpayer_type || '')
        setGstConstitution(data.data.constitution || '')
        setGstAddress(data.data.address || '')
        setEkychubOrderIds(prev => ({ ...prev, gst: data.orderid }))
      } else {
        setGstError(data.error || 'GST verification failed')
        setGstVerified(false)
      }
    } catch (err: any) {
      setGstError(err.message || 'GST verification failed')
      setGstVerified(false)
    } finally {
      setVerifyingGst(false)
    }
  }

  const handleVerifyCin = async () => {
    if (!formData.cin_number || formData.cin_number.length < 10) {
      setCinError('Enter valid CIN number')
      return
    }
    setVerifyingCin(true)
    setCinError('')
    try {
      const res = await apiFetch('/api/kyc/verify-cin', {
        method: 'POST',
        body: JSON.stringify({ cin: formData.cin_number.toUpperCase() })
      })
      const data = await res.json()
      if (data.success) {
        setCinVerified(true)
        setCinCompanyName(data.data.company_name || '')
        setCinStatus(data.data.cin_status || '')
        setCinIncorporationDate(data.data.incorporation_date || '')
        setEkychubOrderIds(prev => ({ ...prev, cin: data.orderid }))
      } else {
        setCinError(data.error || 'CIN verification failed')
        setCinVerified(false)
      }
    } catch (err: any) {
      setCinError(err.message || 'CIN verification failed')
      setCinVerified(false)
    } finally {
      setVerifyingCin(false)
    }
  }

  const handleDigilockerAadhaar = async () => {
    setDigilockerLoading(true)
    setDigilockerError('')
    setDigilockerUrl('')
    try {
      const res = await apiFetch('/api/kyc/verify-digilocker', {
        method: 'POST',
        body: JSON.stringify({ type: 'aadhaar' })
      })
      const data = await res.json()
      if (data.success && data.data.url) {
        setDigilockerUrl(data.data.url)
        setDigilockerVerificationId(data.data.verification_id || '')
        setEkychubOrderIds(prev => ({ ...prev, digilocker_aadhaar: data.orderid }))
        window.open(data.data.url, '_blank')
      } else {
        setDigilockerError(data.error || 'Failed to generate Digilocker URL')
      }
    } catch (err: any) {
      setDigilockerError(err.message || 'Digilocker verification failed')
    } finally {
      setDigilockerLoading(false)
    }
  }

  const fetchDigilockerDocument = async (verification_id: string, reference_id: string) => {
    try {
      const res = await apiFetch('/api/kyc/fetch-digilocker-document', {
        method: 'POST',
        body: JSON.stringify({ verification_id, reference_id, document_type: 'AADHAAR' })
      })
      const data = await res.json()
      if (data.success && data.data) {
        const d = data.data
        setAadhaarVerified(true)
        setAadhaarName(d.name || '')
        setAadhaarUid(d.uid || '')
        setAadhaarDob(d.dob || '')
        setAadhaarGender(d.gender || '')
        setAadhaarAddress(d.address || '')
        if (d.verification_id) setDigilockerVerificationId(d.verification_id)
        if (d.uid) setFormData(prev => ({ ...prev, aadhar_number: d.uid.replace(/\s/g, '') }))
      } else {
        setDigilockerError(data.error || 'Failed to fetch Aadhaar data')
      }
    } catch (err: any) {
      setDigilockerError(err.message || 'Failed to fetch Aadhaar data')
    }
  }

  const handleDigilockerResult = (result: any) => {
    if (result.success && result.data) {
      if (result.pending) {
        const d = result.data
        if (d.verification_id) setDigilockerVerificationId(d.verification_id)
        fetchDigilockerDocument(d.verification_id, d.reference_id || d.verification_id)
      } else {
        const d = result.data
        setAadhaarVerified(true)
        setAadhaarName(d.name || '')
        setAadhaarUid(d.uid || '')
        setAadhaarDob(d.dob || '')
        setAadhaarGender(d.gender || '')
        setAadhaarAddress(d.address || '')
        if (d.verification_id) setDigilockerVerificationId(d.verification_id)
        if (d.uid) setFormData(prev => ({ ...prev, aadhar_number: d.uid.replace(/\s/g, '') }))
      }
    } else if (result.error) {
      setDigilockerError(result.error)
    }
  }

  useEffect(() => {
    const handleDigilockerMessage = (event: MessageEvent) => {
      if (event.data?.type === 'DIGILOCKER_RESULT') {
        handleDigilockerResult(event.data)
      }
    }

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === 'digilocker_result' && event.newValue) {
        try {
          const result = JSON.parse(event.newValue)
          handleDigilockerResult(result)
          localStorage.removeItem('digilocker_result')
        } catch (e) {}
      }
    }

    window.addEventListener('message', handleDigilockerMessage)
    window.addEventListener('storage', handleStorageChange)
    return () => {
      window.removeEventListener('message', handleDigilockerMessage)
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [])

  const handleStep1Next = (e: React.FormEvent) => {
    e.preventDefault()
    // Validate basic fields
    if (!formData.name || !formData.email || !formData.phone || (!item && !formData.password)) {
      showToast('Please fill all required fields', 'error')
      return
    }
    if (type === 'distributors' && !formData.master_distributor_id) {
      showToast('Master Distributor is required to create a Distributor', 'error')
      return
    }
    if (type === 'retailers') {
      if (!formData.distributor_id) {
        showToast('Distributor is required to create a Retailer', 'error')
        return
      }
      if (!formData.master_distributor_id) {
        showToast('Master Distributor is required to create a Retailer', 'error')
        return
      }
    }
    setCurrentStep(2)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!item) {
      if (!panVerified) {
        showToast('PAN verification is mandatory', 'error')
        return
      }
      if (!aadhaarVerified) {
        showToast('Aadhaar verification via Digilocker is mandatory', 'error')
        return
      }
      if (!bankVerified) {
        showToast('Bank account verification is required', 'error')
        return
      }
      if (bankNameMismatch) {
        showToast('Bank account holder name does not match. Please use the correct bank account.', 'error')
        return
      }
      if (formData.gst_applicable && !gstVerified) {
        showToast('GST verification is required when GST is applicable', 'error')
        return
      }
    }
    
    if (item) {
      if (type === 'distributors' && !formData.master_distributor_id) {
        if (item.master_distributor_id) {
          formData.master_distributor_id = item.master_distributor_id
        } else {
          showToast('Master Distributor is required for a Distributor', 'error')
          return
        }
      }
      if (type === 'retailers') {
        if (!formData.distributor_id && item.distributor_id) {
          formData.distributor_id = item.distributor_id
        }
        if (!formData.master_distributor_id && item.master_distributor_id) {
          formData.master_distributor_id = item.master_distributor_id
        }
        
        if (!formData.distributor_id) {
          showToast('Distributor is required for a Retailer', 'error')
          return
        }
        if (!formData.master_distributor_id) {
          showToast('Master Distributor is required for a Retailer', 'error')
          return
        }
        const selectedDistributor = distributors.find((d: any) => d.partner_id === formData.distributor_id)
        if (selectedDistributor && selectedDistributor.master_distributor_id !== formData.master_distributor_id) {
          showToast('Selected Distributor does not belong to the selected Master Distributor', 'error')
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
        business_name: formData.business_name || formData.name,
        address: formData.address || null,
        city: formData.city || null,
        state: formData.state || null,
        pincode: formData.pincode || null,
        gst_number: formData.gst_number || null,
        status: !item ? 'pending_verification' : formData.status,
        commission_rate: formData.commission_rate ? parseFloat(formData.commission_rate) : null,
        bank_name: formData.bank_name || null,
        account_number: formData.account_number || null,
        ifsc_code: formData.ifsc_code || null,
        aadhar_number: formData.aadhar_number || null,
        pan_number: formData.pan_number || null,
        udhyam_number: formData.udhyam_number || null,
        pan_verified: panVerified,
        pan_registered_name: panRegisteredName || null,
        pan_type: panType || null,
        bank_verified: bankVerified,
        bank_verified_name: bankVerifiedName || null,
        bank_utr: bankUtr || null,
        gst_verified: gstVerified,
        gst_legal_name: gstLegalName || null,
        gst_trade_name: gstTradeName || null,
        gst_status: gstGstStatus || null,
        gst_taxpayer_type: gstTaxpayerType || null,
        gst_constitution: gstConstitution || null,
        gst_address: gstAddress || null,
        cin_number: formData.cin_number || null,
        cin_verified: cinVerified,
        cin_company_name: cinCompanyName || null,
        cin_status: cinStatus || null,
        cin_incorporation_date: cinIncorporationDate || null,
        aadhaar_verified: aadhaarVerified,
        aadhaar_name: aadhaarName || null,
        aadhaar_dob: aadhaarDob || null,
        aadhaar_gender: aadhaarGender || null,
        aadhaar_address: aadhaarAddress || null,
        aadhaar_uid: aadhaarUid || null,
        digilocker_verification_id: digilockerVerificationId || null,
        ekychub_order_ids: ekychubOrderIds,
        verification_status: !item ? 'pending' : undefined,
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
          // Get auth token for fallback authentication
          const { data: { session } } = await supabase.auth.getSession()
          const authHeaders: HeadersInit = {}
          if (session?.access_token) {
            authHeaders['Authorization'] = `Bearer ${session.access_token}`
          }
          
          const response = await apiFetch('/api/admin/create-user', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
              email: formData.email,
              password: formData.password,
              role: type === 'retailers' ? 'retailer' : type === 'distributors' ? 'distributor' : 'master_distributor',
              tableName,
              userData: partnerData,
            }),
          })

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
            } else if (response.status === 404) {
              throw new Error('API endpoint not found. Please refresh the page and try again.')
            } else {
              throw new Error('Unexpected response format. Please refresh the page and try again.')
            }
          }

          const result = await response.json()
          if (!response.ok) {
            // Provide more detailed error message
            const errorMsg = result.error || result.message || 'Failed to create user'
            const errorDetails = result.details ? `\n\nDetails: ${result.details}` : ''
            const fullMessage = result.message && result.message !== errorMsg ? `${errorMsg}: ${result.message}${errorDetails}` : `${errorMsg}${errorDetails}`
            throw new Error(fullMessage)
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
      console.error('Error details:', error)
      
      // Extract error message - handle both Error objects and string messages
      let errorMessage = 'Failed to save'
      if (error?.message) {
        errorMessage = error.message
      } else if (typeof error === 'string') {
        errorMessage = error
      } else if (error?.error) {
        errorMessage = error.error
      }
      
      showToast(errorMessage, 'error')
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
            <div>
              <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900 dark:text-white">
                {item ? 'Edit' : 'Add'} {type === 'retailers' ? 'Retailer' : type === 'distributors' ? 'Distributor' : 'Master Distributor'}
              </h2>
              {!item && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Step {currentStep} of 3: {currentStep === 1 ? 'Personal Details' : currentStep === 2 ? 'Business & Address' : 'KYC Verification'}
                </p>
              )}
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1">
              <X className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
          </div>
          {!item && (
            <div className="mt-4">
              <div className="flex gap-1.5">
                <div className={`flex-1 h-2 rounded-full transition-colors ${currentStep >= 1 ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'}`}></div>
                <div className={`flex-1 h-2 rounded-full transition-colors ${currentStep >= 2 ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'}`}></div>
                <div className={`flex-1 h-2 rounded-full transition-colors ${currentStep >= 3 ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-gray-700'}`}></div>
              </div>
              <div className="flex justify-between mt-1.5">
                <span className={`text-xs font-medium ${currentStep === 1 ? 'text-indigo-600' : 'text-gray-400'}`}>Personal</span>
                <span className={`text-xs font-medium ${currentStep === 2 ? 'text-indigo-600' : 'text-gray-400'}`}>Business</span>
                <span className={`text-xs font-medium ${currentStep === 3 ? 'text-indigo-600' : 'text-gray-400'}`}>KYC</span>
              </div>
            </div>
          )}
        </div>

        {!item && currentStep === 1 ? (
          <form onSubmit={handleStep1Next} className="p-4 sm:p-6 space-y-3 sm:space-y-4">
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
                onChange={(e) => setFormData({ ...formData, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
            {!item && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password *</label>
                <div className="relative">
                  <input
                    type={showFormPassword ? 'text' : 'password'}
                    required={!item}
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                  />
                  <button type="button" onClick={() => setShowFormPassword(!showFormPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                    {showFormPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            )}
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
                        distributor_id: ''
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
              className="btn-primary order-1 sm:order-2"
            >
              Next: Business Details
            </button>
          </div>
        </form>
        ) : !item && currentStep === 2 ? (
          <div className="p-4 sm:p-6 space-y-4">
            <div className="mb-2 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl border border-blue-100 dark:border-blue-800">
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="w-5 h-5 text-blue-600" />
                <h4 className="text-lg font-semibold text-gray-900 dark:text-white">Business & Address Details</h4>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Verify GST to auto-fill business name, or enter details manually.</p>
            </div>

            {/* GST Verification */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <div className="flex items-center mb-3">
                <input
                  type="checkbox"
                  id="gst_applicable_step2"
                  checked={formData.gst_applicable}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setFormData({ ...formData, gst_applicable: checked, gst_number: checked ? formData.gst_number : '' })
                    if (!checked) { setGstVerified(false); setGstError(''); }
                  }}
                  className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 dark:bg-gray-700 dark:border-gray-600"
                />
                <label htmlFor="gst_applicable_step2" className="ml-2 text-md font-semibold text-indigo-600 dark:text-indigo-400">
                  GST Registered
                </label>
              </div>
              {formData.gst_applicable && (
                <>
                  <div className="flex gap-3 items-end mb-3">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">GST Number</label>
                      <input
                        type="text"
                        value={formData.gst_number}
                        onChange={(e) => { setFormData({ ...formData, gst_number: e.target.value.toUpperCase() }); setGstVerified(false); setGstError('') }}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                        placeholder="Enter 15-character GST number"
                        maxLength={15}
                        disabled={gstVerified}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleVerifyGst}
                      disabled={verifyingGst || gstVerified || !formData.gst_number}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
                    >
                      {verifyingGst ? <Loader2 className="w-4 h-4 animate-spin" /> : gstVerified ? <CheckCircle className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                      {verifyingGst ? 'Verifying...' : gstVerified ? 'Verified' : 'Verify GST'}
                    </button>
                  </div>
                  {gstVerified && (
                    <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                      <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                        <CheckCircle className="w-4 h-4" />
                        <span className="font-medium text-sm">GST Verified</span>
                      </div>
                      <div className="grid grid-cols-2 gap-1 mt-1 text-sm text-green-600 dark:text-green-400">
                        <p>Legal Name: {gstLegalName}</p>
                        {gstTradeName && <p>Trade Name: {gstTradeName}</p>}
                        <p>Status: {gstGstStatus}</p>
                        {gstTaxpayerType && <p>Type: {gstTaxpayerType}</p>}
                        {gstConstitution && <p>Constitution: {gstConstitution}</p>}
                        {gstAddress && <p className="col-span-2">Address: {gstAddress}</p>}
                      </div>
                    </div>
                  )}
                  {gstError && (
                    <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                      <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                        <AlertCircle className="w-4 h-4" />
                        <span className="text-sm">{gstError}</span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Business Name */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Business Name *
                {gstVerified && <span className="text-xs text-green-600 ml-2">(Auto-filled from GST)</span>}
              </label>
              <input
                type="text"
                value={formData.business_name}
                onChange={(e) => setFormData({ ...formData, business_name: e.target.value })}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary-500 text-gray-900 dark:text-white ${
                  gstVerified
                    ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20'
                    : 'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900'
                }`}
                placeholder={gstVerified ? '' : 'Enter business / trade name'}
              />
            </div>

            {/* Company CIN Verification */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <div className="flex items-center mb-3">
                <input
                  type="checkbox"
                  id="cin_applicable_step2b"
                  checked={formData.cin_applicable}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setFormData({ ...formData, cin_applicable: checked, cin_number: checked ? formData.cin_number : '' })
                    if (!checked) { setCinVerified(false); setCinError('') }
                  }}
                  className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 dark:bg-gray-700 dark:border-gray-600"
                />
                <label htmlFor="cin_applicable_step2b" className="ml-2 text-md font-semibold text-indigo-600 dark:text-indigo-400">
                  Company CIN Verification
                </label>
              </div>
              {formData.cin_applicable && (
                <>
                  <div className="flex gap-3 items-end mb-3">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CIN Number</label>
                      <input
                        type="text"
                        value={formData.cin_number}
                        onChange={(e) => { setFormData({ ...formData, cin_number: e.target.value.toUpperCase() }); setCinVerified(false); setCinError('') }}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                        placeholder="U72200MH2009PLC123456"
                        maxLength={21}
                        disabled={cinVerified}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleVerifyCin}
                      disabled={verifyingCin || cinVerified || !formData.cin_number}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
                    >
                      {verifyingCin ? <Loader2 className="w-4 h-4 animate-spin" /> : cinVerified ? <CheckCircle className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                      {verifyingCin ? 'Verifying...' : cinVerified ? 'Verified' : 'Verify CIN'}
                    </button>
                  </div>
                  {cinVerified && (
                    <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                      <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                        <CheckCircle className="w-4 h-4" />
                        <span className="font-medium text-sm">CIN Verified</span>
                      </div>
                      <div className="grid grid-cols-2 gap-1 mt-1 text-sm text-green-600 dark:text-green-400">
                        <p>Company: {cinCompanyName}</p>
                        {cinStatus && <p>Status: {cinStatus}</p>}
                        {cinIncorporationDate && <p>Incorporated: {cinIncorporationDate}</p>}
                      </div>
                    </div>
                  )}
                  {cinError && (
                    <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                      <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                        <AlertCircle className="w-4 h-4" />
                        <span className="text-sm">{cinError}</span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* UDHYAM Section */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <div className="flex items-center mb-3">
                <input
                  type="checkbox"
                  id="udhyam_applicable_step2b"
                  checked={formData.udhyam_applicable}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setFormData({ ...formData, udhyam_applicable: checked, udhyam_number: checked ? formData.udhyam_number : '' })
                  }}
                  className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 dark:bg-gray-700 dark:border-gray-600"
                />
                <label htmlFor="udhyam_applicable_step2b" className="ml-2 text-md font-semibold text-indigo-600 dark:text-indigo-400">
                  UDHYAM Registration
                </label>
              </div>
              {formData.udhyam_applicable && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">UDHYAM Number</label>
                  <input
                    type="text"
                    value={formData.udhyam_number}
                    onChange={(e) => setFormData({ ...formData, udhyam_number: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                    placeholder="Enter UDHYAM registration number"
                  />
                </div>
              )}
            </div>

            {/* Aadhaar Verification via Digilocker */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <h5 className="text-md font-semibold mb-3 text-indigo-600 dark:text-indigo-400 border-b pb-2">Aadhaar Verification</h5>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Aadhaar Number</label>
                  <input
                    type="text"
                    value={formData.aadhar_number}
                    onChange={(e) => setFormData({ ...formData, aadhar_number: e.target.value.replace(/\D/g, '').slice(0, 12) })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                    placeholder="Enter 12-digit Aadhaar number"
                    maxLength={12}
                    disabled={aadhaarVerified}
                  />
                </div>
                {!aadhaarVerified && (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleDigilockerAadhaar}
                      disabled={digilockerLoading}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
                    >
                      {digilockerLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                      {digilockerLoading ? 'Generating...' : 'Verify via Digilocker'}
                    </button>
                    <span className="text-xs text-gray-500 dark:text-gray-400">Opens Digilocker for Aadhaar verification</span>
                  </div>
                )}
                {digilockerUrl && !aadhaarVerified && (
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                    <p className="text-sm text-blue-700 dark:text-blue-300 mb-2">Digilocker verification link generated. A new tab should have opened.</p>
                    <a href={digilockerUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:text-blue-800 underline break-all">
                      Click here if the tab didn&apos;t open
                    </a>
                  </div>
                )}
                {aadhaarVerified && (
                  <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                    <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                      <CheckCircle className="w-4 h-4" />
                      <span className="font-medium text-sm">Aadhaar Verified via Digilocker</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 mt-1 text-sm text-green-600 dark:text-green-400">
                      <p>Name: {aadhaarName}</p>
                      {aadhaarDob && <p>DOB: {aadhaarDob}</p>}
                      {aadhaarGender && <p>Gender: {aadhaarGender}</p>}
                      {aadhaarUid && <p>UID: {aadhaarUid}</p>}
                      {aadhaarAddress && <p className="col-span-2">Address: {aadhaarAddress}</p>}
                    </div>
                  </div>
                )}
                {digilockerError && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                      <AlertCircle className="w-4 h-4" />
                      <span className="text-sm">{digilockerError}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Address */}
            {(() => {
              const addressFromApi = (gstVerified && gstAddress) || (!formData.gst_applicable && aadhaarVerified && aadhaarAddress)
              return (
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                  <h5 className="text-md font-semibold mb-3 text-indigo-600 dark:text-indigo-400 border-b pb-2">
                    Address
                    {gstVerified && gstAddress && <span className="text-xs text-green-600 ml-2">(From GST)</span>}
                    {!formData.gst_applicable && aadhaarVerified && aadhaarAddress && <span className="text-xs text-green-600 ml-2">(From Aadhaar)</span>}
                  </h5>
                  {addressFromApi ? (
                    <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                      <div className="flex items-center gap-2 text-green-700 dark:text-green-400 mb-1">
                        <CheckCircle className="w-4 h-4" />
                        <span className="font-medium text-sm">Address from {gstVerified && gstAddress ? 'GST' : 'Aadhaar'} verification</span>
                      </div>
                      <p className="text-sm text-gray-800 dark:text-gray-200">{formData.address}</p>
                    </div>
                  ) : (
                    <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                      <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 mb-1">
                        <AlertCircle className="w-4 h-4" />
                        <span className="font-medium text-sm">Address will be captured from API</span>
                      </div>
                      <p className="text-xs text-amber-600 dark:text-amber-400">Verify GST (above) to auto-fill address, or verify Aadhaar via Digilocker if GST is not applicable.</p>
                    </div>
                  )}
                </div>
              )
            })()}

            <div className="flex flex-col sm:flex-row justify-between gap-2 sm:gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={() => setCurrentStep(1)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                Back
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!formData.business_name) {
                      showToast('Business Name is required. Verify GST to auto-fill or enter manually.', 'error')
                      return
                    }
                    if (formData.gst_applicable && !gstVerified) {
                      showToast('Please verify GST number or uncheck GST Registered', 'error')
                      return
                    }
                    if (formData.cin_applicable && !cinVerified) {
                      showToast('Please verify CIN number or uncheck Company CIN Verification', 'error')
                      return
                    }
                    if (!aadhaarVerified) {
                      showToast('Aadhaar verification via Digilocker is mandatory', 'error')
                      return
                    }
                    if (!formData.address) {
                      showToast('Address is required. Verify GST or Aadhaar to capture address.', 'error')
                      return
                    }
                    setCurrentStep(3)
                  }}
                  className="btn-primary"
                >
                  Next: KYC Verification
                </button>
              </div>
            </div>
          </div>
        ) : !item && currentStep === 3 ? (
          <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
            <div className="mb-2 p-4 bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-900/20 dark:to-blue-900/20 rounded-xl border border-indigo-100 dark:border-indigo-800">
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck className="w-5 h-5 text-indigo-600" />
                <h4 className="text-lg font-semibold text-gray-900 dark:text-white">KYC Verification</h4>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Verify identity and bank details using eKYC APIs. PAN and Bank verification are mandatory.</p>
            </div>

            {/* PAN Verification */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <h5 className="text-md font-semibold mb-3 text-indigo-600 dark:text-indigo-400 border-b pb-2">PAN Verification *</h5>
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">PAN Number</label>
                  <input
                    type="text"
                    value={formData.pan_number}
                    onChange={(e) => { setFormData({ ...formData, pan_number: e.target.value.toUpperCase() }); setPanVerified(false); setPanError('') }}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                    placeholder="ABCDE1234F"
                    maxLength={10}
                    disabled={panVerified}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleVerifyPan}
                  disabled={verifyingPan || panVerified || !formData.pan_number}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
                >
                  {verifyingPan ? <Loader2 className="w-4 h-4 animate-spin" /> : panVerified ? <CheckCircle className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                  {verifyingPan ? 'Verifying...' : panVerified ? 'Verified' : 'Verify PAN'}
                </button>
              </div>
              {panVerified && (
                <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                  <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                    <CheckCircle className="w-4 h-4" />
                    <span className="font-medium text-sm">PAN Verified</span>
                  </div>
                  <p className="text-sm text-green-600 dark:text-green-400 mt-1">Name: {panRegisteredName}</p>
                  {panType && <p className="text-sm text-green-600 dark:text-green-400">Type: {panType}</p>}
                </div>
              )}
              {panError && (
                <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                    <AlertCircle className="w-4 h-4" />
                    <span className="text-sm">{panError}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Bank Account Verification */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <h5 className="text-md font-semibold mb-3 text-indigo-600 dark:text-indigo-400 border-b pb-2">Bank Account Verification *</h5>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bank Name</label>
                  <input
                    type="text"
                    value={formData.bank_name}
                    onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                    placeholder="Enter bank name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Account Number</label>
                  <input
                    type="text"
                    value={formData.account_number}
                    onChange={(e) => { setFormData({ ...formData, account_number: e.target.value }); setBankVerified(false); setBankError('') }}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                    placeholder="Enter account number"
                    disabled={bankVerified}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">IFSC Code</label>
                  <input
                    type="text"
                    value={formData.ifsc_code}
                    onChange={(e) => { setFormData({ ...formData, ifsc_code: e.target.value.toUpperCase() }); setBankVerified(false); setBankError('') }}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                    placeholder="Enter IFSC code"
                    maxLength={11}
                    disabled={bankVerified}
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={handleVerifyBank}
                    disabled={verifyingBank || bankVerified || !formData.account_number || !formData.ifsc_code}
                    className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {verifyingBank ? <Loader2 className="w-4 h-4 animate-spin" /> : bankVerified ? <CheckCircle className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                    {verifyingBank ? 'Verifying...' : bankVerified ? 'Verified' : 'Verify Bank'}
                  </button>
                </div>
              </div>
              {bankVerified && (
                <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                  <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                    <CheckCircle className="w-4 h-4" />
                    <span className="font-medium text-sm">Bank Account Verified</span>
                  </div>
                  <p className="text-sm text-green-600 dark:text-green-400 mt-1">Name at Bank: {bankVerifiedName}</p>
                  {bankUtr && <p className="text-sm text-green-600 dark:text-green-400">UTR: {bankUtr}</p>}
                </div>
              )}
              {bankError && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                    <AlertCircle className="w-4 h-4" />
                    <span className="text-sm">{bankError}</span>
                  </div>
                </div>
              )}
              {bankNameMismatch && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <div className="flex items-start gap-2 text-red-700 dark:text-red-400">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span className="text-sm">{bankNameMismatch}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Mandatory verification status */}
            {(!panVerified || !aadhaarVerified) && (
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300 mb-1">Required verifications:</p>
                <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-1">
                  {!panVerified && <li>• PAN verification is mandatory</li>}
                  {!aadhaarVerified && <li>• Aadhaar verification via Digilocker is mandatory</li>}
                  {!bankVerified && <li>• Bank account verification is mandatory</li>}
                </ul>
              </div>
            )}

            <div className="flex flex-col sm:flex-row justify-between gap-2 sm:gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                Back
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !panVerified || !aadhaarVerified || !bankVerified || !!bankNameMismatch}
                  className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Creating...' : 'Submit for Verification'}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-3 sm:space-y-4">
            {/* Edit mode - show all fields in single form */}
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
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                />
              </div>
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
                  <option value="pending_verification">Pending Verification</option>
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
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Address</label>
                <textarea
                  value={formData.address}
                  readOnly
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white cursor-not-allowed"
                  placeholder="Address captured from KYC verification"
                />
                <p className="text-xs text-gray-500 mt-1">Address is auto-captured from GST/Aadhaar verification and cannot be edited manually.</p>
              </div>
            </div>

            {/* Bank & KYC Details Section */}
            <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 mb-4">
                <ShieldCheck className="w-5 h-5 text-indigo-600" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Bank & KYC Details</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Bank Name</label>
                  <input
                    type="text"
                    value={formData.bank_name}
                    onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                    placeholder="Enter bank name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Account Number</label>
                  <input
                    type="text"
                    value={formData.account_number}
                    onChange={(e) => { setFormData({ ...formData, account_number: e.target.value }); setBankVerified(false); setBankError('') }}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                    placeholder="Enter account number"
                    disabled={bankVerified}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">IFSC Code</label>
                  <input
                    type="text"
                    value={formData.ifsc_code}
                    onChange={(e) => { setFormData({ ...formData, ifsc_code: e.target.value.toUpperCase() }); setBankVerified(false); setBankError('') }}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                    placeholder="Enter IFSC code"
                    maxLength={11}
                    disabled={bankVerified}
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={handleVerifyBank}
                    disabled={verifyingBank || bankVerified || !formData.account_number || !formData.ifsc_code}
                    className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {verifyingBank ? <Loader2 className="w-4 h-4 animate-spin" /> : bankVerified ? <CheckCircle className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                    {verifyingBank ? 'Verifying...' : bankVerified ? 'Verified' : 'Verify Bank'}
                  </button>
                </div>
              </div>
              {bankVerified && (
                <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                  <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                    <CheckCircle className="w-4 h-4" />
                    <span className="font-medium text-sm">Bank Verified — {bankVerifiedName}</span>
                  </div>
                  {bankUtr && <p className="text-sm text-green-600 dark:text-green-400 mt-1">UTR: {bankUtr}</p>}
                </div>
              )}
              {bankError && (
                <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                    <AlertCircle className="w-4 h-4" />
                    <span className="text-sm">{bankError}</span>
                  </div>
                </div>
              )}
            </div>

            {/* KYC Document Details */}
            <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">KYC Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">PAN Number</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={formData.pan_number}
                      onChange={(e) => { setFormData({ ...formData, pan_number: e.target.value.toUpperCase() }); setPanVerified(false); setPanError('') }}
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                      placeholder="ABCDE1234F"
                      maxLength={10}
                      disabled={panVerified}
                    />
                    <button
                      type="button"
                      onClick={handleVerifyPan}
                      disabled={verifyingPan || panVerified || !formData.pan_number}
                      className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 text-sm whitespace-nowrap"
                    >
                      {verifyingPan ? <Loader2 className="w-4 h-4 animate-spin" /> : panVerified ? <CheckCircle className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                      {panVerified ? 'Verified' : 'Verify'}
                    </button>
                  </div>
                  {panVerified && <p className="text-xs text-green-600 dark:text-green-400 mt-1">{panRegisteredName} {panType && `(${panType})`}</p>}
                  {panError && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{panError}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Aadhaar Number</label>
                  <input
                    type="text"
                    value={formData.aadhar_number}
                    onChange={(e) => setFormData({ ...formData, aadhar_number: e.target.value.replace(/\D/g, '') })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                    placeholder="Enter 12-digit Aadhaar number"
                    maxLength={12}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">UDHYAM Number</label>
                  <input
                    type="text"
                    value={formData.udhyam_number}
                    onChange={(e) => setFormData({ ...formData, udhyam_number: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                    placeholder="Enter UDHYAM registration number"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">GST Number</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={formData.gst_number}
                      onChange={(e) => { setFormData({ ...formData, gst_number: e.target.value.toUpperCase() }); setGstVerified(false); setGstError('') }}
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                      placeholder="Enter GST number"
                      maxLength={15}
                      disabled={gstVerified}
                    />
                    <button
                      type="button"
                      onClick={handleVerifyGst}
                      disabled={verifyingGst || gstVerified || !formData.gst_number}
                      className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 text-sm whitespace-nowrap"
                    >
                      {verifyingGst ? <Loader2 className="w-4 h-4 animate-spin" /> : gstVerified ? <CheckCircle className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                      {gstVerified ? 'Verified' : 'Verify'}
                    </button>
                  </div>
                  {gstVerified && <p className="text-xs text-green-600 dark:text-green-400 mt-1">{gstLegalName} — {gstGstStatus}</p>}
                  {gstError && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{gstError}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Company CIN</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={formData.cin_number}
                      onChange={(e) => { setFormData({ ...formData, cin_number: e.target.value.toUpperCase() }); setCinVerified(false); setCinError('') }}
                      className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                      placeholder="Enter CIN number"
                      maxLength={21}
                      disabled={cinVerified}
                    />
                    <button
                      type="button"
                      onClick={handleVerifyCin}
                      disabled={verifyingCin || cinVerified || !formData.cin_number}
                      className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 text-sm whitespace-nowrap"
                    >
                      {verifyingCin ? <Loader2 className="w-4 h-4 animate-spin" /> : cinVerified ? <CheckCircle className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                      {cinVerified ? 'Verified' : 'Verify'}
                    </button>
                  </div>
                  {cinVerified && <p className="text-xs text-green-600 dark:text-green-400 mt-1">{cinCompanyName} — {cinStatus}</p>}
                  {cinError && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{cinError}</p>}
                </div>
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
              className="btn-primary order-1 sm:order-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Saving...' : 'Update'}
            </button>
          </div>
        </form>
        )}

      </motion.div>
    </div>
  )
}

// POS Machines Management Component
function POSMachinesTab({
  retailers,
  distributors,
  masterDistributors,
  partners,
  posMachines,
  onRefresh,
  onAdd,
  onEdit,
  onDelete,
  onReturnToStock,
  onBulkDelete,
  onBulkReturn,
}: {
  retailers: Retailer[]
  distributors: Distributor[]
  masterDistributors: MasterDistributor[]
  partners: any[]
  posMachines: POSMachine[]
  onRefresh: () => void
  onAdd: () => void
  onEdit: (item: POSMachine) => void
  onDelete: (id: string) => void
  onReturnToStock?: (machine: POSMachine) => void
  onBulkDelete?: (ids: string[]) => Promise<void>
  onBulkReturn?: (ids: string[], returnDate?: string, returnReason?: string) => Promise<{ ok: number; fail: number }>
}) {
  const { showToast } = useToast()
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [retailerFilter, setRetailerFilter] = useState<string>('all')
  const [distributorFilter, setDistributorFilter] = useState<string>('all')
  const [masterDistributorFilter, setMasterDistributorFilter] = useState<string>('all')
  const [partnerFilter, setPartnerFilter] = useState<string>('all')
  const [assignmentFilter, setAssignmentFilter] = useState<string>('all')
  const [sortField, setSortField] = useState<keyof POSMachine>('created_at')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [showBulkUploadModal, setShowBulkUploadModal] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null)

  const [showBulkAssignModal, setShowBulkAssignModal] = useState(false)
  const [bulkAssignRole, setBulkAssignRole] = useState<
    'master_distributor' | 'partner'
  >('master_distributor')
  const [bulkAssignTargetId, setBulkAssignTargetId] = useState('')
  const [bulkAssignUserSearch, setBulkAssignUserSearch] = useState('')
  const [bulkNotes, setBulkNotes] = useState('')
  const [bulkAssignDate, setBulkAssignDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [bulkSubscriptionAmount, setBulkSubscriptionAmount] = useState('')
  const [bulkBillingDay, setBulkBillingDay] = useState(1)
  const [bulkAssigning, setBulkAssigning] = useState(false)
  const [bulkAssignError, setBulkAssignError] = useState<string | null>(null)
  const [bulkAssignSummary, setBulkAssignSummary] = useState<string | null>(null)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkReturning, setBulkReturning] = useState(false)
  const [bulkReturnDate, setBulkReturnDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [bulkReturnReason, setBulkReturnReason] = useState('')
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false)
  const [showBulkReturnModal, setShowBulkReturnModal] = useState(false)
  const [bulkModalPickedIds, setBulkModalPickedIds] = useState<Set<string>>(new Set())
  const [bulkModalSearch, setBulkModalSearch] = useState('')

  const retailersSortedByName = useMemo(
    () =>
      [...retailers].sort((a, b) =>
        (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
      ),
    [retailers]
  )
  const distributorsSortedByName = useMemo(
    () =>
      [...distributors].sort((a, b) =>
        (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
      ),
    [distributors]
  )
  const masterDistributorsSortedByName = useMemo(
    () =>
      [...masterDistributors].sort((a, b) =>
        (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
      ),
    [masterDistributors]
  )
  const partnersSortedByName = useMemo(
    () =>
      [...partners].sort((a, b) =>
        String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
      ),
    [partners]
  )

  const filteredMachines = useMemo(() => {
    let filtered = posMachines.filter((machine) => {
      const q = searchTerm.trim().toLowerCase()

      const retailer = retailers.find((r) => r.partner_id === machine.retailer_id)
      const distributor = distributors.find((d) => d.partner_id === machine.distributor_id)
      const masterDist = masterDistributors.find((md) => md.partner_id === machine.master_distributor_id)
      const partner = partners.find((p) => p.id === machine.partner_id)

      const assigneeNamesCombined = [
        retailer?.name,
        distributor?.name,
        masterDist?.name,
        partner?.name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      const matchesSearch =
        !q ||
        machine.machine_id?.toLowerCase().includes(q) ||
        machine.serial_number?.toLowerCase().includes(q) ||
        machine.mid?.toLowerCase().includes(q) ||
        machine.tid?.toLowerCase().includes(q) ||
        machine.brand?.toLowerCase().includes(q) ||
        machine.machine_type?.toLowerCase().includes(q) ||
        machine.retailer_id?.toLowerCase().includes(q) ||
        machine.distributor_id?.toLowerCase().includes(q) ||
        machine.master_distributor_id?.toLowerCase().includes(q) ||
        machine.partner_id?.toLowerCase().includes(q) ||
        machine.location?.toLowerCase().includes(q) ||
        machine.city?.toLowerCase().includes(q) ||
        machine.state?.toLowerCase().includes(q) ||
        machine.pincode?.toLowerCase().includes(q) ||
        machine.notes?.toLowerCase().includes(q) ||
        assigneeNamesCombined.includes(q)

      const matchesStatus = statusFilter === 'all' || machine.status === statusFilter
      const matchesType = typeFilter === 'all' || machine.machine_type === typeFilter
      const matchesRetailer = retailerFilter === 'all' || machine.retailer_id === retailerFilter
      const matchesDistributor = distributorFilter === 'all' || machine.distributor_id === distributorFilter
      const matchesMasterDistributor =
        masterDistributorFilter === 'all' || machine.master_distributor_id === masterDistributorFilter
      const matchesPartner = partnerFilter === 'all' || machine.partner_id === partnerFilter
      
      // Assignment status filter
      let matchesAssignment = true
      if (assignmentFilter !== 'all') {
        const inv = machine.inventory_status || ''
        if (assignmentFilter === 'in_stock') {
          matchesAssignment = inv === 'in_stock' || inv === 'received_from_bank'
        } else if (assignmentFilter === 'assigned_to_retailer') {
          matchesAssignment = inv === 'assigned_to_retailer'
        } else if (assignmentFilter === 'assigned_to_distributor') {
          matchesAssignment = inv === 'assigned_to_distributor'
        } else if (assignmentFilter === 'assigned_to_master_distributor') {
          matchesAssignment = inv === 'assigned_to_master_distributor'
        } else if (assignmentFilter === 'assigned_to_partner') {
          matchesAssignment = inv === 'assigned_to_partner'
        } else if (assignmentFilter === 'damaged') {
          matchesAssignment = inv === 'damaged_from_bank'
        }
      }

      return (
        matchesSearch &&
        matchesStatus &&
        matchesType &&
        matchesRetailer &&
        matchesDistributor &&
        matchesMasterDistributor &&
        matchesPartner &&
        matchesAssignment
      )
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
  }, [
    posMachines,
    searchTerm,
    statusFilter,
    typeFilter,
    retailerFilter,
    distributorFilter,
    masterDistributorFilter,
    partnerFilter,
    assignmentFilter,
    sortField,
    sortDirection,
    retailers,
    distributors,
    masterDistributors,
    partners,
  ])

  const [posListPage, setPosListPage] = useState(1)
  const [posListPageSize, setPosListPageSize] = useState<10 | 25 | 100>(25)
  const posListTotalPages = Math.max(1, Math.ceil(filteredMachines.length / posListPageSize))
  const posListPageSafe = Math.min(posListPage, posListTotalPages)

  useEffect(() => {
    setPosListPage(1)
  }, [
    searchTerm,
    statusFilter,
    typeFilter,
    retailerFilter,
    distributorFilter,
    masterDistributorFilter,
    partnerFilter,
    assignmentFilter,
    sortField,
    sortDirection,
  ])

  // Keep current page valid when the filtered set shrinks (e.g. stricter filters) or page size changes.
  useEffect(() => {
    setPosListPage((p) => Math.min(Math.max(1, p), posListTotalPages))
  }, [posListTotalPages])

  const paginatedPosMachines = useMemo(() => {
    const start = (posListPageSafe - 1) * posListPageSize
    return filteredMachines.slice(start, start + posListPageSize)
  }, [filteredMachines, posListPageSafe, posListPageSize])

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

  const getPartnerName = (partnerId?: string) => {
    if (!partnerId) return '-'
    const partner = partners.find(p => p.id === partnerId)
    return partner?.name || partnerId
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

  const getAssignmentSummary = (inv?: string): 'Assigned' | 'In stock' | 'Other' => {
    if (!inv) return 'Other'
    if (
      inv === 'assigned_to_retailer' ||
      inv === 'assigned_to_distributor' ||
      inv === 'assigned_to_master_distributor' ||
      inv === 'assigned_to_partner'
    ) {
      return 'Assigned'
    }
    if (inv === 'in_stock' || inv === 'received_from_bank') return 'In stock'
    return 'Other'
  }

  const escapeCsvCell = (value: string | number | undefined | null): string => {
    const s = value === undefined || value === null ? '' : String(value)
    if (/[",\r\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }

  const downloadPosMachinesExport = () => {
    const headers = [
      'machine_id',
      'serial_number',
      'mid',
      'tid',
      'brand',
      'machine_type',
      'operational_status',
      'assignment',
      'inventory_status',
      'retailer',
      'distributor',
      'master_distributor',
      'partner',
      'delivery_date',
      'installation_date',
      'location',
      'city',
      'state',
      'pincode',
      'notes',
    ]

    const rows = posMachines.map((machine) => {
      const inv = machine.inventory_status || ''
      return [
        escapeCsvCell(machine.machine_id),
        escapeCsvCell(machine.serial_number),
        escapeCsvCell(machine.mid),
        escapeCsvCell(machine.tid),
        escapeCsvCell(machine.brand),
        escapeCsvCell(machine.machine_type),
        escapeCsvCell(machine.status),
        escapeCsvCell(getAssignmentSummary(inv)),
        escapeCsvCell(inv || 'unknown'),
        escapeCsvCell(machine.retailer_id ? getRetailerName(machine.retailer_id) : ''),
        escapeCsvCell(machine.distributor_id ? getDistributorName(machine.distributor_id) : ''),
        escapeCsvCell(machine.master_distributor_id ? getMasterDistributorName(machine.master_distributor_id) : ''),
        escapeCsvCell(machine.partner_id ? getPartnerName(machine.partner_id) : ''),
        escapeCsvCell(machine.delivery_date ? machine.delivery_date.slice(0, 10) : ''),
        escapeCsvCell(machine.installation_date ? machine.installation_date.slice(0, 10) : ''),
        escapeCsvCell(machine.location),
        escapeCsvCell(machine.city),
        escapeCsvCell(machine.state),
        escapeCsvCell(machine.pincode),
        escapeCsvCell(machine.notes),
      ].join(',')
    })

    const csvContent = ['\uFEFF', headers.join(','), ...rows].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    const stamp = new Date().toISOString().slice(0, 10)
    link.setAttribute('href', url)
    link.setAttribute('download', `pos_machines_export_${stamp}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // Stock intake bulk template (no retailer / distributor / master_distributor — inventory_status must be in_stock)
  const downloadCSVTemplate = () => {
    const headers = [
      'serial_number',
      'MID',
      'TID',
      'Brand',
      'machine_type',
      'inventory_status',
      'status',
      'delivery_date',
      'installation_date',
      'location',
      'city',
      'state',
      'pincode',
      'notes',
    ]

    const exampleRow = [
      '61251225300000',
      'ZW00000',
      '68340000',
      'HDFC',
      'POS',
      'in_stock',
      'active',
      '2026-03-21',
      '2026-03-21',
      'Eros Mall',
      'New Delhi',
      'Delhi',
      '110078',
      'Received from Bank',
    ]

    const csvContent = [
      headers.join(','),
      exampleRow.join(','),
      ['SN222', 'MID002', 'TID002', 'PAX', 'WPOS', 'in_stock', 'active', '', '', '', '', '', '', ''].join(','),
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', 'pos_machines_template.csv')
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Handle CSV file upload
  const handleFileUpload = async () => {
    if (!uploadFile) {
      setUploadError('Please select a CSV file')
      return
    }

    setUploading(true)
    setUploadError(null)
    setUploadSuccess(null)

    try {
      const formData = new FormData()
      formData.append('file', uploadFile)

      // Get auth token for fallback authentication
      const { data: { session } } = await supabase.auth.getSession()
      const headers: HeadersInit = {}
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }

      const response = await apiFetch('/api/admin/bulk-upload-pos-machines', {
        method: 'POST',
        body: formData,
        headers,
      })

      const data = await response.json()

      if (!response.ok) {
        if (data.errors && Array.isArray(data.errors)) {
          setUploadError(`Validation errors:\n${data.errors.slice(0, 10).join('\n')}${data.errors.length > 10 ? `\n... and ${data.errors.length - 10} more errors` : ''}`)
        } else {
          setUploadError(data.error || 'Failed to upload CSV file')
        }
        setUploading(false)
        return
      }

      setUploadSuccess(`Successfully imported ${data.count} POS machine(s)!`)
      setUploadFile(null)
      onRefresh()
      
      // Close modal after 2 seconds
      setTimeout(() => {
        setShowBulkUploadModal(false)
        setUploadSuccess(null)
      }, 2000)
    } catch (error: any) {
      console.error('Error uploading CSV:', error)
      setUploadError(error.message || 'Failed to upload CSV file')
    } finally {
      setUploading(false)
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
              placeholder="Search ID, serial, MID/TID, location, notes, or retailer / distributor / MD / partner name…"
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
        <select
          title="Filter by retailer assignment"
          value={retailerFilter}
          onChange={(e) => setRetailerFilter(e.target.value)}
          className="min-w-[140px] max-w-[200px] px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
        >
          <option value="all">All retailers</option>
          {retailersSortedByName.map((r) => (
            <option key={r.partner_id} value={r.partner_id}>
              {r.name}
            </option>
          ))}
        </select>
        <select
          title="Filter by distributor assignment"
          value={distributorFilter}
          onChange={(e) => setDistributorFilter(e.target.value)}
          className="min-w-[150px] max-w-[200px] px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
        >
          <option value="all">All distributors</option>
          {distributorsSortedByName.map((d) => (
            <option key={d.partner_id} value={d.partner_id}>
              {d.name}
            </option>
          ))}
        </select>
        <select
          title="Filter by master distributor assignment"
          value={masterDistributorFilter}
          onChange={(e) => setMasterDistributorFilter(e.target.value)}
          className="min-w-[140px] max-w-[200px] px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
        >
          <option value="all">All MDs</option>
          {masterDistributorsSortedByName.map((md) => (
            <option key={md.partner_id} value={md.partner_id}>
              {md.name}
            </option>
          ))}
        </select>
        <select
          title="Filter by partner assignment"
          value={partnerFilter}
          onChange={(e) => setPartnerFilter(e.target.value)}
          className="min-w-[140px] max-w-[200px] px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
        >
          <option value="all">All partners</option>
          {partnersSortedByName.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          title="Filter by assignment status"
          value={assignmentFilter}
          onChange={(e) => setAssignmentFilter(e.target.value)}
          className="min-w-[160px] max-w-[220px] px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
        >
          <option value="all">All Assignments</option>
          <option value="in_stock">In Stock</option>
          <option value="assigned_to_retailer">Assigned to Retailer</option>
          <option value="assigned_to_distributor">Assigned to Distributor</option>
          <option value="assigned_to_master_distributor">Assigned to Master Distributor</option>
          <option value="assigned_to_partner">Assigned to Partner</option>
          <option value="damaged">Damaged</option>
        </select>
        <button
          onClick={onAdd}
          className="btn-primary flex items-center gap-2 text-sm px-4 py-1.5 whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          Add POS Machine
        </button>
        <button
          onClick={downloadCSVTemplate}
          className="flex items-center gap-2 text-sm px-4 py-1.5 whitespace-nowrap border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900"
        >
          <Download className="w-4 h-4" />
          Download Template
        </button>
        <button
          onClick={() => setShowBulkUploadModal(true)}
          className="flex items-center gap-2 text-sm px-4 py-1.5 whitespace-nowrap border border-primary-500 text-primary-600 dark:text-primary-400 rounded-lg hover:bg-primary-50 dark:hover:bg-primary-900/20 bg-white dark:bg-gray-900"
        >
          <Upload className="w-4 h-4" />
          Bulk Upload
        </button>
        <button
          type="button"
          onClick={downloadPosMachinesExport}
          disabled={posMachines.length === 0}
          title={posMachines.length === 0 ? 'No machines to export' : 'Download all POS machines as CSV'}
          className="flex items-center gap-2 text-sm px-4 py-1.5 whitespace-nowrap border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <FileDown className="w-4 h-4" />
          Export
        </button>
        <button
          onClick={() => {
            setBulkModalPickedIds(new Set(selectedItems))
            setBulkModalSearch('')
            setBulkAssignError(null)
            setBulkAssignSummary(null)
            setBulkAssignTargetId('')
            setBulkAssignUserSearch('')
            setBulkNotes('')
            setBulkSubscriptionAmount('')
            setBulkBillingDay(1)
            setShowBulkAssignModal(true)
          }}
          className="flex items-center gap-2 text-sm px-4 py-1.5 whitespace-nowrap border border-green-500 text-green-600 dark:text-green-400 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 bg-white dark:bg-gray-900"
        >
          <UserPlus className="w-4 h-4" />
          Bulk Assign
        </button>
        <button
          onClick={() => {
            setBulkModalPickedIds(new Set(selectedItems))
            setBulkModalSearch('')
            setShowBulkReturnModal(true)
          }}
          className="flex items-center gap-2 text-sm px-4 py-1.5 whitespace-nowrap border border-amber-500 text-amber-600 dark:text-amber-400 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 bg-white dark:bg-gray-900"
        >
          <RotateCcw className="w-4 h-4" />
          Bulk Return
        </button>
        <button
          onClick={() => {
            setBulkModalPickedIds(new Set(selectedItems))
            setBulkModalSearch('')
            setShowBulkDeleteModal(true)
          }}
          className="flex items-center gap-2 text-sm px-4 py-1.5 whitespace-nowrap border border-red-500 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 bg-white dark:bg-gray-900"
        >
          <Trash2 className="w-4 h-4" />
          Bulk Delete
        </button>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1280px]">
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
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">MID / TID</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Brand</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Type</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Retailer</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Distributor</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Master Distributor</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Partner</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Status</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Inventory Status</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 cursor-pointer" onClick={() => {
                  setSortField('delivery_date')
                  setSortDirection(sortField === 'delivery_date' && sortDirection === 'asc' ? 'desc' : 'asc')
                }}>
                  Delivery <ArrowUpDown className="w-3 h-3 inline" />
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 cursor-pointer" onClick={() => {
                  setSortField('installation_date')
                  setSortDirection(sortField === 'installation_date' && sortDirection === 'asc' ? 'desc' : 'asc')
                }}>
                  Installation <ArrowUpDown className="w-3 h-3 inline" />
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Location</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">City / State / PIN</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Notes</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700 dark:text-gray-300">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredMachines.length === 0 ? (
                <tr>
                  <td colSpan={17} className="px-3 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                    No POS machines found
                  </td>
                </tr>
              ) : (
                paginatedPosMachines.map((machine) => (
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
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
                      <div className="text-xs">
                        {machine.mid && <div><span className="font-medium">MID:</span> {machine.mid}</div>}
                        {machine.tid && <div><span className="font-medium">TID:</span> {machine.tid}</div>}
                        {!machine.mid && !machine.tid && <span className="text-gray-400">-</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
                      {machine.brand ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                          {machine.brand}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{machine.machine_type}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{machine.retailer_id ? getRetailerName(machine.retailer_id) : '-'}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{getDistributorName(machine.distributor_id)}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{getMasterDistributorName(machine.master_distributor_id)}</td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{getPartnerName(machine.partner_id)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(machine.status)}`}>
                        {machine.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        machine.inventory_status === 'in_stock' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
                        machine.inventory_status === 'received_from_bank' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' :
                        machine.inventory_status === 'assigned_to_retailer' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                        machine.inventory_status === 'assigned_to_distributor' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                        machine.inventory_status === 'assigned_to_master_distributor' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400' :
                        machine.inventory_status === 'assigned_to_partner' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400' :
                        machine.inventory_status === 'damaged_from_bank' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                        'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
                      }`}>
                        {machine.inventory_status ? machine.inventory_status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Unknown'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {machine.delivery_date ? new Date(machine.delivery_date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '-'}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {machine.installation_date ? new Date(machine.installation_date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '-'}
                    </td>
                    <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300 max-w-[140px]">
                      {machine.location ? (
                        <div className="flex items-start gap-1">
                          <MapPin className="w-3 h-3 shrink-0 mt-0.5" />
                          <span className="line-clamp-2" title={machine.location}>{machine.location}</span>
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-700 dark:text-gray-300 max-w-[160px]">
                      {[machine.city, machine.state, machine.pincode].filter(Boolean).length > 0 ? (
                        <div className="space-y-0.5">
                          {machine.city && <div>{machine.city}</div>}
                          {machine.state && <div className="text-gray-500 dark:text-gray-400">{machine.state}</div>}
                          {machine.pincode && <div>{machine.pincode}</div>}
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400 max-w-[180px]">
                      {machine.notes ? (
                        <span className="line-clamp-3" title={machine.notes}>
                          {machine.notes}
                        </span>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        {onReturnToStock && ['assigned_to_retailer', 'assigned_to_distributor', 'assigned_to_master_distributor', 'assigned_to_partner'].includes(machine.inventory_status || '') && (
                          <button
                            onClick={() => onReturnToStock(machine)}
                            className="p-1.5 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded transition-colors"
                            title="Return to stock"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
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
        {filteredMachines.length > 0 && (
          <div className="px-3 py-2 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <span>Rows per page:</span>
              <select
                value={posListPageSize}
                onChange={(e) => {
                  setPosListPageSize(Number(e.target.value) as 10 | 25 | 100)
                  setPosListPage(1)
                }}
                className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={100}>100</option>
              </select>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {(posListPageSafe - 1) * posListPageSize + 1}–{Math.min(posListPageSafe * posListPageSize, filteredMachines.length)} of {filteredMachines.length}
              </span>
            </div>
            {posListTotalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPosListPage((p) => Math.max(1, p - 1))}
                  disabled={posListPageSafe <= 1}
                  className="p-1.5 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-gray-600 dark:text-gray-400 px-2">
                  {posListPageSafe} / {posListTotalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPosListPage((p) => Math.min(posListTotalPages, p + 1))}
                  disabled={posListPageSafe >= posListTotalPages}
                  className="p-1.5 rounded border border-gray-300 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}
        {selectedItems.size > 0 && (
          <div className="px-3 py-2 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {selectedItems.size} selected
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setBulkModalPickedIds(new Set(selectedItems))
                  setBulkModalSearch('')
                  setBulkAssignError(null)
                  setBulkAssignSummary(null)
                  setBulkAssignTargetId('')
                  setBulkAssignUserSearch('')
                  setBulkNotes('')
                  setBulkSubscriptionAmount('')
                  setBulkBillingDay(1)
                  setShowBulkAssignModal(true)
                }}
                className="text-sm flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700"
              >
                <UserPlus className="w-4 h-4" />
                Assign Selected
              </button>
              {onBulkReturn && (
                <button
                  type="button"
                  onClick={() => {
                    setBulkModalPickedIds(new Set(selectedItems))
                    setBulkModalSearch('')
                    setShowBulkReturnModal(true)
                  }}
                  className="text-sm flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700"
                >
                  <RotateCcw className="w-4 h-4" />
                  Return Selected
                </button>
              )}
              {onBulkDelete && (
                <button
                  type="button"
                  onClick={() => {
                    setBulkModalPickedIds(new Set(selectedItems))
                    setBulkModalSearch('')
                    setShowBulkDeleteModal(true)
                  }}
                  className="text-sm flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete Selected
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bulk Assign Modal — with machine picker */}
      <AnimatePresence>
        {showBulkAssignModal && (() => {
          const aq = bulkModalSearch.toLowerCase()
          const assignSearched = posMachines.filter((m) => {
            if (!aq) return true
            return (
              m.machine_id.toLowerCase().includes(aq) ||
              (m.tid || '').toLowerCase().includes(aq) ||
              (m.serial_number || '').toLowerCase().includes(aq) ||
              (m.mid || '').toLowerCase().includes(aq)
            )
          })
          const assignPickedCount = bulkModalPickedIds.size
          return (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
              onClick={() => !bulkAssigning && setShowBulkAssignModal(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-full">
                      <UserPlus className="w-5 h-5 text-green-600 dark:text-green-400" />
                    </div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                      Bulk Assign POS Machines
                    </h2>
                  </div>
                  <button type="button" onClick={() => !bulkAssigning && setShowBulkAssignModal(false)} disabled={bulkAssigning} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Step 1: Select machines */}
                <div className="mb-4">
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">1. Select machines ({assignPickedCount} selected)</h3>
                  <div className="relative mb-2">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                      type="text"
                      placeholder="Search by TID, Machine ID, SN, MID…"
                      value={bulkModalSearch}
                      onChange={(e) => setBulkModalSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                    <div className="max-h-48 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                          <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                            <th className="px-3 py-2 font-medium w-8">
                              <input
                                type="checkbox"
                                checked={assignSearched.length > 0 && assignSearched.every((m) => bulkModalPickedIds.has(m.id))}
                                onChange={(e) => {
                                  const next = new Set(bulkModalPickedIds)
                                  if (e.target.checked) { assignSearched.forEach((m) => next.add(m.id)) }
                                  else { assignSearched.forEach((m) => next.delete(m.id)) }
                                  setBulkModalPickedIds(next)
                                }}
                                className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                              />
                            </th>
                            <th className="px-2 py-2 font-medium">TID</th>
                            <th className="px-2 py-2 font-medium">Machine ID</th>
                            <th className="px-2 py-2 font-medium">Inventory</th>
                          </tr>
                        </thead>
                        <tbody>
                          {assignSearched.slice(0, 100).map((m) => (
                            <tr
                              key={m.id}
                              className={`border-b border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 ${bulkModalPickedIds.has(m.id) ? 'bg-green-50 dark:bg-green-900/10' : ''}`}
                              onClick={() => { const next = new Set(bulkModalPickedIds); if (next.has(m.id)) next.delete(m.id); else next.add(m.id); setBulkModalPickedIds(next) }}
                            >
                              <td className="px-3 py-1.5">
                                <input type="checkbox" checked={bulkModalPickedIds.has(m.id)} onChange={() => {}} className="rounded border-gray-300 text-green-600 focus:ring-green-500 pointer-events-none" />
                              </td>
                              <td className="px-2 py-1.5 font-mono text-gray-900 dark:text-gray-100">{m.tid || '—'}</td>
                              <td className="px-2 py-1.5 text-gray-700 dark:text-gray-300">{m.machine_id}</td>
                              <td className="px-2 py-1.5 text-xs">{(m.inventory_status || '').replace(/_/g, ' ')}</td>
                            </tr>
                          ))}
                          {assignSearched.length === 0 && (
                            <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400 text-sm">No machines found</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  {assignPickedCount > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                      {Array.from(bulkModalPickedIds).map((id) => {
                        const m = posMachines.find((pm) => pm.id === id)
                        return (
                          <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 text-xs rounded-full font-mono">
                            {m?.tid || m?.machine_id || id.slice(0, 8)}
                            <button type="button" onClick={() => { const n = new Set(bulkModalPickedIds); n.delete(id); setBulkModalPickedIds(n) }} className="hover:text-green-600"><X className="w-3 h-3" /></button>
                          </span>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* Step 2: Assignment target */}
                <div className="space-y-3 mb-4">
                  <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">2. Assign to</h3>
                  <select
                    value={bulkAssignRole}
                    onChange={(e) => {
                      setBulkAssignRole(
                        e.target.value as 'master_distributor' | 'partner'
                      )
                      setBulkAssignTargetId('')
                      setBulkAssignUserSearch('')
                    }}
                    disabled={bulkAssigning}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                  >
                    <option value="master_distributor">Master Distributor (MD)</option>
                    <option value="partner">Partner</option>
                  </select>
                  <input
                    type="text"
                    value={bulkAssignUserSearch}
                    onChange={(e) => setBulkAssignUserSearch(e.target.value)}
                    disabled={bulkAssigning}
                    placeholder="Filter by name, ID, email…"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                  />
                  <select
                    value={bulkAssignTargetId}
                    onChange={(e) => setBulkAssignTargetId(e.target.value)}
                    disabled={bulkAssigning}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                  >
                    <option value="">
                      Select{' '}
                      {bulkAssignRole === 'master_distributor'
                        ? 'Master Distributor'
                        : 'Partner'}
                      …
                    </option>
                    {(bulkAssignRole === 'master_distributor'
                      ? masterDistributors.filter((m) => {
                          const q2 = bulkAssignUserSearch.toLowerCase()
                          if (!q2) return true
                          return (
                            (m.name || '').toLowerCase().includes(q2) ||
                            (m.partner_id || '').toLowerCase().includes(q2) ||
                            (m.email || '').toLowerCase().includes(q2)
                          )
                        })
                      : partners.filter((p) => {
                          const q2 = bulkAssignUserSearch.toLowerCase()
                          if (!q2) return true
                          return (
                            (p.name || '').toLowerCase().includes(q2) ||
                            (p.id || '').toLowerCase().includes(q2) ||
                            (p.email || '').toLowerCase().includes(q2) ||
                            (p.business_name || '').toLowerCase().includes(q2)
                          )
                        })
                    ).map((row: any) => {
                      const value = bulkAssignRole === 'partner' ? row.id : row.partner_id
                      const label = row.name || row.business_name || value
                      return (
                        <option key={value} value={value}>
                          {label} — {value}
                        </option>
                      )
                    })}
                  </select>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Assignment Date <span className="text-red-500">*</span></label>
                    <input type="date" value={bulkAssignDate} onChange={(e) => setBulkAssignDate(e.target.value)} disabled={bulkAssigning} required className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                  </div>
                  <input type="text" value={bulkNotes} onChange={(e) => setBulkNotes(e.target.value)} disabled={bulkAssigning} placeholder="Notes (optional)" className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                  {bulkAssignRole !== 'partner' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Subscription / month (optional)</label>
                        <input type="number" min={0} step="0.01" value={bulkSubscriptionAmount} onChange={(e) => setBulkSubscriptionAmount(e.target.value)} disabled={bulkAssigning} placeholder="Leave empty to skip" className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Billing day (1–28)</label>
                        <input type="number" min={1} max={28} value={bulkBillingDay} onChange={(e) => setBulkBillingDay(Math.max(1, Math.min(28, parseInt(e.target.value, 10) || 1)))} disabled={bulkAssigning} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                      </div>
                    </div>
                  )}
                </div>

                {bulkAssignError && (
                  <div className="p-3 mb-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-800 dark:text-red-300 whitespace-pre-line">{bulkAssignError}</div>
                )}
                {bulkAssignSummary && (
                  <div className="p-3 mb-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-800 dark:text-green-300 whitespace-pre-line">{bulkAssignSummary}</div>
                )}
                <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-700">
                  <button type="button" onClick={() => !bulkAssigning && setShowBulkAssignModal(false)} disabled={bulkAssigning} className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={bulkAssigning || !bulkAssignTargetId || assignPickedCount === 0 || !bulkAssignDate}
                    onClick={async () => {
                      if (!bulkAssignTargetId || assignPickedCount === 0) return
                      setBulkAssigning(true)
                      setBulkAssignError(null)
                      setBulkAssignSummary(null)
                      try {
                        if (!bulkAssignDate) {
                          setBulkAssignError('Assignment date is required')
                          setBulkAssigning(false)
                          return
                        }
                        const payload: Record<string, unknown> = {
                          machine_ids: Array.from(bulkModalPickedIds),
                          assign_to: bulkAssignTargetId,
                          assign_to_type: bulkAssignRole,
                          notes: bulkNotes.trim() || undefined,
                          assigned_date: new Date(bulkAssignDate + 'T00:00:00').toISOString(),
                        }
                        const amt = bulkSubscriptionAmount.trim()
                        if (bulkAssignRole !== 'partner' && amt) {
                          const n = parseFloat(amt)
                          if (!Number.isNaN(n) && n > 0) {
                            payload.subscription_amount = n
                            payload.billing_day = bulkBillingDay
                            payload.gst_percent = 18
                          }
                        }
                        const res = await apiFetch('/api/admin/pos-machines/bulk-assign', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(payload),
                        })
                        const data = await res.json()
                        if (!res.ok) {
                          setBulkAssignError(data.error || 'Bulk assign failed')
                          return
                        }
                        const failList = (data.failed || []) as { id: string; error: string }[]
                        const failShown = failList.slice(0, 15)
                        const lines = [
                          `Done: ${data.succeeded_count} succeeded, ${data.failed_count} failed (of ${data.total}).`,
                          ...(failShown.length ? ['', 'Failures:', ...failShown.map((f) => `• ${f.id.slice(0, 8)}… — ${f.error}`), ...(failList.length > 15 ? [`… and ${failList.length - 15} more`] : [])] : []),
                        ]
                        setBulkAssignSummary(lines.join('\n'))
                        if (data.failed_count === 0) {
                          setSelectedItems(new Set())
                          setBulkModalPickedIds(new Set())
                          setShowBulkAssignModal(false)
                          onRefresh()
                        } else {
                          onRefresh()
                        }
                      } catch (e: any) {
                        setBulkAssignError(e?.message || 'Request failed')
                      } finally {
                        setBulkAssigning(false)
                      }
                    }}
                    className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50"
                  >
                    {bulkAssigning ? 'Assigning…' : `Assign ${assignPickedCount} Machine${assignPickedCount !== 1 ? 's' : ''}`}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )
        })()}
      </AnimatePresence>

      {/* Bulk Delete Modal — with machine picker */}
      <AnimatePresence>
        {showBulkDeleteModal && (() => {
          const q = bulkModalSearch.toLowerCase()
          const searchedMachines = posMachines.filter((m) => {
            if (!q) return true
            return (
              m.machine_id.toLowerCase().includes(q) ||
              (m.tid || '').toLowerCase().includes(q) ||
              (m.serial_number || '').toLowerCase().includes(q) ||
              (m.mid || '').toLowerCase().includes(q)
            )
          })
          const pickedCount = bulkModalPickedIds.size
          return (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
              onClick={() => !bulkDeleting && setShowBulkDeleteModal(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] flex flex-col"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-full">
                      <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400" />
                    </div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                      Bulk Delete POS Machines
                    </h2>
                  </div>
                  <button type="button" onClick={() => !bulkDeleting && setShowBulkDeleteModal(false)} disabled={bulkDeleting} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  Search and select machines to delete. <strong>{pickedCount}</strong> selected.
                </p>
                <div className="relative mb-3">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    type="text"
                    placeholder="Search by TID, Machine ID, SN, MID…"
                    value={bulkModalSearch}
                    onChange={(e) => setBulkModalSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                  />
                </div>
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden flex-1 min-h-0 mb-4">
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                        <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                          <th className="px-3 py-2 font-medium w-8">
                            <input
                              type="checkbox"
                              checked={searchedMachines.length > 0 && searchedMachines.every((m) => bulkModalPickedIds.has(m.id))}
                              onChange={(e) => {
                                const next = new Set(bulkModalPickedIds)
                                if (e.target.checked) {
                                  searchedMachines.forEach((m) => next.add(m.id))
                                } else {
                                  searchedMachines.forEach((m) => next.delete(m.id))
                                }
                                setBulkModalPickedIds(next)
                              }}
                              className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                            />
                          </th>
                          <th className="px-2 py-2 font-medium">TID</th>
                          <th className="px-2 py-2 font-medium">Machine ID</th>
                          <th className="px-2 py-2 font-medium">Status</th>
                          <th className="px-2 py-2 font-medium">Inventory</th>
                        </tr>
                      </thead>
                      <tbody>
                        {searchedMachines.slice(0, 100).map((m) => (
                          <tr
                            key={m.id}
                            className={`border-b border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 ${bulkModalPickedIds.has(m.id) ? 'bg-red-50 dark:bg-red-900/10' : ''}`}
                            onClick={() => {
                              const next = new Set(bulkModalPickedIds)
                              if (next.has(m.id)) next.delete(m.id)
                              else next.add(m.id)
                              setBulkModalPickedIds(next)
                            }}
                          >
                            <td className="px-3 py-1.5">
                              <input
                                type="checkbox"
                                checked={bulkModalPickedIds.has(m.id)}
                                onChange={() => {}}
                                className="rounded border-gray-300 text-red-600 focus:ring-red-500 pointer-events-none"
                              />
                            </td>
                            <td className="px-2 py-1.5 font-mono text-gray-900 dark:text-gray-100">{m.tid || '—'}</td>
                            <td className="px-2 py-1.5 text-gray-700 dark:text-gray-300">{m.machine_id}</td>
                            <td className="px-2 py-1.5 text-xs">{m.status}</td>
                            <td className="px-2 py-1.5 text-xs">{(m.inventory_status || '').replace(/_/g, ' ')}</td>
                          </tr>
                        ))}
                        {searchedMachines.length === 0 && (
                          <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400 text-sm">No machines found</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                {pickedCount > 0 && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4 max-h-32 overflow-y-auto">
                    <p className="text-xs font-medium text-red-800 dark:text-red-300 mb-1">Will delete {pickedCount} machine(s):</p>
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from(bulkModalPickedIds).map((id) => {
                        const m = posMachines.find((pm) => pm.id === id)
                        return (
                          <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 text-xs rounded-full font-mono">
                            {m?.tid || m?.machine_id || id.slice(0, 8)}
                            <button type="button" onClick={() => { const n = new Set(bulkModalPickedIds); n.delete(id); setBulkModalPickedIds(n) }} className="hover:text-red-600">
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-200 dark:border-gray-700">
                  <button type="button" disabled={bulkDeleting} onClick={() => setShowBulkDeleteModal(false)} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg disabled:opacity-50">
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={bulkDeleting || pickedCount === 0}
                    onClick={async () => {
                      if (!onBulkDelete || pickedCount === 0) return
                      setBulkDeleting(true)
                      try {
                        await onBulkDelete(Array.from(bulkModalPickedIds))
                        setSelectedItems(new Set())
                        setBulkModalPickedIds(new Set())
                        setShowBulkDeleteModal(false)
                      } finally {
                        setBulkDeleting(false)
                      }
                    }}
                    className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50"
                  >
                    {bulkDeleting ? 'Deleting…' : `Delete ${pickedCount} Machine${pickedCount !== 1 ? 's' : ''}`}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )
        })()}
      </AnimatePresence>

      {/* Bulk Return to Stock Modal — with machine picker */}
      <AnimatePresence>
        {showBulkReturnModal && (() => {
          const assignableStatuses = ['assigned_to_retailer', 'assigned_to_distributor', 'assigned_to_master_distributor', 'assigned_to_partner']
          const q = bulkModalSearch.toLowerCase()
          const searchedMachines = posMachines.filter((m) => {
            if (!assignableStatuses.includes(m.inventory_status || '')) return false
            if (!q) return true
            return (
              m.machine_id.toLowerCase().includes(q) ||
              (m.tid || '').toLowerCase().includes(q) ||
              (m.serial_number || '').toLowerCase().includes(q) ||
              (m.mid || '').toLowerCase().includes(q)
            )
          })
          const pickedCount = bulkModalPickedIds.size
          const pickedAssignedCount = Array.from(bulkModalPickedIds).filter((id) => {
            const m = posMachines.find((pm) => pm.id === id)
            return m && assignableStatuses.includes(m.inventory_status || '')
          }).length
          return (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
              onClick={() => !bulkReturning && setShowBulkReturnModal(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] flex flex-col"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-full">
                      <RotateCcw className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                      Bulk Return to Stock
                    </h2>
                  </div>
                  <button type="button" onClick={() => !bulkReturning && setShowBulkReturnModal(false)} disabled={bulkReturning} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  Only assigned machines are shown. Select machines to return to stock. <strong>{pickedCount}</strong> selected.
                </p>
                <div className="relative mb-3">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    type="text"
                    placeholder="Search by TID, Machine ID, SN, MID…"
                    value={bulkModalSearch}
                    onChange={(e) => setBulkModalSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                  />
                </div>
                <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden flex-1 min-h-0 mb-4">
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                        <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                          <th className="px-3 py-2 font-medium w-8">
                            <input
                              type="checkbox"
                              checked={searchedMachines.length > 0 && searchedMachines.every((m) => bulkModalPickedIds.has(m.id))}
                              onChange={(e) => {
                                const next = new Set(bulkModalPickedIds)
                                if (e.target.checked) {
                                  searchedMachines.forEach((m) => next.add(m.id))
                                } else {
                                  searchedMachines.forEach((m) => next.delete(m.id))
                                }
                                setBulkModalPickedIds(next)
                              }}
                              className="rounded border-gray-300 text-amber-600 focus:ring-amber-500"
                            />
                          </th>
                          <th className="px-2 py-2 font-medium">TID</th>
                          <th className="px-2 py-2 font-medium">Machine ID</th>
                          <th className="px-2 py-2 font-medium">Inventory Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {searchedMachines.slice(0, 100).map((m) => (
                          <tr
                            key={m.id}
                            className={`border-b border-gray-100 dark:border-gray-800 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 ${bulkModalPickedIds.has(m.id) ? 'bg-amber-50 dark:bg-amber-900/10' : ''}`}
                            onClick={() => {
                              const next = new Set(bulkModalPickedIds)
                              if (next.has(m.id)) next.delete(m.id)
                              else next.add(m.id)
                              setBulkModalPickedIds(next)
                            }}
                          >
                            <td className="px-3 py-1.5">
                              <input
                                type="checkbox"
                                checked={bulkModalPickedIds.has(m.id)}
                                onChange={() => {}}
                                className="rounded border-gray-300 text-amber-600 focus:ring-amber-500 pointer-events-none"
                              />
                            </td>
                            <td className="px-2 py-1.5 font-mono text-gray-900 dark:text-gray-100">{m.tid || '—'}</td>
                            <td className="px-2 py-1.5 text-gray-700 dark:text-gray-300">{m.machine_id}</td>
                            <td className="px-2 py-1.5 text-xs">{(m.inventory_status || '').replace(/_/g, ' ')}</td>
                          </tr>
                        ))}
                        {searchedMachines.length === 0 && (
                          <tr><td colSpan={4} className="px-3 py-4 text-center text-gray-400 text-sm">No assigned machines found</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="space-y-3 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Return Date <span className="text-red-500">*</span></label>
                    <input type="date" value={bulkReturnDate} onChange={(e) => setBulkReturnDate(e.target.value)} disabled={bulkReturning} required className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Return Reason</label>
                    <input type="text" value={bulkReturnReason} onChange={(e) => setBulkReturnReason(e.target.value)} disabled={bulkReturning} placeholder="Reason for return (optional)" className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
                  </div>
                </div>
                {pickedCount > 0 && (
                  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 mb-4 max-h-32 overflow-y-auto">
                    <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-1">Will return {pickedAssignedCount} machine(s):</p>
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from(bulkModalPickedIds).map((id) => {
                        const m = posMachines.find((pm) => pm.id === id)
                        return (
                          <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 text-xs rounded-full font-mono">
                            {m?.tid || m?.machine_id || id.slice(0, 8)}
                            <button type="button" onClick={() => { const n = new Set(bulkModalPickedIds); n.delete(id); setBulkModalPickedIds(n) }} className="hover:text-amber-600">
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        )
                      })}
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-200 dark:border-gray-700">
                  <button type="button" disabled={bulkReturning} onClick={() => setShowBulkReturnModal(false)} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg disabled:opacity-50">
                    Cancel
                  </button>
                  {pickedAssignedCount > 0 && onBulkReturn && (
                    <button
                      type="button"
                      disabled={bulkReturning}
                      onClick={async () => {
                        if (!bulkReturnDate) { showToast('Return date is required', 'error'); return }
                        const ids = Array.from(bulkModalPickedIds).filter((id) => {
                          const m = posMachines.find((pm) => pm.id === id)
                          return m && assignableStatuses.includes(m.inventory_status || '')
                        })
                        setBulkReturning(true)
                        const returnDateISO = new Date(bulkReturnDate + 'T00:00:00').toISOString()
                        try {
                          const r = await onBulkReturn(ids, returnDateISO, bulkReturnReason.trim() || undefined)
                          showToast(`Returned ${r.ok} machine(s) to stock.${r.fail > 0 ? ` ${r.fail} failed.` : ''}`, r.fail > 0 ? 'warning' : 'success')
                          setSelectedItems(new Set())
                          setBulkModalPickedIds(new Set())
                          setShowBulkReturnModal(false)
                          onRefresh()
                        } finally {
                          setBulkReturning(false)
                        }
                      }}
                      className="px-4 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50"
                    >
                      {bulkReturning ? 'Returning…' : `Return ${pickedAssignedCount} Machine${pickedAssignedCount !== 1 ? 's' : ''}`}
                    </button>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )
        })()}
      </AnimatePresence>

      {/* Bulk Upload Modal */}
      <AnimatePresence>
        {showBulkUploadModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => !uploading && setShowBulkUploadModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                  Bulk Upload POS Machines
                </h2>
                <button
                  onClick={() => !uploading && setShowBulkUploadModal(false)}
                  disabled={uploading}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-50"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Select CSV File
                  </label>
                  <div className="flex items-center gap-4">
                    <label className="flex-1 cursor-pointer">
                      <input
                        type="file"
                        accept=".csv,.tsv,text/csv"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) {
                            setUploadFile(file)
                            setUploadError(null)
                            setUploadSuccess(null)
                          }
                        }}
                        disabled={uploading}
                        className="hidden"
                      />
                      <div className="flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 disabled:opacity-50">
                        <FileSpreadsheetIcon className="w-5 h-5" />
                        <span className="flex-1 truncate">
                          {uploadFile ? uploadFile.name : 'Choose CSV file...'}
                        </span>
                      </div>
                    </label>
                  </div>
                </div>

                {uploadFile && (
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                    <p className="text-sm text-blue-800 dark:text-blue-300">
                      <strong>Selected:</strong> {uploadFile.name} ({(uploadFile.size / 1024).toFixed(2)} KB)
                    </p>
                  </div>
                )}

                {uploadError && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <p className="text-sm text-red-800 dark:text-red-300 whitespace-pre-line">
                      {uploadError}
                    </p>
                  </div>
                )}

                {uploadSuccess && (
                  <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                    <p className="text-sm text-green-800 dark:text-green-300">
                      {uploadSuccess}
                    </p>
                  </div>
                )}

                <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                    CSV Format Requirements:
                  </h3>
                  <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1 list-disc list-inside">
                    <li><strong>Stock intake only:</strong> columns are serial_number, MID, TID, Brand, machine_type, inventory_status, status, delivery_date, installation_date, location, city, state, pincode, notes (no retailer/distributor/master_distributor).</li>
                    <li><strong>inventory_status</strong> must be exactly <code className="text-primary-600 dark:text-primary-400">in_stock</code>. Assign machines to retailers using the normal POS flow, not this upload.</li>
                    <li>Machine ID is stored as <code className="text-primary-600 dark:text-primary-400">MID_TID</code>. MID and TID are required; serial_number is required.</li>
                    <li><strong>machine_type:</strong> POS, WPOS, or Mini-ATM</li>
                    <li><strong>status:</strong> active, inactive, maintenance, damaged, returned</li>
                    <li>Comma- or tab-separated files (.csv / .tsv). Dates: YYYY-MM-DD or DD/MM/YYYY.</li>
                    <li>Duplicates and errors are rejected: duplicate machine ID (MID_TID) or serial in the file or already in the database.</li>
                  </ul>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <button
                    onClick={() => {
                      setShowBulkUploadModal(false)
                      setUploadFile(null)
                      setUploadError(null)
                      setUploadSuccess(null)
                    }}
                    disabled={uploading}
                    className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleFileUpload}
                    disabled={!uploadFile || uploading}
                    className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {uploading ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" />
                        Upload CSV
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// POS Machine Modal Component
function POSMachineModal({
  item,
  retailers,
  distributors,
  masterDistributors,
  partners,
  onClose,
  onSuccess,
}: {
  item: POSMachine | null
  retailers: Retailer[]
  distributors: Distributor[]
  masterDistributors: MasterDistributor[]
  partners: any[]
  onClose: () => void
  onSuccess: () => void
}) {
  const { showToast } = useToast()
  const [formData, setFormData] = useState({
    machine_id: '',
    serial_number: '',
    mid: '',
    tid: '',
    brand: '',
    retailer_id: '',
    distributor_id: '',
    master_distributor_id: '',
    partner_id: '',
    machine_type: 'POS' as 'POS' | 'WPOS' | 'Mini-ATM',
    status: 'active' as 'active' | 'inactive' | 'maintenance' | 'damaged' | 'returned',
    inventory_status: 'in_stock' as 'in_stock' | 'received_from_bank' | 'assigned_to_retailer' | 'assigned_to_distributor' | 'assigned_to_master_distributor' | 'assigned_to_partner' | 'damaged_from_bank',
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
        mid: item.mid || '',
        tid: item.tid || '',
        brand: item.brand || '',
        retailer_id: item.retailer_id || '',
        distributor_id: item.distributor_id || '',
        master_distributor_id: item.master_distributor_id || '',
        partner_id: item.partner_id || '',
        machine_type: item.machine_type || 'POS',
        status: item.status || 'active',
        inventory_status: item.inventory_status || 'in_stock',
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

    const isAssignToMD = formData.inventory_status === 'assigned_to_master_distributor'
    const isAssignToPartner = formData.inventory_status === 'assigned_to_partner'

    if (isAssignToMD && !formData.master_distributor_id) {
      showToast('Master Distributor is required when assigning to master distributor', 'error')
      return
    }

    if (isAssignToPartner && !formData.partner_id) {
      showToast('Partner is required when assigning to partner', 'error')
      return
    }

    setLoading(true)

    try {
      const isReturningToStock = ['in_stock', 'received_from_bank', 'damaged_from_bank'].includes(formData.inventory_status)

      const machineData: any = {
        machine_id: formData.machine_id,
        serial_number: formData.serial_number || null,
        mid: formData.mid || null,
        tid: formData.tid || null,
        brand: formData.brand || null,
        retailer_id: isReturningToStock ? null : null,
        distributor_id: isReturningToStock ? null : null,
        master_distributor_id: (isAssignToMD && !isReturningToStock) ? (formData.master_distributor_id || null) : null,
        partner_id: (isAssignToPartner && !isReturningToStock) ? (formData.partner_id || null) : null,
        machine_type: formData.machine_type,
        status: formData.status,
        inventory_status: formData.inventory_status,
        assigned_by: isReturningToStock ? null : undefined,
        assigned_by_role: isReturningToStock ? null : undefined,
        last_assigned_at: isReturningToStock ? null : undefined,
        delivery_date: formData.delivery_date || null,
        installation_date: formData.installation_date || null,
        location: formData.location || null,
        city: formData.city || null,
        state: formData.state || null,
        pincode: formData.pincode || null,
        notes: formData.notes || null,
      }

      if (!isReturningToStock) {
        delete machineData.assigned_by
        delete machineData.assigned_by_role
        delete machineData.last_assigned_at
      }

      let savedMachineId: string
      if (item) {
        const { error } = await supabase
          .from('pos_machines')
          .update(machineData)
          .eq('id', item.id)

        if (error) throw error
        savedMachineId = item.id
      } else {
        const { data: inserted, error } = await supabase
          .from('pos_machines')
          .insert([machineData])
          .select('id')
          .single()

        if (error) throw error
        savedMachineId = inserted.id
      }

      // Sync to partner_pos_machines if assigned to partner
      if (isAssignToPartner && formData.partner_id) {
        try {
          const syncResponse = await apiFetch('/api/admin/sync-partner-pos-machine', {
            method: 'POST',
            body: JSON.stringify({ machine_id: savedMachineId }),
          })
          const syncResult = await syncResponse.json()
          if (!syncResult.success) {
            console.warn('Failed to sync to partner_pos_machines:', syncResult.error)
          }
        } catch (syncError) {
          console.error('Error syncing to partner_pos_machines:', syncError)
        }
      }

      // Record assignment history for any non-stock inventory status
      const hasAssignment = ['assigned_to_master_distributor', 'assigned_to_partner'].includes(formData.inventory_status)
      if (hasAssignment) {
        try {
          let assignedTo: string | null = null
          let assignedToRole: string | null = null
          let previousHolder: string | null = null
          let previousHolderRole: string | null = null

          if (formData.inventory_status === 'assigned_to_master_distributor' && formData.master_distributor_id) {
            assignedTo = formData.master_distributor_id
            assignedToRole = 'master_distributor'
          } else if (formData.inventory_status === 'assigned_to_partner' && formData.partner_id) {
            assignedTo = formData.partner_id
            assignedToRole = 'partner'
          }

          if (item) {
            previousHolder = item.retailer_id || item.distributor_id || item.master_distributor_id || item.partner_id || null
            previousHolderRole = item.retailer_id ? 'retailer' : item.distributor_id ? 'distributor' : item.master_distributor_id ? 'master_distributor' : item.partner_id ? 'partner' : null
          }

          const histRes = await apiFetch('/api/admin/pos-machines/history', {
            method: 'POST',
            body: JSON.stringify({
              pos_machine_id: savedMachineId,
              machine_id: formData.machine_id,
              action: item ? formData.inventory_status : 'created',
              assigned_to: assignedTo,
              assigned_to_role: assignedToRole,
              previous_holder: previousHolder,
              previous_holder_role: previousHolderRole,
              notes: item ? `Admin updated assignment` : `Admin created with status ${formData.inventory_status}`,
            }),
          })
          if (!histRes.ok) {
            const errData = await histRes.json().catch(() => ({}))
            console.warn('POS history record failed:', errData)
            showToast(`POS saved, but the assignment was not recorded in POS History. ${errData?.error || 'Please use the "Backfill" button on the POS History tab to sync existing assignments.'}`, 'warning')
          }
        } catch (histErr) {
          console.warn('Failed to record POS history:', histErr)
          showToast('POS saved, but the assignment could not be recorded in POS History. Use the "Backfill" button on the POS History tab to sync existing assignments.', 'warning')
        }
      }

      // Record return history when editing from assigned → stock
      const wasAssigned = item && ['assigned_to_retailer', 'assigned_to_distributor', 'assigned_to_master_distributor', 'assigned_to_partner'].includes(item.inventory_status || '')
      if (wasAssigned && isReturningToStock) {
        try {
          const prevHolder = item.retailer_id || item.distributor_id || item.master_distributor_id || item.partner_id || null
          const prevRole = item.retailer_id ? 'retailer' : item.distributor_id ? 'distributor' : item.master_distributor_id ? 'master_distributor' : item.partner_id ? 'partner' : null
          const unassignAction = prevRole ? `unassigned_from_${prevRole}` : 'unassigned_from_retailer'

          await apiFetch('/api/admin/pos-machines/history', {
            method: 'POST',
            body: JSON.stringify({
              pos_machine_id: savedMachineId,
              machine_id: formData.machine_id,
              action: unassignAction,
              assigned_to: null,
              assigned_to_role: null,
              previous_holder: prevHolder,
              previous_holder_role: prevRole,
              notes: `Returned to stock by admin (edit). Was ${item.inventory_status}.`,
            }),
          })
        } catch (histErr) {
          console.warn('Failed to record return history:', histErr)
        }
      }

      onSuccess()
    } catch (error: any) {
      console.error('Error saving POS machine:', error)
      showToast(error.message || 'Failed to save POS machine', 'error')
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Device Serial Number</label>
              <input
                type="text"
                value={formData.serial_number}
                onChange={(e) => setFormData({ ...formData, serial_number: e.target.value })}
                placeholder="e.g., 2841154268"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">MID (Merchant ID)</label>
              <input
                type="text"
                value={formData.mid}
                onChange={(e) => setFormData({ ...formData, mid: e.target.value })}
                placeholder="e.g., 7568516041"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">TID (Terminal ID)</label>
              <input
                type="text"
                value={formData.tid}
                onChange={(e) => setFormData({ ...formData, tid: e.target.value })}
                placeholder="e.g., 29196333"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Brand</label>
              <input
                type="text"
                value={formData.brand}
                onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
                placeholder="e.g. RAZORPAY, Ingenico, PAX, Verifone"
                list="pos-brand-presets"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              />
              <datalist id="pos-brand-presets">
                <option value="RAZORPAY" />
                <option value="PINELAB" />
                <option value="PAYTM" />
                <option value="ICICI" />
                <option value="HDFC" />
                <option value="AXIS" />
                <option value="OTHER" />
                <option value="Ingenico" />
                <option value="PAX" />
                <option value="Verifone" />
              </datalist>
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Inventory Status *</label>
              <select
                required
                value={formData.inventory_status}
                onChange={(e) => setFormData({ ...formData, inventory_status: e.target.value as any })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              >
                <option value="in_stock">In Stock</option>
                <option value="received_from_bank">Received from Bank</option>
                <option value="assigned_to_master_distributor">Assigned to Master Distributor</option>
                <option value="assigned_to_partner">Assigned to Partner</option>
                <option value="damaged_from_bank">Damaged from Bank</option>
              </select>
            </div>
            {/* Hierarchical Flow Info */}
            <div className="col-span-1 md:col-span-2">
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-xs text-blue-800 dark:text-blue-300">
                <strong>💡 Hierarchical Assignment:</strong> Set inventory status to "In Stock" or "Received from Bank" to add to inventory. Then assign to Master Distributor via the POS assignment flow (MD → Distributor → Retailer). Or set "Assigned to Retailer" for direct assignment. You can also assign directly to a Partner by selecting "Assigned to Partner" status. <strong>Returned machines</strong> are eligible for reassignment — their status will automatically reset to "Active" upon reassignment.
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Master Distributor {formData.inventory_status === 'assigned_to_master_distributor' && <span className="text-red-500">*</span>}
              </label>
              <select
                value={formData.master_distributor_id}
                onChange={(e) => setFormData({ ...formData, master_distributor_id: e.target.value })}
                required={formData.inventory_status === 'assigned_to_master_distributor'}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              >
                <option value="">Select Master Distributor (Optional)</option>
                {masterDistributors
                  .filter(md => md.status === 'active')
                  .map((md) => (
                    <option key={md.id} value={md.partner_id}>
                      {md.partner_id} - {md.name}
                    </option>
                  ))}
              </select>
            </div>
            {/* Distributor & Retailer fields removed: admin can only assign to MD or Partner.
               Distributors are assigned by MDs, Retailers by Distributors. */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Partner {formData.inventory_status === 'assigned_to_partner' && <span className="text-red-500">*</span>}
              </label>
              <select
                value={formData.partner_id}
                onChange={(e) => setFormData({ ...formData, partner_id: e.target.value })}
                required={formData.inventory_status === 'assigned_to_partner'}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              >
                <option value="">Select Partner (Optional)</option>
                {partners
                  .filter(p => p.status === 'active')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.business_name ? `(${p.business_name})` : ''} - {p.email}
                    </option>
                  ))}
              </select>
              {formData.inventory_status === 'assigned_to_partner' && partners.filter(p => p.status === 'active').length === 0 && (
                <p className="text-xs text-red-500 mt-1">No active partners available. Please create one first.</p>
              )}
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

// Partners Management Tab Component
function PartnersTab() {
  const { showToast } = useToast()
  const [partners, setPartners] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'pending' | 'suspended'>('all')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showPasswordModal, setShowPasswordModal] = useState<any>(null)
  const [showWhitelistModal, setShowWhitelistModal] = useState<any>(null)
  const [editingPartner, setEditingPartner] = useState<any>(null)

  const [partnerWalletModal, setPartnerWalletModal] = useState<{
    partner: any
    action: 'push' | 'pull'
  } | null>(null)
  const [partnerWalletAmount, setPartnerWalletAmount] = useState('')
  const [partnerWalletRemarks, setPartnerWalletRemarks] = useState('')
  const [partnerWalletBalance, setPartnerWalletBalance] = useState<number | null>(null)
  const [partnerWalletLoadingBalance, setPartnerWalletLoadingBalance] = useState(false)
  const [partnerWalletSubmitting, setPartnerWalletSubmitting] = useState(false)

  useEffect(() => {
    fetchPartners()
  }, [])

  const fetchPartners = async () => {
    setLoading(true)
    try {
      // Fetch partners from database
      const { data, error } = await supabase
        .from('partners')
        .select('*')
        .order('created_at', { ascending: false })
      
      if (error) throw error
      setPartners(data || [])
    } catch (error) {
      console.error('Error fetching partners:', error)
      showToast('Failed to fetch partners', 'error')
      setPartners([])
    } finally {
      setLoading(false)
    }
  }

  const filteredPartners = partners.filter(p => {
    const matchesSearch = !searchTerm || 
      p.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.subdomain?.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesFilter = filter === 'all' || p.status === filter
    return matchesSearch && matchesFilter
  })

  const openPartnerWallet = async (partner: any, action: 'push' | 'pull') => {
    setPartnerWalletModal({ partner, action })
    setPartnerWalletAmount('')
    setPartnerWalletRemarks('')
    setPartnerWalletBalance(null)
    setPartnerWalletLoadingBalance(true)
    try {
      const res = await apiFetch(`/api/admin/partner-wallet/balance?partner_id=${encodeURIComponent(partner.id)}`)
      const json = await res.json()
      if (json.success && json.data && typeof json.data.balance === 'number') {
        setPartnerWalletBalance(json.data.balance)
      }
    } catch {
      setPartnerWalletBalance(null)
    } finally {
      setPartnerWalletLoadingBalance(false)
    }
  }

  const submitPartnerWallet = async () => {
    if (!partnerWalletModal) return
    const amt = parseFloat(partnerWalletAmount)
    if (isNaN(amt) || amt <= 0) {
      showToast('Enter a valid amount', 'error')
      return
    }
    setPartnerWalletSubmitting(true)
    try {
      const endpoint =
        partnerWalletModal.action === 'push'
          ? '/api/admin/partner-wallet/push'
          : '/api/admin/partner-wallet/pull'
      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partner_id: partnerWalletModal.partner.id,
          amount: amt,
          remarks: partnerWalletRemarks || undefined,
        }),
      })
      const data = await res.json()
      if (data.success) {
        showToast(data.message || 'Done', 'success')
        setPartnerWalletModal(null)
      } else {
        showToast(data.error || 'Action failed', 'error')
      }
    } catch (e: any) {
      showToast(e?.message || 'Request failed', 'error')
    } finally {
      setPartnerWalletSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Building2 className="w-6 h-6 text-primary-600" />
              Partners Management
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Manage co-branding partners
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Partner
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search partners..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm"
            />
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
      </div>

      {/* Partners List */}
      {loading ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-12 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-500 dark:text-gray-400">Loading partners...</p>
        </div>
      ) : filteredPartners.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-12 text-center">
          <Building2 className="w-16 h-16 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No partners found</h3>
          <p className="text-gray-500 dark:text-gray-400">No partners match your search criteria.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPartners.map((partner) => (
            <div key={partner.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                    <Building2 className="w-6 h-6 text-primary-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-white">{partner.name || 'Unnamed Partner'}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{partner.subdomain || 'No subdomain'}</p>
                  </div>
                </div>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                  partner.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                  partner.status === 'pending' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                  'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                }`}>
                  {partner.status || 'unknown'}
                </span>
              </div>
              {partner.email && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{partner.email}</p>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => openPartnerWallet(partner, 'push')}
                  className="flex-1 px-2 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors flex items-center justify-center gap-1"
                  title="Push balance"
                >
                  <ArrowUpCircle className="w-3.5 h-3.5" />
                  Push
                </button>
                <button
                  type="button"
                  onClick={() => openPartnerWallet(partner, 'pull')}
                  className="flex-1 px-2 py-1.5 text-xs bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center justify-center gap-1"
                  title="Pull balance"
                >
                  <ArrowDownCircle className="w-3.5 h-3.5" />
                  Pull
                </button>
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => setEditingPartner(partner)}
                  className="flex-1 px-3 py-1.5 text-xs bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors flex items-center justify-center gap-1"
                >
                  <Edit className="w-3 h-3" />
                  Edit
                </button>
                <button
                  onClick={() => setShowPasswordModal(partner)}
                  className="flex-1 px-3 py-1.5 text-xs bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors flex items-center justify-center gap-1"
                >
                  <Key className="w-3 h-3" />
                  Set Password
                </button>
              </div>
              <div className="mt-2">
                <button
                  onClick={() => setShowWhitelistModal(partner)}
                  className="w-full px-3 py-1.5 text-xs bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center justify-center gap-1"
                >
                  <Shield className="w-3 h-3" />
                  IP Whitelist
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Partner Modal */}
      <AnimatePresence>
        {showCreateModal && (
          <CreatePartnerModal
            onClose={() => setShowCreateModal(false)}
            onSuccess={() => {
              showToast('Partner created successfully', 'success')
              setShowCreateModal(false)
              fetchPartners()
            }}
          />
        )}
        {editingPartner && (
          <EditPartnerModal
            partner={editingPartner}
            onClose={() => setEditingPartner(null)}
            onSuccess={() => {
              showToast('Partner updated successfully', 'success')
              setEditingPartner(null)
              fetchPartners()
            }}
          />
        )}
        {showPasswordModal && (
          <SetPartnerPasswordModal
            partner={showPasswordModal}
            onClose={() => setShowPasswordModal(null)}
            onSuccess={() => {
              setShowPasswordModal(null)
              fetchPartners()
            }}
          />
        )}
        {showWhitelistModal && (
          <IPWhitelistModal
            partner={showWhitelistModal}
            onClose={() => setShowWhitelistModal(null)}
            onSuccess={() => {
              showToast('IP whitelist updated successfully', 'success')
              setShowWhitelistModal(null)
              fetchPartners()
            }}
          />
        )}
        {partnerWalletModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6 border border-gray-200 dark:border-gray-700"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <Wallet className="w-5 h-5 text-primary-600" />
                    {partnerWalletModal.action === 'push' ? 'Push' : 'Pull'} partner wallet
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    {partnerWalletModal.partner.name}
                  </p>
                  {partnerWalletLoadingBalance ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 flex items-center gap-1">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading balance...
                    </p>
                  ) : partnerWalletBalance !== null ? (
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 mt-2">
                      Current balance: ₹{partnerWalletBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={partnerWalletSubmitting}
                  onClick={() => setPartnerWalletModal(null)}
                  className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount (₹)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={partnerWalletAmount}
                    onChange={(e) => setPartnerWalletAmount(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Remarks (optional)</label>
                  <input
                    type="text"
                    value={partnerWalletRemarks}
                    onChange={(e) => setPartnerWalletRemarks(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                    placeholder="Note"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button
                  type="button"
                  disabled={partnerWalletSubmitting}
                  onClick={() => setPartnerWalletModal(null)}
                  className="px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={partnerWalletSubmitting}
                  onClick={submitPartnerWallet}
                  className={`px-4 py-2 rounded-lg text-white disabled:opacity-50 ${
                    partnerWalletModal.action === 'push'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {partnerWalletSubmitting ? <><Loader2 className="w-4 h-4 animate-spin inline mr-1" />Processing...</> : partnerWalletModal.action === 'push' ? 'Push funds' : 'Pull funds'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

// Create Partner Modal Component
function CreatePartnerModal({
  onClose,
  onSuccess
}: {
  onClose: () => void
  onSuccess: () => void
}) {
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)
  const [currentStep, setCurrentStep] = useState(1)
  const [showPartnerCreatePassword, setShowPartnerCreatePassword] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    partner_type: 'B2B' as 'B2B' | 'B2C',
    subdomain: '',
    contact_email: '',
    contact_phone: '',
    password: '',
    business_name: '',
    address: '',
    city: '',
    state: '',
    pincode: '',
    gst_number: '',
    gst_applicable: false,
    cin_applicable: false,
    cin_number: '',
    udhyam_applicable: false,
    udhyam_number: '',
    aadhar_number: '',
    pan_number: '',
    bank_name: '',
    account_number: '',
    ifsc_code: '',
    primary_color: '#3B82F6',
    secondary_color: '#10B981',
    logo_url: '',
    status: 'pending' as 'active' | 'pending' | 'suspended',
    notes: ''
  })

  // PAN verification
  const [panVerified, setPanVerified] = useState(false)
  const [panRegisteredName, setPanRegisteredName] = useState('')
  const [panType, setPanType] = useState('')
  const [verifyingPan, setVerifyingPan] = useState(false)
  const [panError, setPanError] = useState('')

  // Bank verification
  const [bankVerified, setBankVerified] = useState(false)
  const [bankVerifiedName, setBankVerifiedName] = useState('')
  const [bankUtr, setBankUtr] = useState('')
  const [verifyingBank, setVerifyingBank] = useState(false)
  const [bankError, setBankError] = useState('')
  const [bankNameMismatch, setBankNameMismatch] = useState('')

  // GST verification
  const [gstVerified, setGstVerified] = useState(false)
  const [gstLegalName, setGstLegalName] = useState('')
  const [gstTradeName, setGstTradeName] = useState('')
  const [gstGstStatus, setGstGstStatus] = useState('')
  const [gstTaxpayerType, setGstTaxpayerType] = useState('')
  const [gstConstitution, setGstConstitution] = useState('')
  const [gstAddress, setGstAddress] = useState('')
  const [verifyingGst, setVerifyingGst] = useState(false)
  const [gstError, setGstError] = useState('')

  // CIN verification
  const [cinVerified, setCinVerified] = useState(false)
  const [cinCompanyName, setCinCompanyName] = useState('')
  const [cinStatus, setCinStatus] = useState('')
  const [cinIncorporationDate, setCinIncorporationDate] = useState('')
  const [verifyingCin, setVerifyingCin] = useState(false)
  const [cinError, setCinError] = useState('')

  // Aadhaar / Digilocker
  const [aadhaarVerified, setAadhaarVerified] = useState(false)
  const [aadhaarName, setAadhaarName] = useState('')
  const [aadhaarGender, setAadhaarGender] = useState('')
  const [aadhaarDob, setAadhaarDob] = useState('')
  const [aadhaarAddress, setAadhaarAddress] = useState('')
  const [aadhaarUid, setAadhaarUid] = useState('')
  const [digilockerLoading, setDigilockerLoading] = useState(false)
  const [digilockerError, setDigilockerError] = useState('')
  const [digilockerUrl, setDigilockerUrl] = useState('')
  const [digilockerVerificationId, setDigilockerVerificationId] = useState('')

  const [ekychubOrderIds, setEkychubOrderIds] = useState<Record<string, string>>({})

  const indianStates = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Andaman and Nicobar Islands','Chandigarh','Dadra and Nagar Haveli and Daman and Diu','Delhi','Jammu and Kashmir','Ladakh','Lakshadweep','Puducherry']

  // Auto-fill from GST
  useEffect(() => {
    if (gstVerified && (gstTradeName || gstLegalName)) {
      setFormData(prev => ({ ...prev, business_name: gstTradeName || gstLegalName, address: gstAddress || prev.address }))
    }
  }, [gstVerified, gstTradeName, gstLegalName, gstAddress])

  // Auto-fill from Aadhaar
  useEffect(() => {
    if (aadhaarVerified && aadhaarAddress && !formData.gst_applicable) {
      setFormData(prev => ({ ...prev, address: aadhaarAddress || prev.address }))
    }
  }, [aadhaarVerified, aadhaarAddress])

  const fetchDigilockerDocument2 = async (verification_id: string, reference_id: string) => {
    try {
      const res = await apiFetch('/api/kyc/fetch-digilocker-document', {
        method: 'POST',
        body: JSON.stringify({ verification_id, reference_id, document_type: 'AADHAAR' })
      })
      const data = await res.json()
      if (data.success && data.data) {
        const d = data.data
        setAadhaarVerified(true); setAadhaarName(d.name || ''); setAadhaarUid(d.uid || '')
        setAadhaarDob(d.dob || ''); setAadhaarGender(d.gender || ''); setAadhaarAddress(d.address || '')
        if (d.verification_id) setDigilockerVerificationId(d.verification_id)
        if (d.uid) setFormData(prev => ({ ...prev, aadhar_number: d.uid.replace(/\s/g, '') }))
      } else { setDigilockerError(data.error || 'Failed to fetch Aadhaar data') }
    } catch (err: any) { setDigilockerError(err.message || 'Failed to fetch Aadhaar data') }
  }

  const handleDigilockerResult2 = (result: any) => {
    if (result.success && result.data) {
      if (result.pending) {
        const d = result.data
        if (d.verification_id) setDigilockerVerificationId(d.verification_id)
        fetchDigilockerDocument2(d.verification_id, d.reference_id || d.verification_id)
      } else {
        const d = result.data
        setAadhaarVerified(true); setAadhaarName(d.name || ''); setAadhaarUid(d.uid || '')
        setAadhaarDob(d.dob || ''); setAadhaarGender(d.gender || ''); setAadhaarAddress(d.address || '')
        if (d.verification_id) setDigilockerVerificationId(d.verification_id)
        if (d.uid) setFormData(prev => ({ ...prev, aadhar_number: d.uid.replace(/\s/g, '') }))
      }
    } else if (result.error) { setDigilockerError(result.error) }
  }

  // Digilocker listener
  useEffect(() => {
    const handleDigilockerMessage = (event: MessageEvent) => {
      if (event.data?.type === 'DIGILOCKER_RESULT') { handleDigilockerResult2(event.data) }
    }
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === 'digilocker_result' && event.newValue) {
        try {
          const result = JSON.parse(event.newValue)
          handleDigilockerResult2(result)
          localStorage.removeItem('digilocker_result')
        } catch (e) {}
      }
    }
    window.addEventListener('message', handleDigilockerMessage)
    window.addEventListener('storage', handleStorageChange)
    return () => { window.removeEventListener('message', handleDigilockerMessage); window.removeEventListener('storage', handleStorageChange) }
  }, [])

  const handleVerifyPan = async () => {
    if (!formData.pan_number || !/^[A-Z]{5}\d{4}[A-Z]$/.test(formData.pan_number.toUpperCase())) { setPanError('Enter valid 10-character PAN'); return }
    setVerifyingPan(true); setPanError('')
    try {
      const res = await apiFetch('/api/kyc/verify-pan', { method: 'POST', body: JSON.stringify({ pan: formData.pan_number.toUpperCase() }) })
      const data = await res.json()
      if (data.success) { setPanVerified(true); setPanRegisteredName(data.data.registered_name || ''); setPanType(data.data.type || ''); setEkychubOrderIds(prev => ({ ...prev, pan: data.orderid })) }
      else { setPanError(data.error || 'PAN verification failed'); setPanVerified(false) }
    } catch (err: any) { setPanError(err.message || 'PAN verification failed'); setPanVerified(false) }
    finally { setVerifyingPan(false) }
  }

  const fuzzyNameMatch = (name1: string, name2: string): boolean => {
    if (!name1 || !name2) return false
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
    const n1 = normalize(name1), n2 = normalize(name2)
    if (n1 === n2) return true
    if (n1.includes(n2) || n2.includes(n1)) return true
    const words1 = n1.split(' '), words2 = n2.split(' ')
    const common = words1.filter(w => w.length > 1 && words2.includes(w))
    return common.length >= Math.min(2, Math.min(words1.length, words2.length))
  }

  const handleVerifyBank = async () => {
    if (!formData.account_number || !formData.ifsc_code) { setBankError('Account number and IFSC code required'); return }
    setVerifyingBank(true); setBankError(''); setBankNameMismatch('')
    try {
      const res = await apiFetch('/api/kyc/verify-bank', { method: 'POST', body: JSON.stringify({ account_number: formData.account_number, ifsc: formData.ifsc_code.toUpperCase() }) })
      const data = await res.json()
      if (data.success) {
        const holderName = data.data.nameAtBank || ''
        setBankVerified(true); setBankVerifiedName(holderName); setBankUtr(data.data.utr || ''); setEkychubOrderIds(prev => ({ ...prev, bank: data.orderid }))
        if (holderName) {
          const matchesBusiness = fuzzyNameMatch(holderName, formData.business_name)
          const matchesAadhaar = fuzzyNameMatch(holderName, aadhaarName)
          if (!matchesBusiness && !matchesAadhaar) {
            setBankNameMismatch(`Account holder name "${holderName}" does not match Business Name "${formData.business_name}"${aadhaarName ? ` or Aadhaar Name "${aadhaarName}"` : ''}. Please verify the correct bank account.`)
            setBankVerified(false)
          }
        }
      }
      else { setBankError(data.error || 'Bank verification failed'); setBankVerified(false) }
    } catch (err: any) { setBankError(err.message || 'Bank verification failed'); setBankVerified(false) }
    finally { setVerifyingBank(false) }
  }

  const handleVerifyGst = async () => {
    if (!formData.gst_number || formData.gst_number.length < 15) { setGstError('Enter valid GST number'); return }
    setVerifyingGst(true); setGstError('')
    try {
      const res = await apiFetch('/api/kyc/verify-gst', { method: 'POST', body: JSON.stringify({ gst: formData.gst_number.toUpperCase() }) })
      const data = await res.json()
      if (data.success) { setGstVerified(true); setGstLegalName(data.data.legal_name || ''); setGstTradeName(data.data.trade_name || ''); setGstGstStatus(data.data.status || ''); setGstTaxpayerType(data.data.taxpayer_type || ''); setGstConstitution(data.data.constitution || ''); setGstAddress(data.data.address || ''); setEkychubOrderIds(prev => ({ ...prev, gst: data.orderid })) }
      else { setGstError(data.error || 'GST verification failed'); setGstVerified(false) }
    } catch (err: any) { setGstError(err.message || 'GST verification failed'); setGstVerified(false) }
    finally { setVerifyingGst(false) }
  }

  const handleVerifyCin = async () => {
    if (!formData.cin_number || formData.cin_number.length < 10) { setCinError('Enter valid CIN number'); return }
    setVerifyingCin(true); setCinError('')
    try {
      const res = await apiFetch('/api/kyc/verify-cin', { method: 'POST', body: JSON.stringify({ cin: formData.cin_number.toUpperCase() }) })
      const data = await res.json()
      if (data.success) { setCinVerified(true); setCinCompanyName(data.data.company_name || ''); setCinStatus(data.data.cin_status || ''); setCinIncorporationDate(data.data.incorporation_date || ''); setEkychubOrderIds(prev => ({ ...prev, cin: data.orderid })) }
      else { setCinError(data.error || 'CIN verification failed'); setCinVerified(false) }
    } catch (err: any) { setCinError(err.message || 'CIN verification failed'); setCinVerified(false) }
    finally { setVerifyingCin(false) }
  }

  const handleDigilockerAadhaar = async () => {
    setDigilockerLoading(true); setDigilockerError(''); setDigilockerUrl('')
    try {
      const res = await apiFetch('/api/kyc/verify-digilocker', { method: 'POST', body: JSON.stringify({ type: 'aadhaar' }) })
      const data = await res.json()
      if (data.success && data.data.url) { setDigilockerUrl(data.data.url); setDigilockerVerificationId(data.data.verification_id || ''); setEkychubOrderIds(prev => ({ ...prev, digilocker_aadhaar: data.orderid })); window.open(data.data.url, '_blank') }
      else { setDigilockerError(data.error || 'Failed to generate Digilocker URL') }
    } catch (err: any) { setDigilockerError(err.message || 'Digilocker verification failed') }
    finally { setDigilockerLoading(false) }
  }

  function calculateVerificationScore() {
    let score = 0
    if (panVerified) score += 30
    if (bankVerified) score += 30
    if (gstVerified) score += 20
    if (aadhaarVerified) score += 10
    if (cinVerified) score += 10
    return score
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!panVerified) { showToast('PAN verification is mandatory', 'error'); return }
    if (!aadhaarVerified) { showToast('Aadhaar verification via Digilocker is mandatory', 'error'); return }
    if (!bankVerified) { showToast('Bank account verification is required', 'error'); return }
    if (bankNameMismatch) { showToast('Bank account holder name does not match. Please use the correct bank account.', 'error'); return }
    setLoading(true)
    try {
      if (formData.password && formData.password.length < 8) { showToast('Password must be at least 8 characters long', 'error'); setLoading(false); return }
      if (!formData.contact_email) { showToast('Email is required', 'error'); setLoading(false); return }

      const partnerData: any = {
        name: formData.name,
        email: formData.contact_email,
        phone: formData.contact_phone,
        business_name: formData.business_name || formData.name,
        address: formData.address || null,
        city: formData.city || null,
        state: formData.state || null,
        pincode: formData.pincode || null,
        gst_number: formData.gst_number || null,
        pan_number: formData.pan_number || null,
        aadhar_number: formData.aadhar_number || null,
        bank_name: formData.bank_name || null,
        account_number: formData.account_number || null,
        ifsc_code: formData.ifsc_code || null,
        udhyam_number: formData.udhyam_number || null,
        cin_number: formData.cin_number || null,
        status: formData.status,
        pan_verified: panVerified,
        pan_registered_name: panRegisteredName || null,
        pan_type: panType || null,
        bank_verified: bankVerified,
        bank_verified_name: bankVerifiedName || null,
        bank_utr: bankUtr || null,
        gst_verified: gstVerified,
        gst_legal_name: gstLegalName || null,
        gst_trade_name: gstTradeName || null,
        gst_status: gstGstStatus || null,
        gst_taxpayer_type: gstTaxpayerType || null,
        gst_constitution: gstConstitution || null,
        gst_address: gstAddress || null,
        cin_verified: cinVerified,
        cin_company_name: cinCompanyName || null,
        cin_status: cinStatus || null,
        cin_incorporation_date: cinIncorporationDate || null,
        aadhaar_verified: aadhaarVerified,
        aadhaar_name: aadhaarName || null,
        aadhaar_dob: aadhaarDob || null,
        aadhaar_gender: aadhaarGender || null,
        aadhaar_address: aadhaarAddress || null,
        aadhaar_uid: aadhaarUid || null,
        digilocker_verification_id: digilockerVerificationId || null,
        ekychub_order_ids: ekychubOrderIds,
        auto_verification_score: calculateVerificationScore(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      const metadata: any = {}
      if (formData.subdomain) metadata.subdomain = formData.subdomain
      if (formData.logo_url) metadata.logo_url = formData.logo_url
      if (formData.primary_color) metadata.primary_color = formData.primary_color
      if (formData.secondary_color) metadata.secondary_color = formData.secondary_color
      if (formData.partner_type) metadata.partner_type = formData.partner_type
      if (formData.notes) metadata.notes = formData.notes
      if (Object.keys(metadata).length > 0) partnerData.metadata = metadata

      if (formData.password) {
        const { data: { session } } = await supabase.auth.getSession()
        const authHeaders: HeadersInit = {}
        if (session?.access_token) authHeaders['Authorization'] = `Bearer ${session.access_token}`

        const { data: createdPartner, error: partnerError } = await supabase.from('partners').insert([partnerData]).select().single()
        if (partnerError) throw partnerError

        const response = await apiFetch('/api/admin/create-user', {
          method: 'POST', headers: authHeaders,
          body: JSON.stringify({ email: formData.contact_email, password: formData.password, role: 'partner', tableName: 'partners', userData: { id: createdPartner.id, ...partnerData } }),
        })
        if (!response.ok) {
          await supabase.from('partners').delete().eq('id', createdPartner.id)
          const errorData = await response.json()
          throw new Error(errorData.error || 'Failed to create authentication user')
        }
      } else {
        const { error } = await supabase.from('partners').insert([partnerData]).select()
        if (error) throw error
      }
      onSuccess()
    } catch (error: any) {
      console.error('Error creating partner:', error)
      showToast(error.message || 'Failed to create partner', 'error')
    } finally { setLoading(false) }
  }

  const addressFromApi = (gstVerified && gstAddress) || (aadhaarVerified && aadhaarAddress)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[95vh] sm:max-h-[90vh] overflow-y-auto overflow-x-hidden"
      >
        <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <Building2 className="w-5 h-5 text-primary-600" />
                Create New Partner
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                Step {currentStep} of 3: {currentStep === 1 ? 'Partner & Personal Details' : currentStep === 2 ? 'Business & Address' : 'KYC Verification'}
              </p>
            </div>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
          <div className="mt-3">
            <div className="flex gap-1.5">
              <div className={`flex-1 h-2 rounded-full transition-colors ${currentStep >= 1 ? 'bg-primary-600' : 'bg-gray-200'}`}></div>
              <div className={`flex-1 h-2 rounded-full transition-colors ${currentStep >= 2 ? 'bg-primary-600' : 'bg-gray-200'}`}></div>
              <div className={`flex-1 h-2 rounded-full transition-colors ${currentStep >= 3 ? 'bg-primary-600' : 'bg-gray-200'}`}></div>
            </div>
            <div className="flex justify-between mt-1.5">
              <span className={`text-xs font-medium ${currentStep === 1 ? 'text-primary-600' : 'text-gray-400'}`}>Personal</span>
              <span className={`text-xs font-medium ${currentStep === 2 ? 'text-primary-600' : 'text-gray-400'}`}>Business</span>
              <span className={`text-xs font-medium ${currentStep === 3 ? 'text-primary-600' : 'text-gray-400'}`}>KYC</span>
            </div>
          </div>
        </div>

        {/* Step 1: Partner & Personal Details */}
        {currentStep === 1 && (
          <div className="p-4 sm:p-6 space-y-4">
            {/* Partner Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Partner Type *</label>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setFormData({ ...formData, partner_type: 'B2B' })} className={`p-3 rounded-lg border-2 transition-all ${formData.partner_type === 'B2B' ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <div className="flex items-center gap-2">
                    <Building2 className={`w-5 h-5 ${formData.partner_type === 'B2B' ? 'text-primary-600' : 'text-gray-400'}`} />
                    <div className="text-left">
                      <p className={`text-sm font-semibold ${formData.partner_type === 'B2B' ? 'text-primary-600' : 'text-gray-600'}`}>B2B</p>
                      <p className="text-[10px] text-gray-500">Business to Business</p>
                    </div>
                  </div>
                </button>
                <button type="button" onClick={() => setFormData({ ...formData, partner_type: 'B2C' })} className={`p-3 rounded-lg border-2 transition-all ${formData.partner_type === 'B2C' ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <div className="flex items-center gap-2">
                    <Users className={`w-5 h-5 ${formData.partner_type === 'B2C' ? 'text-primary-600' : 'text-gray-400'}`} />
                    <div className="text-left">
                      <p className={`text-sm font-semibold ${formData.partner_type === 'B2C' ? 'text-primary-600' : 'text-gray-600'}`}>B2C</p>
                      <p className="text-[10px] text-gray-500">Business to Consumer</p>
                    </div>
                  </div>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Partner Name *</label>
                <input type="text" required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white text-gray-900" placeholder="Partner name" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subdomain *</label>
                <div className="flex items-center">
                  <input type="text" required value={formData.subdomain} onChange={(e) => setFormData({ ...formData, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-l-lg focus:ring-2 focus:ring-primary-500 bg-white text-gray-900 text-sm" placeholder="subdomain" />
                  <span className="px-2 py-2 bg-gray-100 border border-l-0 border-gray-300 rounded-r-lg text-xs text-gray-500 whitespace-nowrap">.sameday.in</span>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                <input type="email" required value={formData.contact_email} onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white text-gray-900" placeholder="contact@partner.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
                <input type="tel" required value={formData.contact_phone} onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white text-gray-900" placeholder="9876543210" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password (for login)</label>
                <div className="relative">
                  <input type={showPartnerCreatePassword ? 'text' : 'password'} value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white text-gray-900" placeholder="Min 8 characters" />
                  <button type="button" onClick={() => setShowPartnerCreatePassword(!showPartnerCreatePassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500">
                    {showPartnerCreatePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status *</label>
                <select required value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value as any })} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white text-gray-900">
                  <option value="pending">Pending</option>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </select>
              </div>
            </div>

            {/* Branding */}
            <div className="border-t border-gray-200 pt-4">
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Branding</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Primary Color</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={formData.primary_color} onChange={(e) => setFormData({ ...formData, primary_color: e.target.value })} className="w-10 h-8 border rounded cursor-pointer" />
                    <input type="text" value={formData.primary_color} onChange={(e) => setFormData({ ...formData, primary_color: e.target.value })} className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white text-gray-900" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Secondary Color</label>
                  <div className="flex items-center gap-2">
                    <input type="color" value={formData.secondary_color} onChange={(e) => setFormData({ ...formData, secondary_color: e.target.value })} className="w-10 h-8 border rounded cursor-pointer" />
                    <input type="text" value={formData.secondary_color} onChange={(e) => setFormData({ ...formData, secondary_color: e.target.value })} className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white text-gray-900" />
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Logo URL</label>
                  <input type="url" value={formData.logo_url} onChange={(e) => setFormData({ ...formData, logo_url: e.target.value })} className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm bg-white text-gray-900" placeholder="https://example.com/logo.png" />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
              <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-900" placeholder="Additional notes..." />
            </div>

            <div className="flex justify-end pt-2">
              <button type="button" onClick={() => {
                if (!formData.name || !formData.contact_email || !formData.contact_phone || !formData.subdomain) { showToast('Please fill all required fields', 'error'); return }
                setCurrentStep(2)
              }} className="px-6 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium text-sm">
                Next: Business Details →
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Business & Address */}
        {currentStep === 2 && (
          <div className="p-4 sm:p-6 space-y-4">
            {/* GST Verification */}
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <label className="flex items-center gap-2 cursor-pointer mb-3">
                <input type="checkbox" checked={formData.gst_applicable} onChange={(e) => { setFormData({ ...formData, gst_applicable: e.target.checked, gst_number: e.target.checked ? formData.gst_number : '' }); if (!e.target.checked) { setGstVerified(false); setGstError('') } }} className="rounded border-gray-300 text-primary-600" />
                <span className="text-sm font-medium text-gray-700">GST Registered</span>
              </label>
              {formData.gst_applicable && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input type="text" value={formData.gst_number} onChange={(e) => setFormData({ ...formData, gst_number: e.target.value.toUpperCase() })} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 text-sm" placeholder="29ABCDE1234F1Z5" maxLength={15} />
                    <button type="button" onClick={handleVerifyGst} disabled={verifyingGst || gstVerified} className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1 ${gstVerified ? 'bg-green-100 text-green-700' : 'bg-blue-600 text-white hover:bg-blue-700'} disabled:opacity-50`}>
                      {verifyingGst ? <Loader2 className="w-4 h-4 animate-spin" /> : gstVerified ? <CheckCircle className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                      {gstVerified ? 'Verified' : 'Verify'}
                    </button>
                  </div>
                  {gstError && <p className="text-xs text-red-600">{gstError}</p>}
                  {gstVerified && <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs space-y-1">
                    <p><span className="text-gray-500">Legal Name:</span> <span className="font-medium text-green-800">{gstLegalName}</span></p>
                    {gstTradeName && <p><span className="text-gray-500">Trade Name:</span> <span className="font-medium text-green-800">{gstTradeName}</span></p>}
                    <p><span className="text-gray-500">Status:</span> <span className="font-medium text-green-800">{gstGstStatus}</span></p>
                  </div>}
                </div>
              )}
            </div>

            {/* Business Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Business Name *{gstVerified && <span className="text-green-600 text-xs ml-2">(from GST)</span>}</label>
              <input type="text" value={formData.business_name} onChange={(e) => setFormData({ ...formData, business_name: e.target.value })} readOnly={gstVerified} className={`w-full px-3 py-2 border rounded-lg text-sm ${gstVerified ? 'bg-green-50 border-green-300 text-green-800' : 'bg-white border-gray-300 text-gray-900'}`} placeholder="Business name" />
            </div>

            {/* CIN Verification */}
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <label className="flex items-center gap-2 cursor-pointer mb-3">
                <input type="checkbox" checked={formData.cin_applicable} onChange={(e) => { setFormData({ ...formData, cin_applicable: e.target.checked, cin_number: e.target.checked ? formData.cin_number : '' }); if (!e.target.checked) { setCinVerified(false); setCinError('') } }} className="rounded border-gray-300 text-primary-600" />
                <span className="text-sm font-medium text-gray-700">Company CIN Verification</span>
              </label>
              {formData.cin_applicable && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input type="text" value={formData.cin_number} onChange={(e) => setFormData({ ...formData, cin_number: e.target.value.toUpperCase() })} className="flex-1 px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 text-sm" placeholder="U12345MH2020PLC123456" />
                    <button type="button" onClick={handleVerifyCin} disabled={verifyingCin || cinVerified} className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1 ${cinVerified ? 'bg-green-100 text-green-700' : 'bg-blue-600 text-white hover:bg-blue-700'} disabled:opacity-50`}>
                      {verifyingCin ? <Loader2 className="w-4 h-4 animate-spin" /> : cinVerified ? <CheckCircle className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                      {cinVerified ? 'Verified' : 'Verify'}
                    </button>
                  </div>
                  {cinError && <p className="text-xs text-red-600">{cinError}</p>}
                  {cinVerified && <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs space-y-1">
                    <p><span className="text-gray-500">Company:</span> <span className="font-medium text-green-800">{cinCompanyName}</span></p>
                    <p><span className="text-gray-500">Status:</span> <span className="font-medium text-green-800">{cinStatus}</span></p>
                    {cinIncorporationDate && <p><span className="text-gray-500">Incorporation:</span> <span className="font-medium text-green-800">{cinIncorporationDate}</span></p>}
                  </div>}
                </div>
              )}
            </div>

            {/* UDHYAM */}
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <label className="flex items-center gap-2 cursor-pointer mb-3">
                <input type="checkbox" checked={formData.udhyam_applicable} onChange={(e) => setFormData({ ...formData, udhyam_applicable: e.target.checked, udhyam_number: e.target.checked ? formData.udhyam_number : '' })} className="rounded border-gray-300 text-primary-600" />
                <span className="text-sm font-medium text-gray-700">UDHYAM Registration</span>
              </label>
              {formData.udhyam_applicable && (
                <input type="text" value={formData.udhyam_number} onChange={(e) => setFormData({ ...formData, udhyam_number: e.target.value.toUpperCase() })} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 text-sm" placeholder="UDYAM-XX-00-0000000" />
              )}
            </div>

            {/* Aadhaar via Digilocker */}
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <h4 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-blue-600" /> Aadhaar Verification (Digilocker)</h4>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input type="text" value={formData.aadhar_number} onChange={(e) => setFormData({ ...formData, aadhar_number: e.target.value.replace(/\D/g, '').slice(0, 12) })} readOnly={aadhaarVerified} className={`flex-1 px-3 py-2 border rounded-lg text-sm ${aadhaarVerified ? 'bg-green-50 border-green-300 text-green-800' : 'bg-white border-gray-300 text-gray-900'}`} placeholder="12-digit Aadhaar number" maxLength={12} />
                  <button type="button" onClick={handleDigilockerAadhaar} disabled={digilockerLoading || aadhaarVerified} className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1 ${aadhaarVerified ? 'bg-green-100 text-green-700' : 'bg-blue-600 text-white hover:bg-blue-700'} disabled:opacity-50`}>
                    {digilockerLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : aadhaarVerified ? <CheckCircle className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                    {aadhaarVerified ? 'Verified' : 'Verify via Digilocker'}
                  </button>
                </div>
                {digilockerError && <p className="text-xs text-red-600">{digilockerError}</p>}
                {digilockerUrl && !aadhaarVerified && <p className="text-xs text-blue-600">Digilocker window opened. Complete verification there and come back.</p>}
                {aadhaarVerified && <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs space-y-1">
                  <p><span className="text-gray-500">Name:</span> <span className="font-medium text-green-800">{aadhaarName}</span></p>
                  {aadhaarDob && <p><span className="text-gray-500">DOB:</span> <span className="font-medium text-green-800">{aadhaarDob}</span></p>}
                  {aadhaarGender && <p><span className="text-gray-500">Gender:</span> <span className="font-medium text-green-800">{aadhaarGender}</span></p>}
                </div>}
              </div>
            </div>

            {/* Address */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Address</h4>
              {addressFromApi ? (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle className="w-4 h-4 text-green-600" />
                    <span className="text-xs font-medium text-green-700">Address from {gstVerified && gstAddress ? 'GST' : 'Aadhaar'} Verification</span>
                  </div>
                  <p className="text-sm text-green-800">{formData.address}</p>
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertCircle className="w-4 h-4 text-amber-600" />
                    <span className="text-xs font-medium text-amber-700">Address will be captured from API</span>
                  </div>
                  <p className="text-[11px] text-amber-600">Verify GST to auto-fill address, or verify Aadhaar via Digilocker if GST is not applicable.</p>
                </div>
              )}
            </div>

            <div className="flex justify-between pt-2">
              <button type="button" onClick={() => setCurrentStep(1)} className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 text-sm">← Back</button>
              <button type="button" onClick={() => {
                if (!formData.business_name) { showToast('Business Name is required', 'error'); return }
                if (formData.gst_applicable && !gstVerified) { showToast('Please verify GST number', 'error'); return }
                if (formData.cin_applicable && !cinVerified) { showToast('Please verify CIN number', 'error'); return }
                if (!aadhaarVerified) { showToast('Aadhaar verification via Digilocker is mandatory', 'error'); return }
                if (!formData.address) { showToast('Address is required. Verify GST or Aadhaar to capture address.', 'error'); return }
                setCurrentStep(3)
              }} className="px-6 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 font-medium text-sm">
                Next: KYC Verification →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: KYC Verification */}
        {currentStep === 3 && (
          <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4">
            {/* PAN Verification */}
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><CreditCard className="w-4 h-4 text-orange-500" /> PAN Verification *</h4>
              <div className="flex gap-2">
                <input type="text" value={formData.pan_number} onChange={(e) => setFormData({ ...formData, pan_number: e.target.value.toUpperCase() })} readOnly={panVerified} className={`flex-1 px-3 py-2 border rounded-lg text-sm ${panVerified ? 'bg-green-50 border-green-300 text-green-800' : 'bg-white border-gray-300 text-gray-900'}`} placeholder="ABCDE1234F" maxLength={10} />
                <button type="button" onClick={handleVerifyPan} disabled={verifyingPan || panVerified} className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1 ${panVerified ? 'bg-green-100 text-green-700' : 'bg-blue-600 text-white hover:bg-blue-700'} disabled:opacity-50`}>
                  {verifyingPan ? <Loader2 className="w-4 h-4 animate-spin" /> : panVerified ? <CheckCircle className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                  {panVerified ? 'Verified' : 'Verify'}
                </button>
              </div>
              {panError && <p className="text-xs text-red-600 mt-1">{panError}</p>}
              {panVerified && <div className="bg-green-50 border border-green-200 rounded-lg p-3 mt-2 text-xs space-y-1">
                <p><span className="text-gray-500">Name:</span> <span className="font-medium text-green-800">{panRegisteredName}</span></p>
                <p><span className="text-gray-500">Type:</span> <span className="font-medium text-green-800">{panType}</span></p>
              </div>}
            </div>

            {/* Bank Verification */}
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><Building2 className="w-4 h-4 text-blue-500" /> Bank Account Verification *</h4>
              <div className="space-y-3">
                <input type="text" value={formData.bank_name} onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 text-sm" placeholder="Bank Name" />
                <div className="grid grid-cols-2 gap-3">
                  <input type="text" value={formData.account_number} onChange={(e) => setFormData({ ...formData, account_number: e.target.value })} readOnly={bankVerified} className={`px-3 py-2 border rounded-lg text-sm ${bankVerified ? 'bg-green-50 border-green-300' : 'bg-white border-gray-300'}`} placeholder="Account Number" />
                  <input type="text" value={formData.ifsc_code} onChange={(e) => setFormData({ ...formData, ifsc_code: e.target.value.toUpperCase() })} readOnly={bankVerified} className={`px-3 py-2 border rounded-lg text-sm ${bankVerified ? 'bg-green-50 border-green-300' : 'bg-white border-gray-300'}`} placeholder="IFSC Code" />
                </div>
                <button type="button" onClick={handleVerifyBank} disabled={verifyingBank || bankVerified} className={`w-full px-4 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1 ${bankVerified ? 'bg-green-100 text-green-700' : 'bg-blue-600 text-white hover:bg-blue-700'} disabled:opacity-50`}>
                  {verifyingBank ? <Loader2 className="w-4 h-4 animate-spin" /> : bankVerified ? <CheckCircle className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                  {bankVerified ? 'Bank Account Verified' : 'Verify Bank Account'}
                </button>
                {bankError && <p className="text-xs text-red-600">{bankError}</p>}
                {bankNameMismatch && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs"><p className="text-red-700">{bankNameMismatch}</p></div>}
                {bankVerified && <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs space-y-1">
                  <p><span className="text-gray-500">Account Holder:</span> <span className="font-medium text-green-800">{bankVerifiedName}</span></p>
                  {bankUtr && <p><span className="text-gray-500">UTR:</span> <span className="font-medium text-green-800">{bankUtr}</span></p>}
                </div>}
              </div>
            </div>

            {(!panVerified || !aadhaarVerified) && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm font-medium text-amber-800 mb-1">Required verifications:</p>
                <ul className="text-xs text-amber-700 space-y-1">
                  {!panVerified && <li>• PAN verification is mandatory</li>}
                  {!aadhaarVerified && <li>• Aadhaar verification via Digilocker is mandatory</li>}
                  {!bankVerified && <li>• Bank account verification is mandatory</li>}
                </ul>
              </div>
            )}

            <div className="flex justify-between pt-2">
              <button type="button" onClick={() => setCurrentStep(2)} className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 text-sm">← Back</button>
              <button type="submit" disabled={loading || !panVerified || !aadhaarVerified || !bankVerified || !!bankNameMismatch} className="px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium text-sm flex items-center gap-2">
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</> : <><Plus className="w-4 h-4" /> Create Partner</>}
              </button>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  )
}

// Edit Partner Modal Component
function EditPartnerModal({
  partner,
  onClose,
  onSuccess
}: {
  partner: any
  onClose: () => void
  onSuccess: () => void
}) {
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)
  
  // Extract metadata fields
  const metadata = partner.metadata || {}
  
  const [formData, setFormData] = useState({
    name: partner.name || '',
    partner_type: (metadata.partner_type || 'B2B') as 'B2B' | 'B2C',
    subdomain: metadata.subdomain || '',
    contact_email: partner.email || '',
    contact_phone: partner.phone || '',
    business_name: partner.business_name || '',
    address: partner.address || '',
    city: partner.city || '',
    state: partner.state || '',
    pincode: partner.pincode || '',
    gst_number: partner.gst_number || '',
    primary_color: metadata.primary_color || '#3B82F6',
    secondary_color: metadata.secondary_color || '#10B981',
    logo_url: metadata.logo_url || '',
    status: (partner.status || 'pending') as 'active' | 'pending' | 'suspended',
    notes: metadata.notes || ''
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      if (!formData.contact_email) {
        showToast('Email is required', 'error')
        setLoading(false)
        return
      }

      const partnerData: any = {
        name: formData.name,
        email: formData.contact_email,
        phone: formData.contact_phone,
        business_name: formData.business_name || formData.name,
        address: formData.address || null,
        city: formData.city || null,
        state: formData.state || null,
        pincode: formData.pincode || null,
        gst_number: formData.gst_number || null,
        status: formData.status,
        updated_at: new Date().toISOString()
      }

      // Store optional branding fields in metadata JSONB column
      const updatedMetadata: any = {}
      if (formData.subdomain) updatedMetadata.subdomain = formData.subdomain
      if (formData.logo_url) updatedMetadata.logo_url = formData.logo_url
      if (formData.primary_color) updatedMetadata.primary_color = formData.primary_color
      if (formData.secondary_color) updatedMetadata.secondary_color = formData.secondary_color
      if (formData.partner_type) updatedMetadata.partner_type = formData.partner_type
      if (formData.notes) updatedMetadata.notes = formData.notes

      // Merge with existing metadata to preserve other fields
      const finalMetadata = { ...metadata, ...updatedMetadata }
      if (Object.keys(finalMetadata).length > 0) {
        partnerData.metadata = finalMetadata
      }

      // Update partner record
      const { error } = await supabase
        .from('partners')
        .update(partnerData)
        .eq('id', partner.id)

      if (error) throw error

      onSuccess()
    } catch (error: any) {
      console.error('Error updating partner:', error)
      showToast(error.message || 'Failed to update partner', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Edit className="w-6 h-6 text-primary-600" />
            Edit Partner
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Partner Type Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Partner Type <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setFormData({ ...formData, partner_type: 'B2B' })}
                className={`p-4 rounded-lg border-2 transition-all ${
                  formData.partner_type === 'B2B'
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Building2 className={`w-6 h-6 ${
                    formData.partner_type === 'B2B' ? 'text-primary-600' : 'text-gray-400'
                  }`} />
                  <div className="text-left">
                    <p className={`font-semibold ${
                      formData.partner_type === 'B2B' ? 'text-primary-600' : 'text-gray-600 dark:text-gray-400'
                    }`}>
                      B2B (Business to Business)
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      For business partnerships
                    </p>
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, partner_type: 'B2C' })}
                className={`p-4 rounded-lg border-2 transition-all ${
                  formData.partner_type === 'B2C'
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Users className={`w-6 h-6 ${
                    formData.partner_type === 'B2C' ? 'text-primary-600' : 'text-gray-400'
                  }`} />
                  <div className="text-left">
                    <p className={`font-semibold ${
                      formData.partner_type === 'B2C' ? 'text-primary-600' : 'text-gray-600 dark:text-gray-400'
                    }`}>
                      B2C (Business to Consumer)
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      For consumer-facing services
                    </p>
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Basic Information */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Partner Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                placeholder="Enter partner name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Business Name
              </label>
              <input
                type="text"
                value={formData.business_name}
                onChange={(e) => setFormData({ ...formData, business_name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                placeholder="Enter business name"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Subdomain
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={formData.subdomain}
                  onChange={(e) => setFormData({ ...formData, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                  placeholder="subdomain"
                />
                <span className="text-sm text-gray-500 dark:text-gray-400">.samedaysolution.in</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Status <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              >
                <option value="pending">Pending</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
          </div>

          {/* Contact Information */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Contact Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={formData.contact_email}
                  onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                  placeholder="contact@partner.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Phone <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  required
                  value={formData.contact_phone}
                  onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                  placeholder="+91 9876543210"
                />
              </div>
            </div>
          </div>

          {/* Address Information */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Address Information</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Address
                </label>
                <textarea
                  value={formData.address}
                  readOnly
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white cursor-not-allowed"
                  placeholder="Address captured from KYC verification"
                />
                <p className="text-xs text-gray-500 mt-1">Address is auto-captured from GST/Aadhaar verification and cannot be edited manually.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    City
                  </label>
                  <input
                    type="text"
                    value={formData.city}
                    readOnly
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white cursor-not-allowed"
                    placeholder="City"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    State
                  </label>
                  <input
                    type="text"
                    value={formData.state}
                    readOnly
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white cursor-not-allowed"
                    placeholder="State"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Pincode
                  </label>
                  <input
                    type="text"
                    value={formData.pincode}
                    readOnly
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white cursor-not-allowed"
                    placeholder="123456"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Business Details */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Business Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  GST Number
                </label>
                <input
                  type="text"
                  value={formData.gst_number}
                  onChange={(e) => setFormData({ ...formData, gst_number: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                  placeholder="29ABCDE1234F1Z5"
                />
              </div>
            </div>
          </div>

          {/* Branding */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Branding</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Primary Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={formData.primary_color}
                    onChange={(e) => setFormData({ ...formData, primary_color: e.target.value })}
                    className="w-16 h-10 border border-gray-300 dark:border-gray-700 rounded-lg cursor-pointer"
                  />
                  <input
                    type="text"
                    value={formData.primary_color}
                    onChange={(e) => setFormData({ ...formData, primary_color: e.target.value })}
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                    placeholder="#3B82F6"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Secondary Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={formData.secondary_color}
                    onChange={(e) => setFormData({ ...formData, secondary_color: e.target.value })}
                    className="w-16 h-10 border border-gray-300 dark:border-gray-700 rounded-lg cursor-pointer"
                  />
                  <input
                    type="text"
                    value={formData.secondary_color}
                    onChange={(e) => setFormData({ ...formData, secondary_color: e.target.value })}
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                    placeholder="#10B981"
                  />
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Logo URL
                </label>
                <input
                  type="url"
                  value={formData.logo_url}
                  onChange={(e) => setFormData({ ...formData, logo_url: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                  placeholder="https://example.com/logo.png"
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Notes
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
              placeholder="Additional notes about this partner..."
            />
          </div>

          {/* Form Actions */}
          <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Updating...
                </>
              ) : (
                <>
                  <Edit className="w-4 h-4" />
                  Update Partner
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}

// Set Partner Password Modal Component
function SetPartnerPasswordModal({
  partner,
  onClose,
  onSuccess
}: {
  partner: any
  onClose: () => void
  onSuccess: () => void
}) {
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  // Helper to get auth token for API calls
  const getAuthToken = async (): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token || null
  }

  // Helper to make authenticated API calls
  const fetchWithAuth = async (url: string, options: RequestInit = {}): Promise<Response> => {
    const token = await getAuthToken()
    const headers = new Headers(options.headers || {})
    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }
    return fetch(url, {
      ...options,
      headers,
      credentials: 'include'
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!password) {
      showToast('Password is required', 'error')
      return
    }
    
    if (password.length < 8) {
      showToast('Password must be at least 8 characters long', 'error')
      return
    }
    
    if (password !== confirmPassword) {
      showToast('Passwords do not match', 'error')
      return
    }

    setLoading(true)

    try {
      const response = await apiFetch('/api/admin/set-partner-password', {
        method: 'POST',
        body: JSON.stringify({
          partner_id: partner.id,
          password,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Failed to set password')
      }

      showToast('Password set successfully!', 'success')
      onSuccess()
    } catch (error: any) {
      console.error('Error setting partner password:', error)
      showToast(error.message || 'Failed to set password', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full"
      >
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Key className="w-6 h-6 text-primary-600" />
            Set Partner Password
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Partner Email
            </label>
            <input
              type="email"
              value={partner.email || ''}
              disabled
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              New Password <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white pr-10"
                placeholder="Enter password (min 8 characters)"
                minLength={8}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Minimum 8 characters
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Confirm Password <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                placeholder="Re-enter password"
              />
              <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Setting...
                </>
              ) : (
                <>
                  <Key className="w-4 h-4" />
                  Set Password
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}

// Reports Management Tab Component
function ReportsTab() {
  const { showToast } = useToast()
  const [selectedReport, setSelectedReport] = useState<'transactions' | 'commissions' | 'partners' | 'services' | 'settlements' | 'wallets'>('transactions')
  const [dateRange, setDateRange] = useState<'today' | 'yesterday' | 'week' | 'month' | 'quarter' | 'year' | 'custom'>('month')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [reportData, setReportData] = useState<any[]>([])
  const [summary, setSummary] = useState({
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
    { id: 'wallets', label: 'Wallets', icon: Wallet, color: 'cyan' }
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

      // MDR `transactions` uses settlement_status: pending | completed | failed (UI "Success" → completed)
      if (statusFilter !== 'all') {
        const settlementStatus = statusFilter === 'success' ? 'completed' : statusFilter
        query = query.eq('settlement_status', settlementStatus)
      }

      const { data, error } = await query.limit(1000)

      if (error) throw error

      const transactions = data || []
      setReportData(transactions)

      const successful = transactions.filter(t => t.settlement_status === 'completed')
      const totalAmount = successful.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0)
      
      setSummary({
        totalAmount,
        totalCount: transactions.length,
        successRate: transactions.length > 0 ? (successful.length / transactions.length) * 100 : 0,
        avgAmount: successful.length > 0 ? totalAmount / successful.length : 0
      })
    } catch (error) {
      console.error('Error fetching report data:', error)
      showToast('Failed to fetch report data', 'error')
    } finally {
      setLoading(false)
    }
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
      item.razorpay_payment_id?.toLowerCase().includes(search) ||
      item.partner_id?.toLowerCase().includes(search) ||
      item.retailer_id?.toLowerCase().includes(search) ||
      item.description?.toLowerCase().includes(search)
    )
  })

  return (
    <div className="space-y-4">
      {/* Service Transaction Report */}
      <ServiceTransactionReport userRole="admin" />

      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <FileBarChart className="w-6 h-6 text-primary-600" />
              Reports & Analytics
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Generate and download comprehensive reports
            </p>
          </div>
          <button
            onClick={fetchReportData}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Report Type Selection */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
          {reportTypes.map((type) => (
            <button
              key={type.id}
              onClick={() => setSelectedReport(type.id as any)}
              className={`p-3 rounded-lg border-2 transition-all ${
                selectedReport === type.id
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:border-gray-300'
              }`}
            >
              <type.icon className={`w-5 h-5 mx-auto mb-2 ${
                selectedReport === type.id ? 'text-primary-600' : 'text-gray-400'
              }`} />
              <p className={`text-xs font-medium ${
                selectedReport === type.id ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'
              }`}>
                {type.label}
              </p>
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[150px]">
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Date Range
            </label>
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm"
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

          {dateRange === 'custom' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm"
            >
              <option value="all">All Status</option>
              <option value="success">Success</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          <div className="flex-1 min-w-[150px]">
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Search
            </label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search by ID, partner..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-sm"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg p-4 text-white shadow-md">
          <div className="flex items-center justify-between mb-2">
            <IndianRupee className="w-6 h-6 opacity-80" />
            <span className="text-xs bg-white/20 px-2 py-1 rounded-full">Total</span>
          </div>
          <p className="text-2xl font-bold">{formatCurrency(summary.totalAmount)}</p>
          <p className="text-xs text-blue-100 mt-1">Transaction Volume</p>
        </div>

        <div className="bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-lg p-4 text-white shadow-md">
          <div className="flex items-center justify-between mb-2">
            <Receipt className="w-6 h-6 opacity-80" />
            <span className="text-xs bg-white/20 px-2 py-1 rounded-full">Count</span>
          </div>
          <p className="text-2xl font-bold">{summary.totalCount.toLocaleString()}</p>
          <p className="text-xs text-emerald-100 mt-1">Total Transactions</p>
        </div>

        <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg p-4 text-white shadow-md">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle2 className="w-6 h-6 opacity-80" />
            <span className="text-xs bg-white/20 px-2 py-1 rounded-full">Rate</span>
          </div>
          <p className="text-2xl font-bold">{summary.successRate.toFixed(1)}%</p>
          <p className="text-xs text-purple-100 mt-1">Success Rate</p>
        </div>

        <div className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-lg p-4 text-white shadow-md">
          <div className="flex items-center justify-between mb-2">
            <BarChart3 className="w-6 h-6 opacity-80" />
            <span className="text-xs bg-white/20 px-2 py-1 rounded-full">Avg</span>
          </div>
          <p className="text-2xl font-bold">{formatCurrency(summary.avgAmount)}</p>
          <p className="text-xs text-amber-100 mt-1">Average Transaction</p>
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
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
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Transaction ID</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">Partner ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center">
                    <div className="flex items-center justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                    </div>
                  </td>
                </tr>
              ) : filteredData.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                    No data found for the selected criteria
                  </td>
                </tr>
              ) : (
                filteredData.slice(0, 50).map((item, idx) => {
                  const settlement = item.settlement_status || item.status || 'pending'
                  const statusKey =
                    settlement === 'completed' || settlement === 'success' ? 'success' : settlement === 'pending' ? 'pending' : 'failed'
                  const statusLabel = settlement === 'completed' ? 'success' : settlement
                  return (
                  <tr key={item.id || idx} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                      {new Date(item.created_at).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-600 dark:text-gray-400">
                      {item.razorpay_payment_id || item.transaction_id || item.id?.slice(0, 8) || 'N/A'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                      {item.transaction_type || (item.mode && item.settlement_type ? `${item.mode} (${item.settlement_type})` : 'MDR')}
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900 dark:text-white">
                      {formatCurrency(parseFloat(item.amount) || 0)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                        statusKey === 'success'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : statusKey === 'pending'
                          ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      }`}>
                        {statusKey === 'success' && <CheckCircle2 className="w-3 h-3" />}
                        {statusKey === 'pending' && <Clock className="w-3 h-3" />}
                        {statusKey === 'failed' && <XCircle className="w-3 h-3" />}
                        {statusLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                      {item.retailer_id || item.partner_id || 'N/A'}
                    </td>
                  </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {filteredData.length > 50 && (
          <div className="p-4 border-t border-gray-200 dark:border-gray-700 text-center text-sm text-gray-500 dark:text-gray-400">
            Showing 50 of {filteredData.length} records. Export to see all data.
          </div>
        )}
      </div>
    </div>
  )
}

// IP Whitelist Modal Component
function IPWhitelistModal({
  partner,
  onClose,
  onSuccess
}: {
  partner: any
  onClose: () => void
  onSuccess: () => void
}) {
  const [whitelistIps, setWhitelistIps] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Load existing IP whitelist
    if (partner?.ip_whitelist && Array.isArray(partner.ip_whitelist)) {
      setWhitelistIps(partner.ip_whitelist.join('\n'))
    } else {
      setWhitelistIps('')
    }
  }, [partner])

  const handleSubmit = async () => {
    setLoading(true)
    setError(null)

    try {
      // Parse IPs from textarea (one per line, trim whitespace, filter empty)
      const ips = whitelistIps
        .split('\n')
        .map(ip => ip.trim())
        .filter(ip => ip.length > 0)

      // Validate IP format (supports IPv4 and CIDR notation)
      const ipRegex = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/
      const invalidIps = ips.filter(ip => !ipRegex.test(ip))
      
      if (invalidIps.length > 0) {
        setError(`Invalid IP addresses: ${invalidIps.join(', ')}`)
        setLoading(false)
        return
      }

      // Get auth token
      const { data: { session } } = await supabase.auth.getSession()
      const authHeaders: HeadersInit = {
        'Content-Type': 'application/json'
      }
      if (session?.access_token) {
        authHeaders['Authorization'] = `Bearer ${session.access_token}`
      }

      // Call API to update whitelist
      const response = await apiFetch('/api/admin/pos-partner-api', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          action: 'update_whitelist',
          partner_id: partner.id,
          ip_whitelist: ips
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update IP whitelist')
      }

      onSuccess()
    } catch (err: any) {
      console.error('Error updating IP whitelist:', err)
      setError(err.message || 'Failed to update IP whitelist')
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-2xl"
      >
        <div className="px-6 py-4 bg-gradient-to-r from-purple-500 to-indigo-600 rounded-t-2xl flex items-center justify-between">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Shield className="w-5 h-5" />
            IP Whitelist — {partner?.name || 'Partner'}
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-white/20 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Enter partner&apos;s server IP addresses (one per line). Only these IPs will be allowed to call the API.
            Supports IPv4 addresses and CIDR notation (e.g., 192.168.1.0/24).
          </p>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p className="text-sm text-red-800 dark:text-red-400">{error}</p>
            </div>
          )}

          <textarea
            rows={8}
            value={whitelistIps}
            onChange={(e) => setWhitelistIps(e.target.value)}
            placeholder="203.0.113.50&#10;198.51.100.25&#10;192.168.1.100&#10;10.0.0.0/24"
            className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 font-mono text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />

          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <AlertCircle className="w-4 h-4" />
            <span>Leave empty to block all IPs. At least one IP must be whitelisted for API access.</span>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              disabled={loading}
              className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 text-sm font-medium transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex-1 py-2.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Save Whitelist
                </>
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

// eKYC Hub Balance Card & API Testing Panel
function EkycHubCard() {
  const [balance, setBalance] = useState<{ balance: number; raw_balance: string } | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [balanceError, setBalanceError] = useState('')
  const [lastChecked, setLastChecked] = useState<string | null>(null)

  // API Testing state
  const [testTab, setTestTab] = useState<'pan' | 'bank' | 'gst' | 'upi' | 'pan360' | 'dl' | 'passport' | 'voter' | 'cin' | 'digilocker'>('pan')
  const [testLoading, setTestLoading] = useState(false)
  const [testResult, setTestResult] = useState<any>(null)
  const [testError, setTestError] = useState('')
  const [showTesting, setShowTesting] = useState(false)

  // Test form inputs
  const [testPan, setTestPan] = useState('')
  const [testAccountNo, setTestAccountNo] = useState('')
  const [testIfsc, setTestIfsc] = useState('')
  const [testGst, setTestGst] = useState('')
  const [testUpi, setTestUpi] = useState('')
  const [testDlNumber, setTestDlNumber] = useState('')
  const [testDlDob, setTestDlDob] = useState('')
  const [testPassportNumber, setTestPassportNumber] = useState('')
  const [testPassportDob, setTestPassportDob] = useState('')
  const [testVoterEpic, setTestVoterEpic] = useState('')
  const [testCin, setTestCin] = useState('')
  const [testDigilockerType, setTestDigilockerType] = useState<'aadhaar' | 'pan'>('aadhaar')
  const [testDigilockerRedirectUrl, setTestDigilockerRedirectUrl] = useState('')

  const fetchBalance = async () => {
    setBalanceLoading(true)
    setBalanceError('')
    try {
      const res = await apiFetch('/api/admin/ekychub-balance')
      const data = await res.json()
      if (data.success) {
        setBalance({ balance: data.balance, raw_balance: data.raw_balance })
        setLastChecked(new Date().toISOString())
      } else {
        setBalanceError(data.error || 'Failed to fetch balance')
      }
    } catch (err: any) {
      setBalanceError(err.message || 'Failed to fetch balance')
    } finally {
      setBalanceLoading(false)
    }
  }

  useEffect(() => { fetchBalance() }, [])

  const runTest = async () => {
    setTestLoading(true)
    setTestResult(null)
    setTestError('')
    try {
      let endpoint = ''
      let body: any = {}
      switch (testTab) {
        case 'pan':
          endpoint = '/api/kyc/verify-pan'
          body = { pan: testPan.toUpperCase() }
          break
        case 'pan360':
          endpoint = '/api/kyc/verify-pan360'
          body = { pan: testPan.toUpperCase() }
          break
        case 'bank':
          endpoint = '/api/kyc/verify-bank'
          body = { account_number: testAccountNo, ifsc: testIfsc.toUpperCase() }
          break
        case 'gst':
          endpoint = '/api/kyc/verify-gst'
          body = { gst: testGst.toUpperCase() }
          break
        case 'upi':
          endpoint = '/api/kyc/verify-upi'
          body = { upi: testUpi }
          break
        case 'dl':
          endpoint = '/api/kyc/verify-dl'
          body = { dl_number: testDlNumber.toUpperCase(), dob: testDlDob }
          break
        case 'passport':
          endpoint = '/api/kyc/verify-passport'
          body = { file_number: testPassportNumber.toUpperCase(), dob: testPassportDob }
          break
        case 'voter':
          endpoint = '/api/kyc/verify-voter'
          body = { epic_number: testVoterEpic.toUpperCase() }
          break
        case 'cin':
          endpoint = '/api/kyc/verify-cin'
          body = { cin: testCin.toUpperCase() }
          break
        case 'digilocker':
          endpoint = '/api/kyc/verify-digilocker'
          body = { type: testDigilockerType, redirect_url: testDigilockerRedirectUrl || undefined }
          break
      }
      const res = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.success) {
        setTestResult(data.data)
      } else {
        setTestError(data.error || 'Verification failed')
      }
    } catch (err: any) {
      setTestError(err.message || 'API call failed')
    } finally {
      setTestLoading(false)
    }
  }

  return (
    <>
      {/* eKYC Hub Balance & API Testing Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200"
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl shadow-lg">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">eKYC Hub</h3>
              <p className="text-sm text-gray-500">KYC Verification API Provider</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowTesting(!showTesting)}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-all"
            >
              <Zap className="w-4 h-4" />
              {showTesting ? 'Hide Tests' : 'Test APIs'}
            </button>
            <button
              onClick={fetchBalance}
              disabled={balanceLoading}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${balanceLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Balance Display */}
        {balance ? (
          <div className="rounded-xl p-5 bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 mb-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-600 rounded-lg">
                  <Wallet className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">eKYC Hub Wallet</p>
                  <p className="text-xs text-gray-500">PAN, Bank, GST, Aadhaar Verification</p>
                </div>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-100 text-green-700">
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-sm font-medium">Active</span>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4">
              <div className="text-center p-4 bg-white rounded-lg border border-emerald-200 shadow-sm">
                <p className="text-xs text-gray-500 mb-1">Available Balance</p>
                <p className="text-3xl font-bold text-emerald-600">₹{balance.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
              </div>
            </div>
            {lastChecked && (
              <p className="text-xs text-gray-400 mt-4 text-right">
                Last updated: {new Date(lastChecked).toLocaleString('en-IN')}
              </p>
            )}
          </div>
        ) : (
          <div className="text-center py-6 mb-4">
            {balanceLoading ? (
              <div className="flex flex-col items-center gap-3">
                <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin" />
                <p className="text-gray-500">Fetching eKYC Hub balance...</p>
              </div>
            ) : balanceError ? (
              <div className="flex flex-col items-center gap-3">
                <AlertTriangle className="w-8 h-8 text-amber-500" />
                <p className="text-gray-600">{balanceError}</p>
                <button onClick={fetchBalance} className="mt-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-all">
                  Try Again
                </button>
              </div>
            ) : null}
          </div>
        )}

        {/* API Testing Panel */}
        <AnimatePresence>
          {showTesting && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-5">
                <h4 className="text-md font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-500" />
                  API Testing Console
                </h4>

                {/* Tab Selector */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {[
                    { id: 'pan' as const, label: 'PAN Verify' },
                    { id: 'pan360' as const, label: 'PAN 360' },
                    { id: 'bank' as const, label: 'Bank Verify' },
                    { id: 'gst' as const, label: 'GST Verify' },
                    { id: 'upi' as const, label: 'UPI Verify' },
                    { id: 'dl' as const, label: 'Driving License' },
                    { id: 'passport' as const, label: 'Passport' },
                    { id: 'voter' as const, label: 'Voter Card' },
                    { id: 'cin' as const, label: 'Company CIN' },
                    { id: 'digilocker' as const, label: 'Digilocker' },
                  ].map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => { setTestTab(tab.id); setTestResult(null); setTestError(''); }}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                        testTab === tab.id
                          ? 'bg-emerald-600 text-white shadow-md'
                          : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Test Inputs */}
                <div className="space-y-3 mb-4">
                  {(testTab === 'pan' || testTab === 'pan360') && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">PAN Number</label>
                      <input
                        type="text"
                        value={testPan}
                        onChange={(e) => setTestPan(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
                        placeholder="ABCDE1234F"
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 font-mono focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      />
                    </div>
                  )}
                  {testTab === 'bank' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Account Number</label>
                        <input
                          type="text"
                          value={testAccountNo}
                          onChange={(e) => setTestAccountNo(e.target.value.replace(/\D/g, '').slice(0, 18))}
                          placeholder="39470006171"
                          className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 font-mono focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">IFSC Code</label>
                        <input
                          type="text"
                          value={testIfsc}
                          onChange={(e) => setTestIfsc(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))}
                          placeholder="SBIN0001266"
                          className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 font-mono focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        />
                      </div>
                    </div>
                  )}
                  {testTab === 'gst' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">GST Number</label>
                      <input
                        type="text"
                        value={testGst}
                        onChange={(e) => setTestGst(e.target.value.toUpperCase().slice(0, 15))}
                        placeholder="22AAAAA0000A1Z5"
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 font-mono focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      />
                    </div>
                  )}
                  {testTab === 'upi' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">UPI ID (VPA)</label>
                      <input
                        type="text"
                        value={testUpi}
                        onChange={(e) => setTestUpi(e.target.value)}
                        placeholder="name@upi"
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 font-mono focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      />
                    </div>
                  )}
                  {testTab === 'dl' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Driving License Number</label>
                        <input
                          type="text"
                          value={testDlNumber}
                          onChange={(e) => setTestDlNumber(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16))}
                          placeholder="DL1420110012345"
                          className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 font-mono focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Date of Birth</label>
                        <input
                          type="date"
                          value={testDlDob}
                          onChange={(e) => setTestDlDob(e.target.value)}
                          className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        />
                      </div>
                    </div>
                  )}
                  {testTab === 'passport' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Passport File Number</label>
                        <input
                          type="text"
                          value={testPassportNumber}
                          onChange={(e) => setTestPassportNumber(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15))}
                          placeholder="AB1234567890123"
                          className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 font-mono focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Date of Birth</label>
                        <input
                          type="date"
                          value={testPassportDob}
                          onChange={(e) => setTestPassportDob(e.target.value)}
                          className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        />
                      </div>
                    </div>
                  )}
                  {testTab === 'voter' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">EPIC (Voter ID) Number</label>
                      <input
                        type="text"
                        value={testVoterEpic}
                        onChange={(e) => setTestVoterEpic(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))}
                        placeholder="ABC1234567"
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 font-mono focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      />
                    </div>
                  )}
                  {testTab === 'cin' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Company CIN Number</label>
                      <input
                        type="text"
                        value={testCin}
                        onChange={(e) => setTestCin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 21))}
                        placeholder="U72200MH2009PLC123456"
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 font-mono focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                      />
                    </div>
                  )}
                  {testTab === 'digilocker' && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Document Type</label>
                        <div className="flex gap-3">
                          <button
                            onClick={() => setTestDigilockerType('aadhaar')}
                            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all border ${
                              testDigilockerType === 'aadhaar'
                                ? 'bg-emerald-600 text-white border-emerald-600 shadow-md'
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            Aadhaar via Digilocker
                          </button>
                          <button
                            onClick={() => setTestDigilockerType('pan')}
                            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all border ${
                              testDigilockerType === 'pan'
                                ? 'bg-emerald-600 text-white border-emerald-600 shadow-md'
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            PAN via Digilocker
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Redirect URL (public URL required by eKYC Hub)</label>
                        <input
                          type="text"
                          value={testDigilockerRedirectUrl}
                          onChange={(e) => setTestDigilockerRedirectUrl(e.target.value)}
                          placeholder="https://yourdomain.com/api/kyc/digilocker-callback"
                          className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 font-mono text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        />
                        <p className="text-xs text-amber-600 mt-1">Digilocker requires a publicly accessible callback URL. Localhost URLs will be rejected by eKYC Hub.</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Run Test Button */}
                <button
                  onClick={runTest}
                  disabled={testLoading}
                  className="w-full px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-lg text-sm font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-md"
                >
                  {testLoading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Verifying...</>
                  ) : (
                    <><ShieldCheck className="w-4 h-4" /> Run Verification</>
                  )}
                </button>

                {/* Test Results */}
                {testResult && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 rounded-lg border border-green-300 bg-green-50 p-4"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                      <span className="text-sm font-semibold text-green-700">
                        {testTab === 'digilocker' ? 'Digilocker URL Generated' : 'Verification Successful'}
                      </span>
                    </div>
                    {testTab === 'digilocker' && testResult.url && (
                      <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-xs text-blue-700 mb-2 font-medium">Redirect the user to this URL to complete Digilocker verification:</p>
                        <a href={testResult.url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:text-blue-800 underline break-all font-mono">{testResult.url}</a>
                      </div>
                    )}
                    <div className="space-y-2">
                      {Object.entries(testResult).map(([key, value]) => {
                        if (value === null || value === undefined || key === 'director_details') return null
                        const displayValue = Array.isArray(value) ? value.join(', ') : String(value)
                        return (
                          <div key={key} className="flex justify-between items-start text-sm border-b border-green-200 pb-1.5">
                            <span className="text-gray-600 font-medium capitalize">{key.replace(/_/g, ' ')}</span>
                            <span className="text-gray-900 text-right max-w-[60%] break-all font-mono text-xs">{displayValue}</span>
                          </div>
                        )
                      })}
                    </div>
                  </motion.div>
                )}

                {testError && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 rounded-lg border border-red-300 bg-red-50 p-4"
                  >
                    <div className="flex items-center gap-2">
                      <XCircle className="w-5 h-5 text-red-600" />
                      <span className="text-sm text-red-700">{testError}</span>
                    </div>
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </>
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
