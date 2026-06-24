'use client'

import { useState, useEffect, useCallback, Suspense, memo, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/components/Toast'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import DistributorSidebar from '@/components/DistributorSidebar'
import DistributorHeader from '@/components/DistributorHeader'
import { 
  TrendingUp, DollarSign, Users, Activity, 
  LogOut, Package, Network, BarChart3,
  ArrowUpRight, ArrowDownRight, UserPlus, Receipt, Wallet,
  ArrowUpCircle, ArrowDownCircle, Download, Search, Eye, EyeOff,
  Settings, PieChart as PieChartIcon, Plus, X, Percent,
  Edit, Trash2, CreditCard, Smartphone, RefreshCw, AlertCircle, Menu,
  Layers, Banknote, Link2, ChevronDown, ChevronUp,
  User, Bell, Shield, Sliders, CheckCircle, Loader2, Building2, ShieldCheck
} from 'lucide-react'
import TransactionsTable from '@/components/TransactionsTable'
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { motion } from 'framer-motion'
import { apiFetch, newIdempotencyKey } from '@/lib/api-client'
import POSMachinesTab from '@/components/POSMachinesTab'
import DistributorSubscriptionsTab from '@/components/DistributorSubscriptionsTab'
import ServiceTransactionReport from '@/components/ServiceTransactionReport'

type TabType = 'dashboard' | 'services' | 'retailers' | 'wallet' | 'commission' | 'mdr-schemes' | 'analytics' | 'reports' | 'settings' | 'scheme-management' | 'pos-machines' | 'subscriptions'

type ChangePasswordFormProps = {
  onPasswordChange: (current: string, newPassword: string, confirm: string) => void
  loading: boolean
}

function DistributorDashboardContent() {
  const { user, logout, loading: authLoading } = useAuth()
  const { showToast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  
  const getInitialTab = (): TabType => {
    const tab = searchParams?.get('tab')
    if (tab && ['dashboard', 'services', 'retailers', 'wallet', 'commission', 'mdr-schemes', 'analytics', 'reports', 'settings', 'scheme-management', 'pos-machines', 'subscriptions'].includes(tab)) {
      return tab as TabType
    }
    return 'dashboard'
  }
  
  const [activeTab, setActiveTab] = useState<TabType>(getInitialTab())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [stats, setStats] = useState({
    totalRetailers: 0,
    activeRetailers: 0,
    totalRevenue: 0,
    commissionEarned: 0,
    walletBalance: 0,
  })

  const [retailers, setRetailers] = useState<any[]>([])
  const [chartData, setChartData] = useState<any[]>([])
  const [pieData, setPieData] = useState<any[]>([])
  const [categoryData, setCategoryData] = useState<any[]>([])
  const [commissionData, setCommissionData] = useState<any[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const COLORS = ['#f97316', '#22c55e', '#3b82f6', '#a855f7', '#ef4444']

  const fetchDashboardData = useCallback(async () => {
    if (!user || !user.partner_id) return
    setLoading(true)
    try {
      // Fetch distributor data (use maybeSingle to avoid 406 errors)
      const { data: distributorData } = await supabase
        .from('distributors')
        .select('*')
        .eq('email', user.email)
        .maybeSingle()

      // Fetch retailers under this distributor
      const { data: retailersData } = await supabase
        .from('retailers')
        .select('*')
        .eq('distributor_id', distributorData?.partner_id || '')
        .order('created_at', { ascending: false })

      setRetailers(retailersData || [])

      // Fetch wallet balance
      let walletBalance = 0
      if (user.partner_id) {
        try {
          const { data: balance } = await supabase.rpc('get_wallet_balance_v2', {
            p_user_id: user.partner_id,
            p_wallet_type: 'primary'
          })
          walletBalance = balance || 0
        } catch {
          walletBalance = 0
        }
      }

      // Fetch commission data
      const { data: commissionLedger } = await supabase
        .from('commission_ledger')
        .select('*')
        .eq('dt_user_id', user.partner_id)
        .order('created_at', { ascending: false })
        .limit(100)

      setCommissionData(commissionLedger || [])
      const totalCommission = commissionLedger?.reduce((sum, entry) => sum + (entry.dt_amount || 0), 0) || 0

      // Fetch transaction data for analytics
      const { data: transactions } = await supabase
        .from('wallet_ledger')
        .select('*')
        .eq('user_role', 'distributor')
        .order('created_at', { ascending: false })
        .limit(1000)

      // Calculate category-wise data
      const categoryMap: Record<string, { revenue: number; transactions: number }> = {}
      transactions?.forEach(tx => {
        const category = tx.fund_category || 'other'
        if (!categoryMap[category]) {
          categoryMap[category] = { revenue: 0, transactions: 0 }
        }
        categoryMap[category].revenue += (tx.credit || 0) - (tx.debit || 0)
        categoryMap[category].transactions += 1
      })

      const categoryArray = Object.entries(categoryMap).map(([name, data]) => ({
        name,
        revenue: data.revenue,
        transactions: data.transactions
      }))

      setCategoryData(categoryArray)

      // Calculate real revenue from transactions
      const totalRevenue = transactions?.reduce((sum, tx) => sum + (tx.credit || 0), 0) || 0

      setStats({
        totalRetailers: retailersData?.length || 0,
        activeRetailers: retailersData?.filter(r => r.status === 'active').length || 0,
        totalRevenue,
        commissionEarned: totalCommission,
        walletBalance,
      })

      // Calculate real weekly chart data from transactions
      const now = new Date()
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      const weeklyTransactions = (transactions || []).filter(tx => {
        const txDate = new Date(tx.created_at)
        return txDate >= weekAgo
      })

      // Group by day of week
      const dayMap: Record<string, { retailers: number; revenue: number }> = {}
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      
      weeklyTransactions.forEach(tx => {
        const txDate = new Date(tx.created_at)
        const dayName = dayNames[txDate.getDay()]
        
        if (!dayMap[dayName]) {
          dayMap[dayName] = { retailers: retailersData?.length || 0, revenue: 0 }
        }
        
        dayMap[dayName].revenue += (tx.credit || 0)
      })

      // Create chart data in order (Mon-Sun)
      const orderedDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      setChartData(orderedDays.map(day => ({
        name: day,
        retailers: dayMap[day]?.retailers || retailersData?.length || 0,
        revenue: dayMap[day]?.revenue || 0,
      })))

      setPieData([
        { name: 'Active', value: retailersData?.filter(r => r.status === 'active').length || 0 },
        { name: 'Inactive', value: retailersData?.filter(r => r.status === 'inactive').length || 0 },
        { name: 'Suspended', value: retailersData?.filter(r => r.status === 'suspended').length || 0 },
      ])
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
      showToast('Failed to load dashboard data', 'error')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [user])

  useEffect(() => {
    // Wait for auth to finish loading before checking user
    if (authLoading) return
    
    if (!user || user.role !== 'distributor') {
      router.push('/business-login')
      return
    }
    fetchDashboardData()
  }, [user, router, authLoading, fetchDashboardData])

  useEffect(() => {
    if (pathname === '/dashboard/distributor/scheme-management') {
      router.replace('/dashboard/distributor?tab=scheme-management', { scroll: false })
      return
    }
    
    const tab = searchParams?.get('tab')
    if (tab === 'network') {
      router.replace('/dashboard/distributor?tab=retailers', { scroll: false })
      return
    }
    if (tab && ['dashboard', 'services', 'retailers', 'wallet', 'commission', 'mdr-schemes', 'analytics', 'reports', 'settings', 'scheme-management', 'pos-machines', 'subscriptions'].includes(tab)) {
      setActiveTab(tab as TabType)
    } else {
      // Default to dashboard if no tab is specified (when on main dashboard page)
      if (pathname === '/dashboard/distributor' || pathname === '/dashboard/distributor/') {
        setActiveTab('dashboard')
      }
    }
  }, [searchParams, pathname, router])

  const handleLogout = async () => {
    await logout()
    router.push('/business-login')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-600"></div>
      </div>
    )
  }

  const tabs = [
    { id: 'dashboard' as TabType, label: 'Dashboard', icon: Activity },
    { id: 'services' as TabType, label: 'Services', icon: Activity },
    { id: 'retailers' as TabType, label: 'Retailers', icon: Users },
    { id: 'wallet' as TabType, label: 'Wallet', icon: Wallet },
    { id: 'commission' as TabType, label: 'Commission', icon: TrendingUp },
    { id: 'mdr-schemes' as TabType, label: 'MDR Schemes', icon: Percent },
    { id: 'analytics' as TabType, label: 'Analytics', icon: BarChart3 },
    { id: 'reports' as TabType, label: 'Reports', icon: Download },
    { id: 'settings' as TabType, label: 'Settings', icon: Settings },
  ]

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 overflow-x-hidden">
      <DistributorHeader />
      <DistributorSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      
      <div className="flex-1 lg:ml-56 min-w-0 overflow-x-hidden pt-16 md:pt-16">
        {/* Mobile Menu Button */}
        <button
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden fixed top-20 left-2 md:left-4 z-30 p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700"
        >
          <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
        </button>

        <div className="p-2 sm:p-3 md:p-4 lg:p-5 max-w-full h-[calc(100vh-4rem)] overflow-y-auto overflow-x-hidden">
          {/* Page Header */}
          <div className="mb-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
              <div className="flex-1 min-w-0">
                <h1 className="text-xl sm:text-2xl md:text-3xl font-bold bg-gradient-to-r from-purple-600 to-purple-700 bg-clip-text text-transparent">
                  {{ dashboard: 'Dashboard', services: 'Services', retailers: 'Retailers', wallet: 'Wallet', commission: 'Commission', 'mdr-schemes': 'MDR Schemes', analytics: 'Analytics', reports: 'Reports', settings: 'Settings', 'scheme-management': 'Scheme Management', 'pos-machines': 'POS Machines', subscriptions: 'Subscriptions' }[activeTab] || 'Dashboard'}
                </h1>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Welcome back, {user?.name || user?.email}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => { setRefreshing(true); fetchDashboardData() }}
                  disabled={refreshing}
                  className="p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                  title="Refresh"
                >
                  <RefreshCw className={`w-4 h-4 text-gray-600 dark:text-gray-300 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>
          </div>

          {/* Tab Content - Direct rendering based on activeTab */}
          {activeTab === 'dashboard' && <DashboardTab stats={stats} chartData={chartData} pieData={pieData} onTabChange={setActiveTab} router={router} />}
          {activeTab === 'services' && <ServicesTab />}
          {activeTab === 'retailers' && <NetworkTab retailers={retailers} user={user} onRefresh={fetchDashboardData} />}
          {activeTab === 'wallet' && <WalletTab user={user} />}
          {activeTab === 'commission' && <CommissionTab commissionData={commissionData} stats={stats} onRefresh={fetchDashboardData} />}
          {activeTab === 'mdr-schemes' && <MDRSchemesTab user={user} retailers={retailers} onRefresh={fetchDashboardData} />}
          {activeTab === 'analytics' && <AnalyticsTab categoryData={categoryData} />}
          {activeTab === 'reports' && <ReportsTab user={user} />}
          {activeTab === 'settings' && <SettingsTab />}
          {activeTab === 'scheme-management' && <SchemeManagementTab user={user} retailers={retailers} onRefresh={fetchDashboardData} />}
          {activeTab === 'pos-machines' && <POSMachinesTab user={user} accentColor="purple" />}
          {activeTab === 'subscriptions' && <DistributorSubscriptionsTab />}
        </div>
      </div>
    </div>
  )
}

// Dashboard Tab (memoized for performance)
const DashboardTab = memo(function DashboardTab({ stats, chartData, pieData, onTabChange, router }: { stats: any, chartData: any[], pieData: any[], onTabChange: (tab: TabType) => void, router: any }) {
  const COLORS = ['#f97316', '#22c55e', '#3b82f6', '#a855f7', '#ef4444']
  
  return (
    <>
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mb-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card bg-gradient-to-br from-blue-500 to-blue-600 text-white cursor-pointer hover:shadow-xl transition-shadow"
          onClick={() => {
            onTabChange('retailers')
            router.push('/dashboard/distributor?tab=retailers', { scroll: false })
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-blue-100 text-xs sm:text-sm font-medium">Total Retailers</p>
              <p className="text-2xl sm:text-3xl font-bold mt-1">{stats.totalRetailers}</p>
              <div className="flex items-center gap-1 mt-1">
                <ArrowUpRight className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
                <span className="text-xs sm:text-sm text-blue-100">Click to manage</span>
              </div>
            </div>
            <Users className="w-8 h-8 sm:w-12 sm:h-12 text-blue-200 flex-shrink-0" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card bg-gradient-to-br from-green-500 to-green-600 text-white cursor-pointer hover:shadow-xl transition-shadow"
          onClick={() => {
            onTabChange('retailers')
            router.push('/dashboard/distributor?tab=retailers', { scroll: false })
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-green-100 text-xs sm:text-sm font-medium">Active Retailers</p>
              <p className="text-2xl sm:text-3xl font-bold mt-1">{stats.activeRetailers}</p>
              <div className="flex items-center gap-1 mt-1">
                <ArrowUpRight className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
                <span className="text-xs sm:text-sm text-green-100">Click to manage</span>
              </div>
            </div>
            <UserPlus className="w-8 h-8 sm:w-12 sm:h-12 text-green-200 flex-shrink-0" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card bg-gradient-to-br from-purple-500 to-purple-600 text-white cursor-pointer hover:shadow-xl transition-shadow"
          onClick={() => {
            onTabChange('analytics')
            router.push('/dashboard/distributor?tab=analytics', { scroll: false })
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-purple-100 text-xs sm:text-sm font-medium">Total Revenue</p>
              <p className="text-xl sm:text-2xl lg:text-3xl font-bold mt-1 truncate">₹{stats.totalRevenue.toLocaleString()}</p>
              <div className="flex items-center gap-1 mt-1">
                <ArrowUpRight className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
                <span className="text-xs sm:text-sm text-purple-100">Click for details</span>
              </div>
            </div>
            <DollarSign className="w-8 h-8 sm:w-12 sm:h-12 text-purple-200 flex-shrink-0" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card bg-gradient-to-br from-orange-500 to-orange-600 text-white cursor-pointer hover:shadow-xl transition-shadow"
          onClick={() => {
            onTabChange('commission')
            router.push('/dashboard/distributor?tab=commission', { scroll: false })
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-orange-100 text-xs sm:text-sm font-medium">Commission Earned</p>
              <p className="text-xl sm:text-2xl lg:text-3xl font-bold mt-1 truncate">₹{stats.commissionEarned.toLocaleString()}</p>
              <div className="flex items-center gap-1 mt-1">
                <ArrowUpRight className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0" />
                <span className="text-xs sm:text-sm text-orange-100">Click to view</span>
              </div>
            </div>
            <TrendingUp className="w-8 h-8 sm:w-12 sm:h-12 text-orange-200 flex-shrink-0" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card bg-gradient-to-br from-indigo-500 to-indigo-600 text-white cursor-pointer hover:shadow-xl transition-shadow col-span-2 md:col-span-1"
          onClick={() => {
            onTabChange('wallet')
            router.push('/dashboard/distributor?tab=wallet', { scroll: false })
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-indigo-100 text-xs sm:text-sm font-medium">Wallet Balance</p>
              <p className="text-xl sm:text-2xl lg:text-3xl font-bold mt-1 truncate">₹{stats.walletBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-xs sm:text-sm text-indigo-100">Click to manage</span>
              </div>
            </div>
            <Wallet className="w-8 h-8 sm:w-12 sm:h-12 text-indigo-200 flex-shrink-0" />
          </div>
        </motion.div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card lg:col-span-2"
        >
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Retailer Network Performance</h3>
          <ResponsiveContainer width="100%" height={300} minHeight={280}>
            <LineChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="retailers" stroke="#3b82f6" strokeWidth={2} name="Active Retailers" isAnimationActive={false} />
              <Line type="monotone" dataKey="revenue" stroke="#22c55e" strokeWidth={2} name="Revenue (₹)" isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card"
        >
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Retailer Status</h3>
          <ResponsiveContainer width="100%" height={300} minHeight={280}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="45%"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={2}
                dataKey="value"
                isAnimationActive={false}
                label={false}
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number) => [value, 'Count']}
                contentStyle={{ textAlign: 'left' }}
              />
              <Legend
                layout="horizontal"
                align="center"
                verticalAlign="bottom"
                formatter={(value, entry) => {
                  const item = pieData.find(d => d.name === value)
                  const total = pieData.reduce((s, d) => s + (d.value || 0), 0)
                  const pct = total > 0 && item ? ((item.value || 0) / total * 100).toFixed(0) : '0'
                  return `${value} ${pct}%`
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      {/* Transactions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="card"
      >
        <h3 className="text-lg font-semibold text-gray-900 mb-4">POS Transactions</h3>
        <TransactionsTable role="distributor" autoPoll={true} pollInterval={10000} />
      </motion.div>
    </>
  )
})

// Services Tab
function ServicesTab() {
  const { showToast } = useToast()
  const [services, setServices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchServicesData()
  }, [])

  const fetchServicesData = async () => {
    setLoading(true)
    try {
      const [bbpsData, aepsData, settlementData] = await Promise.all([
        supabase
          .from('bbps_transactions')
          .select('bill_amount, created_at, status')
          .eq('status', 'success'),
        supabase
          .from('aeps_transactions')
          .select('amount, created_at, status')
          .eq('status', 'success'),
        supabase
          .from('settlements')
          .select('amount, created_at, status')
          .eq('status', 'success')
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

      const servicesList = [
        {
          id: 'bbps',
          name: 'BBPS (Bill Payments)',
          icon: '📄',
          status: 'active',
          transactions: bbpsCount,
          revenue: `₹${bbpsRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
        },
        {
          id: 'aeps',
          name: 'AEPS Services',
          icon: '👆',
          status: 'active',
          transactions: aepsCount,
          revenue: `₹${aepsRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
        },
        {
          id: 'settlement',
          name: 'Settlement',
          icon: '💰',
          status: 'active',
          transactions: settlementCount,
          revenue: `₹${settlementRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
        },
        {
          id: 'pos',
          name: 'POS Transactions',
          icon: '💳',
          status: 'active',
          transactions: 0,
          revenue: '₹0'
        },
      ]

      setServices(servicesList)
    } catch (error) {
      console.error('Error fetching services data:', error)
      showToast('Failed to load services data', 'error')
      setServices([])
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {services.map((service) => (
          <motion.div
            key={service.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-5 hover:shadow-lg transition-shadow"
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
            <div className="space-y-2">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Transactions</p>
                <p className="text-lg font-bold text-gray-900 dark:text-white">{service.transactions}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Revenue</p>
                <p className="text-lg font-bold text-green-600 dark:text-green-400">{service.revenue}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {services.length === 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-8 text-center">
          <Activity className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 dark:text-gray-400">No services available yet.</p>
        </div>
      )}
    </div>
  )
}

// Wallet Tab
function WalletTab({ user }: { user: any }) {
  const { showToast } = useToast()
  const [walletBalance, setWalletBalance] = useState<number | null>(null)
  const [aepsBalance, setAepsBalance] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [ledgerEntries, setLedgerEntries] = useState<any[]>([])

  useEffect(() => {
    fetchWalletData()
  }, [user])

  const fetchWalletData = async () => {
    if (!user?.partner_id) return
    setLoading(true)
    try {
      let primaryBalance = 0
      try {
        const { data: balance } = await supabase.rpc('get_wallet_balance_v2', {
          p_user_id: user.partner_id,
          p_wallet_type: 'primary'
        })
        primaryBalance = balance || 0
      } catch {
        primaryBalance = 0
      }

      let aepsBalanceData = 0
      try {
        const { data: balance } = await supabase.rpc('get_wallet_balance_v2', {
          p_user_id: user.partner_id,
          p_wallet_type: 'aeps'
        })
        aepsBalanceData = balance || 0
      } catch {
        aepsBalanceData = 0
      }

      setWalletBalance(primaryBalance)
      setAepsBalance(aepsBalanceData)

      const { data: ledger } = await supabase
        .from('wallet_ledger')
        .select('*')
        .eq('retailer_id', user.partner_id)
        .eq('wallet_type', 'primary')
        .order('created_at', { ascending: false })
        .limit(50)

      setLedgerEntries(ledger || [])
    } catch (error) {
      console.error('Error fetching wallet data:', error)
      showToast('Failed to load wallet data', 'error')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg p-6 text-white"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-purple-100 text-sm font-medium mb-1">Primary Wallet</p>
              <p className="text-3xl font-bold">
                ₹{walletBalance?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
              </p>
            </div>
            <Wallet className="w-12 h-12 text-purple-200" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-xl shadow-lg p-6 text-white"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-indigo-100 text-sm font-medium mb-1">AEPS Wallet</p>
              <p className="text-3xl font-bold">
                ₹{aepsBalance?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
              </p>
            </div>
            <Wallet className="w-12 h-12 text-indigo-200" />
          </div>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-xl shadow-lg border border-gray-200 p-6"
      >
        <h3 className="text-lg font-semibold mb-4">Transaction History</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Category</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Credit</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Debit</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Balance</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {ledgerEntries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    No transactions found
                  </td>
                </tr>
              ) : (
                ledgerEntries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {new Date(entry.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">{entry.transaction_type}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{entry.fund_category || '-'}</td>
                    <td className="px-4 py-3 text-sm text-green-600">
                      {entry.credit > 0 ? `₹${entry.credit.toLocaleString()}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-red-600">
                      {entry.debit > 0 ? `₹${entry.debit.toLocaleString()}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      ₹{entry.closing_balance?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || '0.00'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        entry.status === 'completed' ? 'bg-green-100 text-green-800' :
                        entry.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                        entry.status === 'failed' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {entry.status || 'completed'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  )
}

// Network Tab - View and manage retailers
function NetworkTab({ retailers, user, onRefresh }: { retailers: any[], user: any, onRefresh: () => void }) {
  const { showToast } = useToast()
  const [searchTerm, setSearchTerm] = useState('')
  const [showFundTransfer, setShowFundTransfer] = useState(false)
  const [showAddRetailer, setShowAddRetailer] = useState(false)
  const [showRetailerDetail, setShowRetailerDetail] = useState(false)
  const [selectedUser, setSelectedUser] = useState<any>(null)
  const [detailRetailer, setDetailRetailer] = useState<any>(null)
  const [transferring, setTransferring] = useState(false)
  // Stable idempotency key for the in-progress fund transfer (cleared on success)
  const fundTransferIdemRef = useRef<string | null>(null)
  const [transferData, setTransferData] = useState({
    amount: '',
    fund_category: 'cash' as 'cash' | 'online',
    remarks: ''
  })

  const filteredRetailers = retailers.filter(r =>
    r.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.partner_id?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const handleFundTransfer = async (action: 'push' | 'pull') => {
    if (!selectedUser || !transferData.amount) {
      showToast('Please fill all fields', 'error')
      return
    }

    const amount = parseFloat(transferData.amount)
    if (isNaN(amount) || amount <= 0) {
      showToast('Please enter a valid amount', 'error')
      return
    }

    setTransferring(true)
    if (!fundTransferIdemRef.current) fundTransferIdemRef.current = newIdempotencyKey()
    try {
      const response = await apiFetch('/api/distributor/wallet/transfer', {
        method: 'POST',
        idempotencyKey: fundTransferIdemRef.current,
        body: JSON.stringify({
          retailer_id: selectedUser.partner_id,
          action: action,
          amount: amount,
          fund_category: transferData.fund_category,
          remarks: transferData.remarks || `${action} funds by distributor`
        })
      })

      const data = await response.json()
      if (data.success) {
        fundTransferIdemRef.current = null
        showToast(`Fund ${action} successful!`, 'success')
        setShowFundTransfer(false)
        setSelectedUser(null)
        setTransferData({ amount: '', fund_category: 'cash', remarks: '' })
        onRefresh()
      } else {
        showToast(data.error || 'Transfer failed', 'error')
      }
    } catch (error) {
      console.error('Transfer error:', error)
      showToast('Failed to transfer funds', 'error')
    } finally {
      setTransferring(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Search retailers..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border rounded-lg"
            />
          </div>
          <button
            onClick={() => setShowAddRetailer(true)}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Add Retailer
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Partner ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredRetailers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                    No retailers found
                  </td>
                </tr>
              ) : (
                filteredRetailers.map((retailer) => (
                  <tr key={retailer.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{retailer.partner_id}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{retailer.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{retailer.email}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 text-xs rounded-full ${
                        retailer.status === 'active' ? 'bg-green-100 text-green-800' :
                        retailer.status === 'inactive' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {retailer.status || 'active'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setSelectedUser(retailer)
                            setShowFundTransfer(true)
                          }}
                          className="p-2 text-green-600 hover:bg-green-50 rounded"
                          title="Push Funds"
                        >
                          <ArrowUpCircle className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => {
                            setSelectedUser(retailer)
                            setShowFundTransfer(true)
                          }}
                          className="p-2 text-red-600 hover:bg-red-50 rounded"
                          title="Pull Funds"
                        >
                          <ArrowDownCircle className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => {
                            setDetailRetailer(retailer)
                            setShowRetailerDetail(true)
                          }}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                          title="View Details"
                        >
                          <Eye className="w-5 h-5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Fund Transfer Modal */}
      {showFundTransfer && selectedUser && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
          >
            <h3 className="text-xl font-bold mb-4">Fund Transfer</h3>
            <div className="mb-4">
              <p className="text-sm text-gray-600">User: {selectedUser.name}</p>
              <p className="text-sm text-gray-600">Partner ID: {selectedUser.partner_id}</p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Amount (₹)</label>
                <input
                  type="number"
                  value={transferData.amount}
                  onChange={(e) => setTransferData({ ...transferData, amount: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg"
                  placeholder="Enter amount"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Fund Category</label>
                <select
                  value={transferData.fund_category}
                  onChange={(e) => setTransferData({ ...transferData, fund_category: e.target.value as 'cash' | 'online' })}
                  className="w-full px-4 py-2 border rounded-lg"
                >
                  <option value="cash">Cash</option>
                  <option value="online">Online</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Remarks</label>
                <textarea
                  value={transferData.remarks}
                  onChange={(e) => setTransferData({ ...transferData, remarks: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg"
                  rows={3}
                  placeholder="Enter remarks..."
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => handleFundTransfer('push')}
                  disabled={transferring}
                  className="flex-1 bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {transferring ? 'Processing...' : 'Push Funds'}
                </button>
                <button
                  onClick={() => handleFundTransfer('pull')}
                  disabled={transferring}
                  className="flex-1 bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {transferring ? 'Processing...' : 'Pull Funds'}
                </button>
                <button
                  onClick={() => {
                    setShowFundTransfer(false)
                    setSelectedUser(null)
                  }}
                  disabled={transferring}
                  className="flex-1 bg-gray-200 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-300 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Add Retailer Modal */}
      {showAddRetailer && (
        <AddRetailerModal
          onClose={() => setShowAddRetailer(false)}
          onSuccess={() => {
            setShowAddRetailer(false)
            onRefresh()
          }}
        />
      )}

      {/* Retailer Detail Modal */}
      {showRetailerDetail && detailRetailer && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between p-6 border-b border-gray-200 sticky top-0 bg-white rounded-t-xl z-10">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Retailer Details</h3>
                <p className="text-sm text-gray-500 mt-0.5">{detailRetailer.partner_id}</p>
              </div>
              <button
                onClick={() => { setShowRetailerDetail(false); setDetailRetailer(null) }}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Basic Info */}
              <div>
                <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Basic Information</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <DetailField label="Name" value={detailRetailer.name} />
                  <DetailField label="Email" value={detailRetailer.email} />
                  <DetailField label="Phone" value={detailRetailer.phone} />
                  <DetailField label="Status" value={
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      detailRetailer.status === 'active' ? 'bg-green-100 text-green-800' :
                      detailRetailer.status === 'inactive' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {detailRetailer.status || 'active'}
                    </span>
                  } />
                </div>
              </div>

              {/* Business Info */}
              <div>
                <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Business Information</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <DetailField label="Business Name" value={detailRetailer.business_name} />
                  <DetailField label="Commission Rate" value={detailRetailer.commission_rate ? `${detailRetailer.commission_rate}%` : null} />
                  <DetailField label="Address" value={detailRetailer.address} />
                  <DetailField label="City" value={detailRetailer.city} />
                  <DetailField label="State" value={detailRetailer.state} />
                  <DetailField label="Pincode" value={detailRetailer.pincode} />
                </div>
              </div>

              {/* Bank Details */}
              {(detailRetailer.bank_name || detailRetailer.account_number || detailRetailer.ifsc_code) && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Bank Details</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <DetailField label="Bank Name" value={detailRetailer.bank_name} />
                    <DetailField label="Account Number" value={detailRetailer.account_number} />
                    <DetailField label="IFSC Code" value={detailRetailer.ifsc_code} />
                  </div>
                </div>
              )}

              {/* KYC / Documents */}
              {(detailRetailer.aadhar_number || detailRetailer.pan_number || detailRetailer.gst_number || detailRetailer.udhyam_number) && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">KYC Documents</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <DetailField label="Aadhar Number" value={detailRetailer.aadhar_number} />
                    <DetailField label="PAN Number" value={detailRetailer.pan_number} />
                    {detailRetailer.gst_number && <DetailField label="GST Number" value={detailRetailer.gst_number} />}
                    {detailRetailer.udhyam_number && <DetailField label="Udhyam Number" value={detailRetailer.udhyam_number} />}
                  </div>
                </div>
              )}

              {/* Dates */}
              <div>
                <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Other</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <DetailField label="Created At" value={detailRetailer.created_at ? new Date(detailRetailer.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : null} />
                  <DetailField label="Distributor ID" value={detailRetailer.distributor_id} />
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 sticky bottom-0 bg-white rounded-b-xl">
              <button
                onClick={() => { setShowRetailerDetail(false); setDetailRetailer(null) }}
                className="w-full py-2.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
              >
                Close
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-gray-50 rounded-lg px-4 py-3">
      <p className="text-xs text-gray-500 font-medium">{label}</p>
      <div className="text-sm text-gray-900 mt-0.5 font-medium">{value || <span className="text-gray-400">—</span>}</div>
    </div>
  )
}

// Add Retailer Modal Component
function AddRetailerModal({ onClose, onSuccess }: { onClose: () => void, onSuccess: () => void }) {
  const { showToast } = useToast()
  const [currentStep, setCurrentStep] = useState(1)
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
    commission_rate: '',
    pan_number: '',
    account_number: '',
    ifsc_code: '',
    bank_name: '',
    gst_number: '',
    udhyam_number: '',
    aadhar_number: '',
    udhyam_applicable: false,
    gst_applicable: false,
    cin_applicable: false,
    cin_number: '',
  })
  const [loading, setLoading] = useState(false)
  const [showCreateFormPassword, setShowCreateFormPassword] = useState(false)

  // KYC verification state
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
  const [gstStatus, setGstStatus] = useState('')
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

  // Auto-fill business name from GST
  useEffect(() => {
    if (gstVerified && (gstTradeName || gstLegalName)) {
      setFormData(prev => ({ ...prev, business_name: gstTradeName || gstLegalName, address: gstAddress || prev.address }))
    }
  }, [gstVerified, gstTradeName, gstLegalName, gstAddress])

  // Auto-fill address from Aadhaar
  useEffect(() => {
    if (aadhaarVerified && aadhaarAddress && !formData.gst_applicable) {
      setFormData(prev => ({ ...prev, address: aadhaarAddress || prev.address }))
    }
  }, [aadhaarVerified, aadhaarAddress])

  const fetchDigilockerDocument = async (verification_id: string, reference_id: string) => {
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

  const handleDigilockerResult = (result: any) => {
    if (result.success && result.data) {
      if (result.pending) {
        const d = result.data
        if (d.verification_id) setDigilockerVerificationId(d.verification_id)
        fetchDigilockerDocument(d.verification_id, d.reference_id || d.verification_id)
      } else {
        const d = result.data
        setAadhaarVerified(true); setAadhaarName(d.name || ''); setAadhaarUid(d.uid || '')
        setAadhaarDob(d.dob || ''); setAadhaarGender(d.gender || ''); setAadhaarAddress(d.address || '')
        if (d.verification_id) setDigilockerVerificationId(d.verification_id)
        if (d.uid) setFormData(prev => ({ ...prev, aadhar_number: d.uid.replace(/\s/g, '') }))
      }
    } else if (result.error) { setDigilockerError(result.error) }
  }

  // Digilocker postMessage listener
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
    return () => { window.removeEventListener('message', handleDigilockerMessage); window.removeEventListener('storage', handleStorageChange) }
  }, [])

  const handleStep1Next = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name || !formData.email || !formData.phone || !formData.password) {
      showToast('Please fill all required fields', 'error')
      return
    }
    setCurrentStep(2)
  }

  const handleStep2Next = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.business_name) {
      showToast('Business Name is required', 'error')
      return
    }
    if (formData.gst_applicable && !gstVerified) {
      showToast('Please verify GST before proceeding', 'error')
      return
    }
    if (formData.cin_applicable && !cinVerified) {
      showToast('Please verify CIN before proceeding', 'error')
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
  }

  const handleVerifyCin = async () => {
    if (!formData.cin_number || formData.cin_number.length < 10) { setCinError('Enter valid CIN number'); return }
    setVerifyingCin(true); setCinError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
      const res = await apiFetch('/api/kyc/verify-cin', {
        method: 'POST',
        headers,
        body: JSON.stringify({ cin: formData.cin_number.toUpperCase() })
      })
      const data = await res.json()
      if (data.success) {
        setCinVerified(true); setCinCompanyName(data.data.company_name || ''); setCinStatus(data.data.cin_status || ''); setCinIncorporationDate(data.data.incorporation_date || '')
        setEkychubOrderIds(prev => ({ ...prev, cin: data.orderid }))
      } else { setCinError(data.error || 'CIN verification failed'); setCinVerified(false) }
    } catch (err: any) { setCinError(err.message || 'CIN verification failed'); setCinVerified(false) }
    finally { setVerifyingCin(false) }
  }

  const handleDigilockerAadhaar = async () => {
    setDigilockerLoading(true); setDigilockerError(''); setDigilockerUrl('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
      const res = await apiFetch('/api/kyc/verify-digilocker', {
        method: 'POST',
        headers,
        body: JSON.stringify({ type: 'aadhaar' })
      })
      const data = await res.json()
      if (data.success && data.data.url) {
        setDigilockerUrl(data.data.url); setDigilockerVerificationId(data.data.verification_id || '')
        window.open(data.data.url, '_blank')
      } else { setDigilockerError(data.error || 'Failed to generate Digilocker URL') }
    } catch (err: any) { setDigilockerError(err.message || 'Digilocker verification failed') }
    finally { setDigilockerLoading(false) }
  }

  const handleVerifyPan = async () => {
    if (!formData.pan_number || formData.pan_number.length !== 10) {
      setPanError('Enter valid 10-character PAN')
      return
    }
    setVerifyingPan(true)
    setPanError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
      const res = await apiFetch('/api/kyc/verify-pan', {
        method: 'POST',
        headers,
        body: JSON.stringify({ pan: formData.pan_number })
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
      setBankError('Account number and IFSC code are required')
      return
    }
    setVerifyingBank(true)
    setBankError('')
    setBankNameMismatch('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
      const res = await apiFetch('/api/kyc/verify-bank', {
        method: 'POST',
        headers,
        body: JSON.stringify({ account_number: formData.account_number, ifsc: formData.ifsc_code })
      })
      const data = await res.json()
      if (data.success) {
        const holderName = data.data.nameAtBank || ''
        setBankVerified(true)
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
    if (!formData.gst_number || formData.gst_number.length !== 15) {
      setGstError('Enter valid 15-character GST number')
      return
    }
    setVerifyingGst(true)
    setGstError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: HeadersInit = { 'Content-Type': 'application/json' }
      if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
      const res = await apiFetch('/api/kyc/verify-gst', {
        method: 'POST',
        headers,
        body: JSON.stringify({ gst: formData.gst_number })
      })
      const data = await res.json()
      if (data.success) {
        setGstVerified(true)
        setGstLegalName(data.data.legal_name || '')
        setGstTradeName(data.data.trade_name || '')
        setGstStatus(data.data.status || '')
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
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
    setLoading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const authHeaders: HeadersInit = { 'Content-Type': 'application/json' }
      if (session?.access_token) {
        authHeaders['Authorization'] = `Bearer ${session.access_token}`
      }
      const response = await apiFetch('/api/distributor/create-retailer', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          userData: {
            name: formData.name,
            phone: formData.phone,
            business_name: formData.business_name || null,
            address: formData.address || null,
            city: formData.city || null,
            state: formData.state || null,
            pincode: formData.pincode || null,
            commission_rate: formData.commission_rate ? parseFloat(formData.commission_rate) : null,
            pan_number: formData.pan_number,
            account_number: formData.account_number,
            ifsc_code: formData.ifsc_code,
            bank_name: formData.bank_name || null,
            aadhar_number: formData.aadhar_number || null,
            gst_number: formData.gst_applicable ? formData.gst_number : null,
            udhyam_number: formData.udhyam_applicable ? formData.udhyam_number : null,
            pan_verified: panVerified,
            pan_registered_name: panRegisteredName || null,
            pan_type: panType || null,
            bank_verified: bankVerified,
            bank_verified_name: bankVerifiedName || null,
            bank_utr: bankUtr || null,
            gst_verified: gstVerified,
            gst_legal_name: gstLegalName || null,
            gst_trade_name: gstTradeName || null,
            gst_status: gstStatus || null,
            gst_taxpayer_type: gstTaxpayerType || null,
            gst_constitution: gstConstitution || null,
            gst_address: gstAddress || null,
            cin_number: formData.cin_applicable ? formData.cin_number : null,
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
          }
        })
      })
      const data = await response.json()
      if (data.success) {
        showToast('Retailer created successfully! Status: Pending Verification.', 'success')
        onSuccess()
      } else {
        showToast(data.error || 'Failed to create retailer', 'error')
      }
    } catch (error: any) {
      console.error('Error creating retailer:', error)
      showToast(error.message || 'Failed to create retailer', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold">Add Retailer</h3>
              <p className="text-sm text-gray-500 mt-1">
                Step {currentStep} of 3: {currentStep === 1 ? 'Personal Details' : currentStep === 2 ? 'Business & Address' : 'KYC Verification'}
              </p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="mt-4 flex gap-1.5">
            <div className={`flex-1 h-2 rounded-full ${currentStep >= 1 ? 'bg-purple-600' : 'bg-gray-200'}`}></div>
            <div className={`flex-1 h-2 rounded-full ${currentStep >= 2 ? 'bg-purple-600' : 'bg-gray-200'}`}></div>
            <div className={`flex-1 h-2 rounded-full ${currentStep >= 3 ? 'bg-purple-600' : 'bg-gray-200'}`}></div>
          </div>
          <div className="flex justify-between mt-1.5">
            <span className={`text-xs font-medium ${currentStep === 1 ? 'text-purple-600' : 'text-gray-400'}`}>Personal</span>
            <span className={`text-xs font-medium ${currentStep === 2 ? 'text-purple-600' : 'text-gray-400'}`}>Business</span>
            <span className={`text-xs font-medium ${currentStep === 3 ? 'text-purple-600' : 'text-gray-400'}`}>KYC</span>
          </div>
        </div>

        {currentStep === 1 && (
          <form onSubmit={handleStep1Next} className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name *</label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Email *</label>
              <input
                type="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Phone *</label>
              <input
                type="tel"
                required
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Password *</label>
              <div className="relative">
                <input
                  type={showCreateFormPassword ? 'text' : 'password'}
                  required
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full px-3 py-2 pr-10 border rounded-lg"
                />
                <button type="button" onClick={() => setShowCreateFormPassword(!showCreateFormPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700">
                  {showCreateFormPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Commission Rate (%)</label>
              <input
                type="number"
                step="0.01"
                value={formData.commission_rate}
                onChange={(e) => setFormData({ ...formData, commission_rate: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
            >
              Next: Business Details
            </button>
          </div>
        </form>
        )}
        {currentStep === 2 && (
          <form onSubmit={handleStep2Next} className="p-6 space-y-5">
            {/* GST Verification */}
            <div className={`border rounded-lg p-4 ${gstVerified ? 'border-green-300 bg-green-50' : 'border-gray-200'}`}>
              <div className="flex items-center mb-3">
                <input
                  type="checkbox"
                  id="gst_applicable_step2"
                  checked={formData.gst_applicable}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setFormData({ ...formData, gst_applicable: checked, gst_number: checked ? formData.gst_number : '' })
                    if (!checked) { setGstVerified(false); setGstError('') }
                  }}
                  className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                />
                <label htmlFor="gst_applicable_step2" className="ml-2 text-md font-semibold text-purple-600">
                  GST Registered
                </label>
              </div>
              {formData.gst_applicable && (
                <>
                  <div className="flex gap-3 items-end">
                    <div className="flex-1">
                      <label className="block text-sm font-medium mb-1">GST Number</label>
                      <input
                        type="text"
                        value={formData.gst_number}
                        onChange={(e) => {
                          setFormData({ ...formData, gst_number: e.target.value.toUpperCase() })
                          if (gstVerified) { setGstVerified(false); setGstLegalName(''); setGstTradeName(''); setGstStatus('') }
                        }}
                        className="w-full px-3 py-2 border rounded-lg"
                        placeholder="Enter 15-character GST number"
                        maxLength={15}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleVerifyGst}
                      disabled={verifyingGst || gstVerified}
                      className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
                    >
                      {verifyingGst ? <Loader2 className="w-4 h-4 animate-spin" /> : gstVerified ? <CheckCircle className="w-4 h-4" /> : null}
                      {gstVerified ? 'Verified' : 'Verify GST'}
                    </button>
                  </div>
                  {gstError && (
                    <div className="mt-2 flex items-center gap-1 text-red-600 text-sm">
                      <AlertCircle className="w-4 h-4" /> {gstError}
                    </div>
                  )}
                  {gstVerified && (
                    <div className="mt-3 bg-green-100 border border-green-200 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-green-700 text-sm font-medium">
                        <CheckCircle className="w-4 h-4" /> GST Verified
                      </div>
                      <div className="grid grid-cols-2 gap-1 mt-1 text-sm text-green-800">
                        <p>Legal Name: {gstLegalName}</p>
                        <p>Trade Name: {gstTradeName}</p>
                        <p>Status: {gstStatus}</p>
                        <p>Type: {gstTaxpayerType}</p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Business Name */}
            <div>
              <label className="block text-sm font-medium mb-1">Business Name *</label>
              <input
                type="text"
                required
                value={formData.business_name}
                onChange={(e) => setFormData({ ...formData, business_name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder={gstVerified ? 'Auto-filled from GST' : 'Enter business name'}
              />
            </div>

            {/* CIN Verification */}
            <div className={`border rounded-lg p-4 ${cinVerified ? 'border-green-300 bg-green-50' : 'border-gray-200'}`}>
              <div className="flex items-center mb-3">
                <input
                  type="checkbox"
                  id="cin_applicable_step2"
                  checked={formData.cin_applicable}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setFormData({ ...formData, cin_applicable: checked, cin_number: checked ? formData.cin_number : '' })
                    if (!checked) { setCinVerified(false); setCinError('') }
                  }}
                  className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                />
                <label htmlFor="cin_applicable_step2" className="ml-2 text-md font-semibold text-purple-600">
                  Company CIN Verification
                </label>
              </div>
              {formData.cin_applicable && (
                <>
                  <div className="flex gap-3 items-end">
                    <div className="flex-1">
                      <label className="block text-sm font-medium mb-1">CIN Number</label>
                      <input
                        type="text"
                        value={formData.cin_number}
                        onChange={(e) => {
                          setFormData({ ...formData, cin_number: e.target.value.toUpperCase() })
                          if (cinVerified) { setCinVerified(false); setCinCompanyName(''); setCinStatus('') }
                        }}
                        className="w-full px-3 py-2 border rounded-lg"
                        placeholder="Enter CIN number"
                        maxLength={21}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleVerifyCin}
                      disabled={verifyingCin || cinVerified}
                      className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
                    >
                      {verifyingCin ? <Loader2 className="w-4 h-4 animate-spin" /> : cinVerified ? <CheckCircle className="w-4 h-4" /> : null}
                      {cinVerified ? 'Verified' : 'Verify CIN'}
                    </button>
                  </div>
                  {cinError && (
                    <div className="mt-2 flex items-center gap-1 text-red-600 text-sm">
                      <AlertCircle className="w-4 h-4" /> {cinError}
                    </div>
                  )}
                  {cinVerified && (
                    <div className="mt-3 bg-green-100 border border-green-200 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-green-700 text-sm font-medium">
                        <CheckCircle className="w-4 h-4" /> CIN Verified
                      </div>
                      <div className="grid grid-cols-2 gap-1 mt-1 text-sm text-green-800">
                        <p>Company: {cinCompanyName}</p>
                        <p>Status: {cinStatus}</p>
                        <p>Incorporation: {cinIncorporationDate}</p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* UDHYAM Registration */}
            <div className="border rounded-lg p-4 border-gray-200">
              <div className="flex items-center mb-3">
                <input
                  type="checkbox"
                  id="udhyam_applicable_step2"
                  checked={formData.udhyam_applicable}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setFormData({ ...formData, udhyam_applicable: checked, udhyam_number: checked ? formData.udhyam_number : '' })
                  }}
                  className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                />
                <label htmlFor="udhyam_applicable_step2" className="ml-2 text-md font-semibold text-purple-600">
                  UDHYAM Registration
                </label>
              </div>
              {formData.udhyam_applicable && (
                <div>
                  <label className="block text-sm font-medium mb-1">UDHYAM Number</label>
                  <input
                    type="text"
                    value={formData.udhyam_number}
                    onChange={(e) => setFormData({ ...formData, udhyam_number: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="Enter UDHYAM registration number"
                  />
                </div>
              )}
            </div>

            {/* Aadhaar Verification */}
            <div className={`border rounded-lg p-4 ${aadhaarVerified ? 'border-green-300 bg-green-50' : 'border-gray-200'}`}>
              <h5 className="text-md font-semibold mb-3 text-purple-600 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" /> Aadhaar Verification
              </h5>
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <label className="block text-sm font-medium mb-1">Aadhaar Number</label>
                  <input
                    type="text"
                    value={formData.aadhar_number}
                    onChange={(e) => setFormData({ ...formData, aadhar_number: e.target.value.replace(/\D/g, '').slice(0, 12) })}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="Enter 12-digit Aadhaar number"
                    maxLength={12}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleDigilockerAadhaar}
                  disabled={digilockerLoading || aadhaarVerified}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
                >
                  {digilockerLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : aadhaarVerified ? <CheckCircle className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                  {aadhaarVerified ? 'Verified' : 'Verify via Digilocker'}
                </button>
              </div>
              {digilockerError && (
                <div className="mt-2 flex items-center gap-1 text-red-600 text-sm">
                  <AlertCircle className="w-4 h-4" /> {digilockerError}
                </div>
              )}
              {aadhaarVerified && (
                <div className="mt-3 bg-green-100 border border-green-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-green-700 text-sm font-medium">
                    <CheckCircle className="w-4 h-4" /> Aadhaar Verified via Digilocker
                  </div>
                  <div className="grid grid-cols-2 gap-1 mt-1 text-sm text-green-800">
                    <p>Name: {aadhaarName}</p>
                    <p>UID: {aadhaarUid}</p>
                    <p>DOB: {aadhaarDob}</p>
                    <p>Gender: {aadhaarGender}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Address */}
            <div className="border rounded-lg p-4 border-gray-200">
              <h5 className="text-md font-semibold mb-3 text-purple-600 flex items-center gap-2">
                <Building2 className="w-4 h-4" /> Address
              </h5>
              {(gstVerified && gstAddress) || (aadhaarVerified && aadhaarAddress) ? (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-green-700 text-sm font-medium mb-1">
                    <CheckCircle className="w-4 h-4" /> Address from {gstVerified && gstAddress ? 'GST' : 'Aadhaar'} Verification
                  </div>
                  <p className="text-sm text-green-800">{formData.address}</p>
                </div>
              ) : (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-amber-700 font-medium mb-1 text-sm">
                    <AlertCircle className="w-4 h-4" /> Address will be captured from API
                  </div>
                  <p className="text-xs text-amber-600">Verify GST to auto-fill address, or verify Aadhaar via Digilocker if GST is not applicable.</p>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-4 border-t">
              <button
                type="button"
                onClick={() => setCurrentStep(1)}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                Back
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
              >
                Next: KYC Verification
              </button>
            </div>
          </form>
        )}

        {currentStep === 3 && (
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            <div className="mb-4">
              <h4 className="text-lg font-semibold mb-2">KYC Verification</h4>
              <p className="text-sm text-gray-600">Verify identity and bank details using eKYC APIs.</p>
            </div>

            {/* PAN Verification Section */}
            <div className={`border rounded-lg p-4 ${panVerified ? 'border-green-300 bg-green-50' : 'border-gray-200'}`}>
              <h5 className="text-md font-semibold mb-3 text-purple-600">PAN Verification *</h5>
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <label className="block text-sm font-medium mb-1">PAN Number</label>
                  <input
                    type="text"
                    value={formData.pan_number}
                    onChange={(e) => {
                      setFormData({ ...formData, pan_number: e.target.value.toUpperCase() })
                      if (panVerified) { setPanVerified(false); setPanRegisteredName(''); setPanType('') }
                    }}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="ABCDE1234F"
                    maxLength={10}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleVerifyPan}
                  disabled={verifyingPan || panVerified}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
                >
                  {verifyingPan ? <Loader2 className="w-4 h-4 animate-spin" /> : panVerified ? <CheckCircle className="w-4 h-4" /> : null}
                  {panVerified ? 'Verified' : 'Verify PAN'}
                </button>
              </div>
              {panError && (
                <div className="mt-2 flex items-center gap-1 text-red-600 text-sm">
                  <AlertCircle className="w-4 h-4" /> {panError}
                </div>
              )}
              {panVerified && (
                <div className="mt-3 bg-green-100 border border-green-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-green-700 text-sm font-medium">
                    <CheckCircle className="w-4 h-4" /> PAN Verified
                  </div>
                  <p className="text-sm text-green-800 mt-1">Name: {panRegisteredName}</p>
                  <p className="text-sm text-green-800">Type: {panType}</p>
                </div>
              )}
            </div>

            {/* Bank Account Verification Section */}
            <div className={`border rounded-lg p-4 ${bankVerified ? 'border-green-300 bg-green-50' : 'border-gray-200'}`}>
              <h5 className="text-md font-semibold mb-3 text-purple-600">Bank Account Verification *</h5>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Account Number</label>
                  <input
                    type="text"
                    value={formData.account_number}
                    onChange={(e) => {
                      setFormData({ ...formData, account_number: e.target.value })
                      if (bankVerified) { setBankVerified(false); setBankVerifiedName(''); setBankUtr('') }
                    }}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="Enter account number"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">IFSC Code</label>
                  <input
                    type="text"
                    value={formData.ifsc_code}
                    onChange={(e) => {
                      setFormData({ ...formData, ifsc_code: e.target.value.toUpperCase() })
                      if (bankVerified) { setBankVerified(false); setBankVerifiedName(''); setBankUtr('') }
                    }}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="Enter IFSC code"
                    maxLength={11}
                  />
                </div>
                <div className="col-span-2">
                  <button
                    type="button"
                    onClick={handleVerifyBank}
                    disabled={verifyingBank || bankVerified}
                    className={`w-full px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 font-medium transition-colors ${bankVerified ? 'bg-green-100 text-green-700 border border-green-300' : 'bg-purple-600 text-white hover:bg-purple-700'} disabled:opacity-50`}
                  >
                    {verifyingBank ? <Loader2 className="w-4 h-4 animate-spin" /> : bankVerified ? <CheckCircle className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                    {verifyingBank ? 'Verifying...' : bankVerified ? 'Bank Account Verified' : 'Verify Bank Account'}
                  </button>
                  {bankVerified && formData.bank_name && (
                    <div className="mt-2 p-2 bg-green-50 border border-green-200 rounded-lg">
                      <p className="text-xs text-gray-500">Bank Name</p>
                      <p className="text-sm font-medium text-green-800">{formData.bank_name}</p>
                    </div>
                  )}
                </div>
              </div>
              {bankError && (
                <div className="mt-2 flex items-center gap-1 text-red-600 text-sm">
                  <AlertCircle className="w-4 h-4" /> {bankError}
                </div>
              )}
              {bankNameMismatch && (
                <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 inline mr-1" /> {bankNameMismatch}
                </div>
              )}
              {bankVerified && (
                <div className="mt-3 bg-green-100 border border-green-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-green-700 text-sm font-medium">
                    <CheckCircle className="w-4 h-4" /> Bank Account Verified
                  </div>
                  <p className="text-sm text-green-800 mt-1">Name at Bank: {bankVerifiedName}</p>
                  <p className="text-sm text-green-800">UTR: {bankUtr}</p>
                </div>
              )}
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

            <div className="flex gap-3 pt-4 border-t">
              <button
                type="button"
                onClick={() => setCurrentStep(2)}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                Back
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !panVerified || !aadhaarVerified || !bankVerified || !!bankNameMismatch}
                className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                {loading ? 'Creating...' : 'Submit for Verification'}
              </button>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  )
}

// Commission Tab
function CommissionTab({ commissionData, stats, onRefresh }: { commissionData: any[], stats: any, onRefresh: () => void }) {
  const { showToast } = useToast()
  const [showAdjustment, setShowAdjustment] = useState(false)
  const [selectedCommission, setSelectedCommission] = useState<any>(null)
  const [adjusting, setAdjusting] = useState(false)
  const [adjustmentData, setAdjustmentData] = useState({
    adjustment_amount: '',
    adjustment_type: 'add' as 'add' | 'deduct',
    remarks: ''
  })

  const handleAdjustment = async () => {
    if (!selectedCommission || !adjustmentData.adjustment_amount) {
      showToast('Please fill all fields', 'error')
      return
    }

    const amount = parseFloat(adjustmentData.adjustment_amount)
    if (isNaN(amount) || amount <= 0) {
      showToast('Please enter a valid amount', 'error')
      return
    }

    setAdjusting(true)
    try {
      const { data: transaction } = await supabase
        .from('razorpay_transactions')
        .select('retailer_id')
        .eq('id', selectedCommission.transaction_id)
        .single()

      if (!transaction) {
        showToast('Transaction not found', 'error')
        setAdjusting(false)
        return
      }

      const response = await apiFetch('/api/distributor/commission/adjust', {
        method: 'POST',
        body: JSON.stringify({
          retailer_id: transaction.retailer_id,
          commission_id: selectedCommission.id,
          adjustment_amount: amount,
          adjustment_type: adjustmentData.adjustment_type,
          remarks: adjustmentData.remarks
        })
      })

      const data = await response.json()
      if (data.success) {
        showToast(`Commission ${adjustmentData.adjustment_type === 'add' ? 'added' : 'deducted'} successfully!`, 'success')
        setShowAdjustment(false)
        setSelectedCommission(null)
        setAdjustmentData({ adjustment_amount: '', adjustment_type: 'add', remarks: '' })
        onRefresh()
      } else {
        showToast(data.error || 'Adjustment failed', 'error')
      }
    } catch (error) {
      console.error('Adjustment error:', error)
      showToast('Failed to adjust commission', 'error')
    } finally {
      setAdjusting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl shadow-lg p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-orange-100 text-sm font-medium mb-1">Total Commission Earned</p>
            <p className="text-4xl font-bold">₹{stats.commissionEarned.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
          </div>
          <TrendingUp className="w-16 h-16 text-orange-200" />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold mb-4">Commission History</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Transaction ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Service Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">MDR %</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Commission</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {commissionData.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    No commission records found
                  </td>
                </tr>
              ) : (
                commissionData.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {new Date(entry.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">{entry.reference_id || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{entry.service_type || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{entry.mdr_percentage || 0}%</td>
                    <td className="px-4 py-3 text-sm font-medium text-green-600">
                      ₹{entry.dt_amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || '0.00'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className="px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">
                        {entry.status || 'credited'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <button
                        onClick={() => {
                          setSelectedCommission(entry)
                          setShowAdjustment(true)
                        }}
                        className="px-3 py-1 text-xs bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
                      >
                        Adjust
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Commission Adjustment Modal */}
      {showAdjustment && selectedCommission && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
          >
            <h3 className="text-xl font-bold mb-4">Adjust Commission</h3>
            <div className="mb-4">
              <p className="text-sm text-gray-600">Current Commission: ₹{selectedCommission.dt_amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || '0.00'}</p>
              <p className="text-sm text-gray-600">Transaction ID: {selectedCommission.reference_id || '-'}</p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Adjustment Type</label>
                <select
                  value={adjustmentData.adjustment_type}
                  onChange={(e) => setAdjustmentData({ ...adjustmentData, adjustment_type: e.target.value as 'add' | 'deduct' })}
                  className="w-full px-4 py-2 border rounded-lg"
                >
                  <option value="add">Add Commission</option>
                  <option value="deduct">Deduct Commission</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Amount (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={adjustmentData.adjustment_amount}
                  onChange={(e) => setAdjustmentData({ ...adjustmentData, adjustment_amount: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg"
                  placeholder="Enter adjustment amount"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Remarks</label>
                <textarea
                  value={adjustmentData.remarks}
                  onChange={(e) => setAdjustmentData({ ...adjustmentData, remarks: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg"
                  rows={3}
                  placeholder="Enter remarks..."
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleAdjustment}
                  disabled={adjusting}
                  className="flex-1 bg-orange-600 text-white py-2 px-4 rounded-lg hover:bg-orange-700 disabled:opacity-50"
                >
                  {adjusting ? 'Processing...' : `${adjustmentData.adjustment_type === 'add' ? 'Add' : 'Deduct'} Commission`}
                </button>
                <button
                  onClick={() => {
                    setShowAdjustment(false)
                    setSelectedCommission(null)
                    setAdjustmentData({ adjustment_amount: '', adjustment_type: 'add', remarks: '' })
                  }}
                  disabled={adjusting}
                  className="flex-1 bg-gray-200 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-300 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}

// Analytics Tab
function AnalyticsTab({ categoryData }: { categoryData: any[] }) {
  const COLORS = ['#3b82f6', '#22c55e', '#f97316', '#a855f7', '#ef4444', '#06b6d4', '#f59e0b']

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold mb-4">Business by Category</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-4">Revenue by Category</h4>
            <ResponsiveContainer width="100%" height={300} minHeight={280}>
              <PieChart>
                <Pie
                  data={categoryData}
                  cx="50%"
                  cy="45%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="revenue"
                  isAnimationActive={false}
                  label={false}
                >
                  {categoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => [value, 'Revenue']} contentStyle={{ textAlign: 'left' }} />
                <Legend
                  layout="horizontal"
                  align="center"
                  verticalAlign="bottom"
                  formatter={(value, entry) => {
                    const item = categoryData.find(d => d.name === value)
                    const total = categoryData.reduce((s, d) => s + (d.revenue || 0), 0)
                    const pct = total > 0 && item ? (((item.revenue || 0) / total * 100).toFixed(0)) : '0'
                    return `${value} ${pct}%`
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-4">Transactions by Category</h4>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={categoryData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="transactions" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold mb-4">Category Performance</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Category</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Revenue</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Transactions</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Trend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {categoryData.map((cat) => (
                <tr key={cat.name} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 capitalize">{cat.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-900">₹{cat.revenue.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-gray-900">{cat.transactions}</td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <ArrowUpRight className="w-4 h-4 text-green-600" />
                      <span className="text-green-600">+{Math.floor(Math.random() * 20) + 5}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// Reports Tab
function ReportsTab({ user }: { user: any }) {
  const { showToast } = useToast()
  const [reportType, setReportType] = useState<'ledger' | 'transactions' | 'commission'>('ledger')
  const [dateRange, setDateRange] = useState({ start: '', end: '' })
  const [format, setFormat] = useState<'csv' | 'pdf' | 'zip'>('csv')
  const [downloading, setDownloading] = useState(false)

  const handleDownload = async () => {
    if (!dateRange.start || !dateRange.end) {
      showToast('Please select date range', 'error')
      return
    }

    setDownloading(true)
    try {
      const response = await apiFetch(`/api/reports/${reportType}?start=${dateRange.start}&end=${dateRange.end}&format=${format}`, {
        method: 'GET',
      })

      if (response.ok) {
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${reportType}_report_${dateRange.start}_to_${dateRange.end}.${format}`
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
        showToast('Report downloaded successfully!', 'success')
      } else {
        showToast('Failed to download report', 'error')
      }
    } catch (error) {
      console.error('Download error:', error)
      showToast('Failed to download report', 'error')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Service Transaction Report */}
      <ServiceTransactionReport userRole="distributor" userName={user?.name || user?.email} />

      <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold mb-4">Download Reports</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Report Type</label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value as 'ledger' | 'transactions' | 'commission')}
              className="w-full px-4 py-2 border rounded-lg"
            >
              <option value="ledger">Ledger Report</option>
              <option value="transactions">Transaction Report</option>
              <option value="commission">Commission Report</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Start Date</label>
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">End Date</label>
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Format</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as 'csv' | 'pdf' | 'zip')}
              className="w-full px-4 py-2 border rounded-lg"
            >
              <option value="csv">CSV</option>
              <option value="pdf">PDF</option>
              <option value="zip">ZIP (Bulk Export)</option>
            </select>
          </div>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="w-full bg-purple-600 text-white py-2 px-4 rounded-lg hover:bg-purple-700 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Download className="w-5 h-5" />
            {downloading ? 'Downloading...' : 'Download Report'}
          </button>
        </div>
      </div>
    </div>
  )
}

// MDR Schemes Tab
function MDRSchemesTab({ user, retailers, onRefresh }: { user: any, retailers: any[], onRefresh: () => void }) {
  const { showToast } = useToast()
  const [schemes, setSchemes] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editingScheme, setEditingScheme] = useState<any>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRetailer, setSelectedRetailer] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    retailer_id: '',
    mode: 'CARD' as 'CARD' | 'UPI',
    card_type: null as 'CREDIT' | 'DEBIT' | 'PREPAID' | null,
    brand_type: '',
    retailer_mdr_t1: '',
    retailer_mdr_t0: '',
    distributor_mdr_t1: '',
    distributor_mdr_t0: '',
    status: 'active' as 'active' | 'inactive',
  })

  useEffect(() => {
    fetchSchemes()
  }, [user])

  const fetchSchemes = async () => {
    if (!user?.partner_id) return
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('retailer_schemes')
        .select('*, retailers(name, partner_id)')
        .eq('distributor_id', user.partner_id)
        .order('created_at', { ascending: false })

      if (error) throw error
      setSchemes(data || [])
    } catch (error) {
      console.error('Error fetching schemes:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user?.partner_id) return
    setLoading(true)

    try {
      const retailer_mdr_t1 = parseFloat(formData.retailer_mdr_t1)
      const retailer_mdr_t0 = parseFloat(formData.retailer_mdr_t0)
      const distributor_mdr_t1 = parseFloat(formData.distributor_mdr_t1)
      const distributor_mdr_t0 = parseFloat(formData.distributor_mdr_t0)

      if (retailer_mdr_t1 < distributor_mdr_t1) {
        showToast('Retailer MDR T+1 must be >= Distributor MDR T+1', 'error')
        return
      }
      if (retailer_mdr_t0 < distributor_mdr_t0) {
        showToast('Retailer MDR T+0 must be >= Distributor MDR T+0', 'error')
        return
      }

      const schemeData = {
        distributor_id: user.partner_id,
        retailer_id: formData.retailer_id,
        mode: formData.mode,
        card_type: formData.card_type || null,
        brand_type: formData.brand_type || null,
        retailer_mdr_t1,
        retailer_mdr_t0,
        distributor_mdr_t1,
        distributor_mdr_t0,
        status: formData.status,
        effective_date: new Date().toISOString(),
      }

      if (editingScheme) {
        const { error } = await supabase
          .from('retailer_schemes')
          .update(schemeData)
          .eq('id', editingScheme.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('retailer_schemes')
          .insert(schemeData)
        if (error) throw error
      }

      setShowModal(false)
      setEditingScheme(null)
      resetForm()
      fetchSchemes()
      onRefresh()
      showToast(editingScheme ? 'Scheme updated successfully' : 'Scheme created successfully', 'success')
    } catch (error: any) {
      console.error('Error saving scheme:', error)
      showToast(error.message || 'Failed to save scheme', 'error')
    } finally {
      setLoading(false)
    }
  }

  const resetForm = () => {
    setFormData({
      retailer_id: '',
      mode: 'CARD',
      card_type: null,
      brand_type: '',
      retailer_mdr_t1: '',
      retailer_mdr_t0: '',
      distributor_mdr_t1: '',
      distributor_mdr_t0: '',
      status: 'active',
    })
  }

  const handleEdit = (scheme: any) => {
    setEditingScheme(scheme)
    setFormData({
      retailer_id: scheme.retailer_id,
      mode: scheme.mode,
      card_type: scheme.card_type,
      brand_type: scheme.brand_type || '',
      retailer_mdr_t1: scheme.retailer_mdr_t1.toString(),
      retailer_mdr_t0: scheme.retailer_mdr_t0.toString(),
      distributor_mdr_t1: scheme.distributor_mdr_t1.toString(),
      distributor_mdr_t0: scheme.distributor_mdr_t0.toString(),
      status: scheme.status,
    })
    setShowModal(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this scheme?')) return
    setDeletingId(id)
    try {
      const { error } = await supabase
        .from('retailer_schemes')
        .delete()
        .eq('id', id)
      if (error) throw error
      fetchSchemes()
      showToast('Scheme deleted successfully', 'success')
    } catch (error: any) {
      showToast(error.message || 'Failed to delete scheme', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  const filteredSchemes = schemes.filter(scheme => {
    const matchesSearch = 
      scheme.mode?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      scheme.retailers?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      scheme.brand_type?.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesRetailer = !selectedRetailer || scheme.retailer_id === selectedRetailer
    return matchesSearch && matchesRetailer
  })

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-xl font-bold text-gray-900">Retailer MDR Schemes</h3>
            <p className="text-sm text-gray-600">Create custom MDR schemes for your retailers</p>
          </div>
          <button
            onClick={() => {
              setEditingScheme(null)
              resetForm()
              setShowModal(true)
            }}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg hover:shadow-lg transition-all"
          >
            <Plus className="w-4 h-4" />
            Create Scheme
          </button>
        </div>

        {/* Filters */}
        <div className="mb-4 flex gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Search schemes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          <select
            value={selectedRetailer}
            onChange={(e) => setSelectedRetailer(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg"
          >
            <option value="">All Retailers</option>
            {retailers.map((r) => (
              <option key={r.partner_id} value={r.partner_id}>{r.name}</option>
            ))}
          </select>
          <button
            onClick={fetchSchemes}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>

        {/* Schemes Table */}
        {loading ? (
          <div className="text-center py-12">Loading...</div>
        ) : filteredSchemes.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No schemes found. Create your first scheme!</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Retailer</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Mode</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Card Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">RT MDR T+1</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">RT MDR T+0</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">DT MDR T+1</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">DT MDR T+0</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredSchemes.map((scheme) => (
                  <tr key={scheme.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm">{scheme.retailers?.name || scheme.retailer_id}</td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex items-center gap-2">
                        {scheme.mode === 'CARD' ? (
                          <CreditCard className="w-4 h-4 text-blue-500" />
                        ) : (
                          <Smartphone className="w-4 h-4 text-green-500" />
                        )}
                        {scheme.mode}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm">{scheme.card_type || '-'}</td>
                    <td className="px-4 py-3 text-sm font-medium">{scheme.retailer_mdr_t1}%</td>
                    <td className="px-4 py-3 text-sm font-medium text-green-600">{scheme.retailer_mdr_t0}%</td>
                    <td className="px-4 py-3 text-sm font-medium">{scheme.distributor_mdr_t1}%</td>
                    <td className="px-4 py-3 text-sm font-medium text-green-600">{scheme.distributor_mdr_t0}%</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs rounded-full ${
                        scheme.status === 'active'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {scheme.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => handleEdit(scheme)} className="p-1 text-blue-600 hover:text-blue-800">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(scheme.id)} disabled={deletingId === scheme.id} className="p-1 text-red-600 hover:text-red-800 disabled:opacity-50">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold">{editingScheme ? 'Edit Scheme' : 'Create Retailer Scheme'}</h2>
                <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-100 rounded-lg">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Retailer *</label>
                  <select
                    value={formData.retailer_id}
                    onChange={(e) => setFormData({ ...formData, retailer_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    required
                  >
                    <option value="">Select Retailer</option>
                    {retailers.map((r) => (
                      <option key={r.partner_id} value={r.partner_id}>{r.name} ({r.partner_id})</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Payment Mode *</label>
                    <select
                      value={formData.mode}
                      onChange={(e) => setFormData({ ...formData, mode: e.target.value as 'CARD' | 'UPI' })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      required
                    >
                      <option value="CARD">CARD</option>
                      <option value="UPI">UPI</option>
                    </select>
                  </div>

                  {formData.mode === 'CARD' && (
                    <div>
                      <label className="block text-sm font-medium mb-1">Card Type</label>
                      <select
                        value={formData.card_type || ''}
                        onChange={(e) => setFormData({ ...formData, card_type: e.target.value as any || null })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      >
                        <option value="">All Card Types</option>
                        <option value="CREDIT">CREDIT</option>
                        <option value="DEBIT">DEBIT</option>
                        <option value="PREPAID">PREPAID</option>
                      </select>
                    </div>
                  )}

                  {formData.mode === 'CARD' && (
                    <div>
                      <label className="block text-sm font-medium mb-1">Brand Type (Optional)</label>
                      <input
                        type="text"
                        value={formData.brand_type}
                        onChange={(e) => setFormData({ ...formData, brand_type: e.target.value })}
                        placeholder="VISA, MasterCard, etc."
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                  )}
                </div>

                <div className="border-t pt-4">
                  <h3 className="text-lg font-semibold mb-4">MDR Rates</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">Retailer MDR T+1 (%) *</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={formData.retailer_mdr_t1}
                        onChange={(e) => setFormData({ ...formData, retailer_mdr_t1: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Retailer MDR T+0 (%) *</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={formData.retailer_mdr_t0}
                        onChange={(e) => setFormData({ ...formData, retailer_mdr_t0: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Distributor MDR T+1 (%) *</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={formData.distributor_mdr_t1}
                        onChange={(e) => setFormData({ ...formData, distributor_mdr_t1: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Distributor MDR T+0 (%) *</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={formData.distributor_mdr_t0}
                        onChange={(e) => setFormData({ ...formData, distributor_mdr_t0: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        required
                      />
                    </div>
                  </div>
                  {formData.retailer_mdr_t1 && formData.distributor_mdr_t1 && parseFloat(formData.retailer_mdr_t1) < parseFloat(formData.distributor_mdr_t1) && (
                    <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                      <AlertCircle className="w-4 h-4 inline mr-1" />
                      Retailer MDR T+1 must be &gt;= Distributor MDR T+1
                    </div>
                  )}
                  {formData.retailer_mdr_t0 && formData.distributor_mdr_t0 && parseFloat(formData.retailer_mdr_t0) < parseFloat(formData.distributor_mdr_t0) && (
                    <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                      <AlertCircle className="w-4 h-4 inline mr-1" />
                      Retailer MDR T+0 must be &gt;= Distributor MDR T+0
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1">Status</label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as 'active' | 'inactive' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-2 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg hover:shadow-lg disabled:opacity-50"
                  >
                    {loading ? 'Saving...' : editingScheme ? 'Update' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Scheme Management Tab
function SchemeManagementTab({ user, retailers, onRefresh }: { user: any, retailers: any[], onRefresh: () => void }) {
  const { showToast } = useToast()
  const [schemes, setSchemes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [expandedSchemeId, setExpandedSchemeId] = useState<string | null>(null)
  const [expandingSchemeId, setExpandingSchemeId] = useState<string | null>(null)
  const [editingScheme, setEditingScheme] = useState<any>(null)
  const [showMappingModal, setShowMappingModal] = useState(false)
  const [mappingSchemeId, setMappingSchemeId] = useState<string>('')
  const [mappingInProgress, setMappingInProgress] = useState<string | null>(null)
  const [unmappingId, setUnmappingId] = useState<string | null>(null)
  const [savingScheme, setSavingScheme] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [deletingConfigId, setDeletingConfigId] = useState<string | null>(null)
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [configSchemeId, setConfigSchemeId] = useState<string>('')
  const [configType, setConfigType] = useState<'bbps' | 'payout' | 'mdr' | 'aeps' | 'aeps_settlement' | 'shadval_settlement' | null>(null)

  const [schemeForm, setSchemeForm] = useState({
    name: '',
    description: '',
    scheme_type: 'custom' as 'custom',
    service_scope: 'all' as string,
    priority: 100,
  })

  const [bbpsForm, setBbpsForm] = useState({
    bbps_type: 'bbps_1' as 'bbps_1' | 'bbps_2',
    category: '',
    min_amount: 0,
    max_amount: 100000,
    retailer_charge: 0,
    retailer_charge_type: 'flat' as 'flat' | 'percentage',
    retailer_commission: 0,
    retailer_commission_type: 'flat' as 'flat' | 'percentage',
    distributor_commission: 0,
    distributor_commission_type: 'flat' as 'flat' | 'percentage',
    md_commission: 0,
    md_commission_type: 'flat' as 'flat' | 'percentage',
  })

  const [payoutForm, setPayoutForm] = useState({
    transfer_mode: 'IMPS' as 'IMPS' | 'NEFT',
    min_amount: 0,
    max_amount: 100000,
    retailer_charge: 0,
    retailer_charge_type: 'flat' as 'flat' | 'percentage',
    retailer_commission: 0,
    retailer_commission_type: 'flat' as 'flat' | 'percentage',
    distributor_commission: 0,
    distributor_commission_type: 'flat' as 'flat' | 'percentage',
    md_commission: 0,
    md_commission_type: 'flat' as 'flat' | 'percentage',
  })

  const [mdrForm, setMdrForm] = useState({
    mode: 'CARD' as 'CARD' | 'UPI',
    card_type: '' as string,
    brand_type: '',
    card_classification: '',
    retailer_mdr_t1: 0,
    retailer_mdr_t0: 0,
    distributor_mdr_t1: 0,
    distributor_mdr_t0: 0,
    md_mdr_t1: 0,
    md_mdr_t0: 0,
    partner_mdr: 0,
  })

  const [aepsForm, setAepsForm] = useState({
    transaction_type: 'cash_withdrawal' as string,
    min_amount: 0,
    max_amount: 100000,
    base_commission: 0,
    base_commission_type: 'percentage' as 'flat' | 'percentage',
    company_earning: 0,
    company_earning_type: 'flat' as 'flat' | 'percentage',
    md_commission: 0,
    md_commission_type: 'flat' as 'flat' | 'percentage',
    distributor_commission: 0,
    distributor_commission_type: 'flat' as 'flat' | 'percentage',
    retailer_commission: 0,
    retailer_commission_type: 'flat' as 'flat' | 'percentage',
    tds_percentage: 5,
  })

  const [aepsSettleForm, setAepsSettleForm] = useState({
    min_amount: 0,
    max_amount: 100000,
    retailer_charge: 0,
    retailer_charge_type: 'flat' as 'flat' | 'percentage',
    distributor_commission: 0,
    distributor_commission_type: 'flat' as 'flat' | 'percentage',
    md_commission: 0,
    md_commission_type: 'flat' as 'flat' | 'percentage',
    company_charge: 0,
    company_charge_type: 'flat' as 'flat' | 'percentage',
  })

  const [shadvalSettleForm, setShadvalSettleForm] = useState({
    transfer_mode: 'IMPS' as 'IMPS' | 'NEFT' | 'RTGS',
    min_amount: 0,
    max_amount: 100000,
    retailer_charge: 0,
    retailer_charge_type: 'flat' as 'flat' | 'percentage',
    distributor_commission: 0,
    distributor_commission_type: 'flat' as 'flat' | 'percentage',
    md_commission: 0,
    md_commission_type: 'flat' as 'flat' | 'percentage',
    company_charge: 0,
    company_charge_type: 'flat' as 'flat' | 'percentage',
  })

  const aepsResolve = (value: number, type: string, amount: number) =>
    type === 'percentage' ? Math.round((amount * value) / 100 * 100) / 100 : value

  const aepsPreview = () => {
    const amt = (aepsForm.max_amount && aepsForm.max_amount < 100000)
      ? aepsForm.max_amount
      : (aepsForm.min_amount > 0 ? aepsForm.min_amount : 1000)
    const base = aepsResolve(aepsForm.base_commission, aepsForm.base_commission_type, amt)
    const company = aepsResolve(aepsForm.company_earning, aepsForm.company_earning_type, amt)
    const md = aepsResolve(aepsForm.md_commission, aepsForm.md_commission_type, amt)
    const dt = aepsResolve(aepsForm.distributor_commission, aepsForm.distributor_commission_type, amt)
    const rt = aepsResolve(aepsForm.retailer_commission, aepsForm.retailer_commission_type, amt)
    const distributed = Math.round((company + md + dt + rt) * 100) / 100
    return { amt, base, company, md, dt, rt, distributed, valid: distributed <= base + 0.01 }
  }

  const fetchSchemes = useCallback(async () => {
    if (!user?.partner_id) return
    setLoading(true)
    try {
      // 1. Fetch schemes created by this distributor
      const { data: ownSchemes, error: ownErr } = await supabase
        .from('schemes')
        .select('*')
        .eq('created_by_id', user.partner_id)
        .eq('created_by_role', 'distributor')
        .order('created_at', { ascending: false })
      if (ownErr) throw ownErr

      // 2. Fetch schemes assigned to this distributor (by MD or admin)
      const { data: assignedMappings } = await supabase
        .from('scheme_mappings')
        .select('scheme_id')
        .eq('entity_id', user.partner_id)
        .eq('entity_role', 'distributor')
        .eq('status', 'active')

      const ownIds = new Set((ownSchemes || []).map(s => s.id))
      const assignedIds = (assignedMappings || [])
        .map(m => m.scheme_id)
        .filter(id => !ownIds.has(id))

      let assignedSchemes: any[] = []
      if (assignedIds.length > 0) {
        const { data } = await supabase
          .from('schemes')
          .select('*')
          .in('id', assignedIds)
          .eq('status', 'active')
        assignedSchemes = (data || []).map(s => ({ ...s, _assigned: true }))
      }

      let filtered = [...(ownSchemes || []), ...assignedSchemes]
      if (searchQuery) {
        filtered = filtered.filter(s => 
          s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (s.description && s.description.toLowerCase().includes(searchQuery.toLowerCase()))
        )
      }
      
      // Fetch mapping counts
      const schemeIds = filtered.map(s => s.id)
      if (schemeIds.length > 0) {
        const { data: mappings } = await supabase
          .from('scheme_mappings')
          .select('scheme_id')
          .in('scheme_id', schemeIds)
          .eq('status', 'active')
        
        const mappingCounts: Record<string, number> = {}
        mappings?.forEach(m => {
          mappingCounts[m.scheme_id] = (mappingCounts[m.scheme_id] || 0) + 1
        })
        
        filtered = filtered.map(s => ({
          ...s,
          mapping_count: mappingCounts[s.id] || 0,
        }))
      }
      
      setSchemes(filtered)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [user?.partner_id, searchQuery])

  useEffect(() => {
    if (user?.partner_id) {
      fetchSchemes()
    }
  }, [user?.partner_id, fetchSchemes])

  const toggleExpand = async (schemeId: string) => {
    if (expandedSchemeId === schemeId) {
      setExpandedSchemeId(null)
      return
    }
    
    setExpandingSchemeId(schemeId)
    try {
    const [bbps, payout, mdr, aepsComm, aepsSettle, shadvalSettle, mappings] = await Promise.all([
      supabase.from('scheme_bbps_commissions').select('*').eq('scheme_id', schemeId).eq('status', 'active').order('min_amount'),
      supabase.from('scheme_payout_charges').select('*').eq('scheme_id', schemeId).eq('status', 'active').order('transfer_mode'),
      supabase.from('scheme_mdr_rates').select('*').eq('scheme_id', schemeId).eq('status', 'active').order('mode'),
      supabase.from('scheme_aeps_commissions').select('*').eq('scheme_id', schemeId).eq('status', 'active').order('transaction_type,min_amount'),
      supabase.from('scheme_aeps_settlement_charges').select('*').eq('scheme_id', schemeId).eq('status', 'active').order('min_amount'),
      supabase.from('scheme_shadval_settlement_charges').select('*').eq('scheme_id', schemeId).eq('status', 'active').order('transfer_mode'),
      supabase.from('scheme_mappings').select('*').eq('scheme_id', schemeId).eq('status', 'active'),
    ])

    let enrichedMappings = mappings.data || []
    if (enrichedMappings.length > 0) {
      const entityIds = enrichedMappings.map((m: any) => m.entity_id)
      const { data: retNames } = await supabase.from('retailers').select('partner_id, name, business_name').in('partner_id', entityIds)
      const nameMap: Record<string, string> = {}
      retNames?.forEach((r: any) => { nameMap[r.partner_id] = r.business_name || r.name })
      enrichedMappings = enrichedMappings.map((m: any) => ({ ...m, entity_name: nameMap[m.entity_id] || null }))
    }
    
    setSchemes(prev => prev.map(s => s.id === schemeId ? {
      ...s,
      bbps_commissions: bbps.data || [],
      payout_charges: payout.data || [],
      mdr_rates: mdr.data || [],
      aeps_commissions: aepsComm.data || [],
      aeps_settlement_charges: aepsSettle.data || [],
      shadval_settlement_charges: shadvalSettle.data || [],
      mappings: enrichedMappings,
    } : s))
    
    setExpandedSchemeId(schemeId)
    } finally {
      setExpandingSchemeId(null)
    }
  }

  const openCreateModal = () => {
    setSchemeForm({ name: '', description: '', scheme_type: 'custom', service_scope: 'all', priority: 100 })
    setEditingScheme(null)
    setShowCreateModal(true)
  }

  const handleSaveScheme = async () => {
    if (!user?.partner_id) return
    setSavingScheme(true)
    try {
      if (editingScheme) {
        const { error } = await supabase.from('schemes').update({
          name: schemeForm.name,
          description: schemeForm.description || null,
          service_scope: schemeForm.service_scope,
        }).eq('id', editingScheme.id)
        if (error) throw error
        setSuccess('Scheme updated successfully')
        showToast('Scheme updated successfully', 'success')
      } else {
        const { error } = await supabase.from('schemes').insert({
          name: schemeForm.name,
          description: schemeForm.description || null,
          scheme_type: 'custom',
          service_scope: schemeForm.service_scope,
          priority: 100,
          created_by_id: user.partner_id,
          created_by_role: 'distributor',
          status: 'active',
        })
        if (error) throw error
        setSuccess('Scheme created successfully')
        showToast('Scheme created successfully', 'success')
      }
      setShowCreateModal(false)
      fetchSchemes()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err: any) {
      setError(err.message)
      showToast(err.message || 'Failed to save scheme', 'error')
      setTimeout(() => setError(''), 3000)
    } finally {
      setSavingScheme(false)
    }
  }

  const openMappingModal = (schemeId: string) => {
    setMappingSchemeId(schemeId)
    setShowMappingModal(true)
  }

  const handleUnmapRetailer = async (schemeId: string, mappingId: string) => {
    if (!confirm('Remove this retailer from the scheme? They will no longer use this scheme for charges.')) return
    setUnmappingId(mappingId)
    try {
      const res = await apiFetch(`/api/schemes/mappings?id=${encodeURIComponent(mappingId)}`, { method: 'DELETE' })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to remove mapping')
      setSuccess('Retailer removed from scheme')
      showToast('Retailer removed from scheme', 'success')
      setSchemes(prev => prev.map(s => s.id === schemeId ? {
        ...s,
        mappings: (s.mappings || []).filter((m: any) => m.id !== mappingId),
        mapping_count: Math.max(0, (s.mapping_count || 0) - 1),
      } : s))
      setTimeout(() => setSuccess(''), 3000)
    } catch (err: any) {
      setError(err.message)
      showToast(err.message || 'Failed to remove retailer', 'error')
      setTimeout(() => setError(''), 3000)
    } finally {
      setUnmappingId(null)
    }
  }

  const openConfigModal = (schemeId: string, type: 'bbps' | 'payout' | 'mdr' | 'aeps' | 'aeps_settlement' | 'shadval_settlement') => {
    setConfigSchemeId(schemeId)
    setConfigType(type)
    // Reset forms
    setBbpsForm({ bbps_type: 'bbps_1', category: '', min_amount: 0, max_amount: 100000, retailer_charge: 0, retailer_charge_type: 'flat', retailer_commission: 0, retailer_commission_type: 'flat', distributor_commission: 0, distributor_commission_type: 'flat', md_commission: 0, md_commission_type: 'flat' })
    setPayoutForm({ transfer_mode: 'IMPS', min_amount: 0, max_amount: 100000, retailer_charge: 0, retailer_charge_type: 'flat', retailer_commission: 0, retailer_commission_type: 'flat', distributor_commission: 0, distributor_commission_type: 'flat', md_commission: 0, md_commission_type: 'flat' })
    setMdrForm({ mode: 'CARD', card_type: '', brand_type: '', card_classification: '', retailer_mdr_t1: 0, retailer_mdr_t0: 0, distributor_mdr_t1: 0, distributor_mdr_t0: 0, md_mdr_t1: 0, md_mdr_t0: 0, partner_mdr: 0 })
    setAepsForm({ transaction_type: 'cash_withdrawal', min_amount: 0, max_amount: 100000, base_commission: 0, base_commission_type: 'percentage', company_earning: 0, company_earning_type: 'flat', md_commission: 0, md_commission_type: 'flat', distributor_commission: 0, distributor_commission_type: 'flat', retailer_commission: 0, retailer_commission_type: 'flat', tds_percentage: 5 })
    setAepsSettleForm({ min_amount: 0, max_amount: 100000, retailer_charge: 0, retailer_charge_type: 'flat', distributor_commission: 0, distributor_commission_type: 'flat', md_commission: 0, md_commission_type: 'flat', company_charge: 0, company_charge_type: 'flat' })
    setShadvalSettleForm({ transfer_mode: 'IMPS', min_amount: 0, max_amount: 100000, retailer_charge: 0, retailer_charge_type: 'flat', distributor_commission: 0, distributor_commission_type: 'flat', md_commission: 0, md_commission_type: 'flat', company_charge: 0, company_charge_type: 'flat' })
    setShowConfigModal(true)
  }

  const handleSaveConfig = async () => {
    setSavingConfig(true)
    try {
      if (configType === 'aeps') {
        const preview = aepsPreview()
        if (!preview.valid) {
          setError(`Distribution (₹${preview.distributed}) exceeds partner pool (₹${preview.base}) at ₹${preview.amt}. Reduce role commissions.`)
          setSavingConfig(false)
          return
        }
      }

      let configData: any = {}
      if (configType === 'bbps') {
        configData = { ...bbpsForm, category: bbpsForm.category || null, company_charge: 0, company_charge_type: 'flat' }
      } else if (configType === 'payout') {
        configData = { ...payoutForm, company_charge: 0, company_charge_type: 'flat' }
      } else if (configType === 'mdr') {
        const configScheme = schemes.find(s => s.id === configSchemeId)
        const isPartnerPlan = configScheme?.is_partner_plan || false
        configData = { mode: mdrForm.mode, card_type: mdrForm.card_type || null, brand_type: mdrForm.brand_type || null, card_classification: mdrForm.card_classification || null }
        if (isPartnerPlan) {
          configData.partner_mdr = mdrForm.partner_mdr; configData.retailer_mdr_t1 = 0; configData.retailer_mdr_t0 = 0; configData.distributor_mdr_t1 = 0; configData.distributor_mdr_t0 = 0; configData.md_mdr_t1 = 0; configData.md_mdr_t0 = 0
        } else {
          configData.retailer_mdr_t1 = mdrForm.retailer_mdr_t1; configData.retailer_mdr_t0 = mdrForm.retailer_mdr_t0; configData.distributor_mdr_t1 = mdrForm.distributor_mdr_t1; configData.distributor_mdr_t0 = mdrForm.distributor_mdr_t0; configData.md_mdr_t1 = mdrForm.md_mdr_t1; configData.md_mdr_t0 = mdrForm.md_mdr_t0; configData.partner_mdr = null
        }
      } else if (configType === 'aeps') {
        configData = { ...aepsForm }
      } else if (configType === 'aeps_settlement') {
        configData = { ...aepsSettleForm }
      } else if (configType === 'shadval_settlement') {
        configData = { ...shadvalSettleForm }
      }

      const res = await fetch(`/api/schemes/${configSchemeId}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config_type: configType, ...configData }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to save configuration')

      setSuccess(`${configType?.toUpperCase()} configuration added successfully`)
      showToast(`${configType?.toUpperCase()} configuration added`, 'success')
      setShowConfigModal(false)
      if (expandedSchemeId === configSchemeId) {
        toggleExpand(configSchemeId)
      } else {
        fetchSchemes()
      }
      setTimeout(() => setSuccess(''), 3000)
    } catch (err: any) {
      setError(err.message)
      showToast(err.message || 'Failed to save configuration', 'error')
      setTimeout(() => setError(''), 3000)
    } finally {
      setSavingConfig(false)
    }
  }

  const handleDeleteConfig = async (table: string, id: string) => {
    if (!confirm('Delete this configuration?')) return
    if (!expandedSchemeId) return
    setDeletingConfigId(id)
    try {
      const configTypeMap: Record<string, string> = {
        scheme_bbps_commissions: 'bbps', scheme_payout_charges: 'payout', scheme_mdr_rates: 'mdr',
        scheme_aeps_commissions: 'aeps', scheme_aeps_settlement_charges: 'aeps_settlement', scheme_shadval_settlement_charges: 'shadval_settlement',
      }
      const ct = configTypeMap[table] || table
      const res = await fetch(`/api/schemes/${expandedSchemeId}/config?config_type=${ct}&config_id=${id}`, { method: 'DELETE' })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Failed to delete configuration')
      setSuccess('Configuration deleted')
      showToast('Configuration deleted', 'success')
      if (expandedSchemeId) toggleExpand(expandedSchemeId)
      setTimeout(() => setSuccess(''), 3000)
    } catch (err: any) {
      setError(err.message)
      showToast(err.message || 'Failed to delete configuration', 'error')
      setTimeout(() => setError(''), 3000)
    } finally {
      setDeletingConfigId(null)
    }
  }

  const getAvailableBrands = (mode: string, cardType: string): string[] => {
    if (mode === 'CARD') {
      if (cardType === 'CREDIT') {
        return ['Amex', 'Diners Club', 'MasterCard', 'RUPAY', 'VISA', 'Business', 'Corporate Card', 'International']
      } else if (cardType === 'DEBIT') {
        return ['MasterCard', 'RUPAY', 'VISA']
      } else if (cardType === 'PREPAID') {
        return ['MasterCard', 'VISA']
      }
      return []
    } else if (mode === 'UPI') {
      const effectiveCardType = cardType || 'UPI'
      if (effectiveCardType === 'UPI') {
        return ['UPI']
      } else if (effectiveCardType === 'CREDIT') {
        return ['RUPAY']
      }
      return []
    }
    return []
  }

  const handleMapScheme = async (retailerId: string) => {
    setMappingInProgress(retailerId)
    try {
      const response = await apiFetch('/api/schemes/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheme_id: mappingSchemeId,
          entity_id: retailerId,
          entity_role: 'retailer',
          service_type: 'all',
          priority: 100,
        }),
      })
      const result = await response.json()
      if (!response.ok || result.error) {
        throw new Error(result.error || 'Failed to map scheme')
      }
      setSuccess('Scheme mapped successfully')
      showToast('Scheme mapped successfully', 'success')
      setShowMappingModal(false)
      fetchSchemes()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err: any) {
      setError(err.message)
      showToast(err.message || 'Failed to map scheme', 'error')
      setTimeout(() => setError(''), 3000)
    } finally {
      setMappingInProgress(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Layers className="w-6 h-6 text-purple-600" />
            Scheme Management
          </h2>
          <p className="text-sm text-gray-500 mt-1">Create and assign custom schemes to your retailers</p>
        </div>
        <button
          onClick={openCreateModal}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-lg hover:opacity-90 transition font-medium text-sm whitespace-nowrap"
        >
          <Plus className="w-4 h-4" /> Create Scheme
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2 text-red-700 dark:text-red-400 text-sm">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center gap-2 text-green-700 dark:text-green-400 text-sm">
          <CheckCircle className="w-4 h-4" /> {success}
        </div>
      )}

      <div className="relative flex-1 min-w-[200px] max-w-md">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search schemes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-9 pr-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-sm"
        />
      </div>

      {loading ? (
        <div className="text-center py-12">Loading schemes...</div>
      ) : schemes.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <Layers className="w-12 h-12 mx-auto mb-4 text-gray-400" />
          <p>No schemes created yet</p>
          <button onClick={openCreateModal} className="mt-4 text-purple-600 hover:underline">Create your first scheme</button>
        </div>
      ) : (
        <div className="space-y-4">
          {schemes.map((scheme) => (
            <div key={scheme.id} className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm">
              <div className="p-4 flex items-center justify-between cursor-pointer" onClick={() => toggleExpand(scheme.id)}>
                <div className="flex items-center gap-3 flex-1">
                  <Settings className="w-5 h-5 text-purple-600" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900 dark:text-white">{scheme.name}</h3>
                      {scheme.is_partner_plan && (
                        <span className="px-2 py-0.5 text-[10px] font-semibold uppercase rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
                          Partner Plan
                        </span>
                      )}
                      {scheme._assigned && (
                        <span className="px-2 py-0.5 text-[10px] font-semibold uppercase rounded-full bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                          Assigned by MD
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {scheme.scheme_type} • {scheme.service_scope} • {scheme.mapping_count || 0} mappings
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!scheme._assigned && (<>
                  <button onClick={(e) => { e.stopPropagation(); openConfigModal(scheme.id, 'bbps') }}
                    className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-600" title="Add BBPS Commission">
                    <CreditCard className="w-4 h-4" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); openConfigModal(scheme.id, 'payout') }}
                    className="p-1.5 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 text-green-600" title="Add Settlement-1 Charge">
                    <Banknote className="w-4 h-4" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); openConfigModal(scheme.id, 'mdr') }}
                    className="p-1.5 rounded-lg hover:bg-orange-50 dark:hover:bg-orange-900/20 text-orange-600" title="Add MDR Rate">
                    <TrendingUp className="w-4 h-4" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); openConfigModal(scheme.id, 'aeps') }}
                    className="p-1.5 rounded-lg hover:bg-teal-50 dark:hover:bg-teal-900/20 text-teal-600" title="Add AEPS Commission">
                    <Banknote className="w-4 h-4" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); openConfigModal(scheme.id, 'aeps_settlement') }}
                    className="p-1.5 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/20 text-purple-600" title="Add AEPS Settlement Charge">
                    <DollarSign className="w-4 h-4" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); openConfigModal(scheme.id, 'shadval_settlement') }}
                    className="p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/20 text-rose-600" title="Add Settlement-2 Charge">
                    <Banknote className="w-4 h-4" />
                  </button>
                  </>)}
                  <button onClick={(e) => { e.stopPropagation(); openMappingModal(scheme.id) }}
                    className="p-1.5 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/20 text-purple-600" title="Map to Retailer">
                    <Link2 className="w-4 h-4" />
                  </button>
                  {expandingSchemeId === scheme.id ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" /> : expandedSchemeId === scheme.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </div>
              </div>

              {expandedSchemeId === scheme.id && (() => {
                const isAssigned = !!scheme._assigned
                return (
                <div className="border-t border-gray-200 dark:border-gray-800 p-4 space-y-4 bg-gray-50 dark:bg-gray-800/30">
                  {isAssigned && (
                    <p className="text-xs text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 px-3 py-2 rounded-lg">
                      This scheme was assigned to you by your Master Distributor. You can view and assign it to your retailers but cannot modify its configuration.
                    </p>
                  )}
                  {scheme.description && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 italic">{scheme.description}</p>
                  )}

                  {/* BBPS Commissions */}
                  <div>
                    <h4 className="font-semibold text-sm text-blue-700 dark:text-blue-400 mb-2 flex items-center gap-1">
                      <CreditCard className="w-4 h-4" /> BBPS Commissions ({scheme.bbps_commissions?.length || 0})
                    </h4>
                    {scheme.bbps_commissions && scheme.bbps_commissions.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-blue-50 dark:bg-blue-900/20">
                              <th className="px-2 py-1.5 text-left">Type</th>
                              <th className="px-2 py-1.5 text-left">Category</th>
                              <th className="px-2 py-1.5 text-left">Slab</th>
                              <th className="px-2 py-1.5 text-right">Retailer Charge</th>
                              <th className="px-2 py-1.5 text-right">Retailer Comm</th>
                              <th className="px-2 py-1.5 text-right">Dist Comm</th>
                              <th className="px-2 py-1.5 text-right">MD Comm</th>
                              <th className="px-2 py-1.5"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {scheme.bbps_commissions.map((c: any) => (
                              <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700">
                                <td className="px-2 py-1.5"><span className={`px-1.5 py-0.5 rounded text-xs font-medium ${c.bbps_type === 'bbps_2' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}`}>{c.bbps_type === 'bbps_2' ? 'BBPS 2' : 'BBPS 1'}</span></td>
                                <td className="px-2 py-1.5">{c.category || 'All'}</td>
                                <td className="px-2 py-1.5">{`₹${c.min_amount} - ₹${c.max_amount >= 999999 ? '∞' : c.max_amount}`}</td>
                                <td className="px-2 py-1.5 text-right">{c.retailer_charge}{c.retailer_charge_type === 'percentage' ? '%' : '₹'}</td>
                                <td className="px-2 py-1.5 text-right">{c.retailer_commission}{c.retailer_commission_type === 'percentage' ? '%' : '₹'}</td>
                                <td className="px-2 py-1.5 text-right">{c.distributor_commission}{c.distributor_commission_type === 'percentage' ? '%' : '₹'}</td>
                                <td className="px-2 py-1.5 text-right">{c.md_commission}{c.md_commission_type === 'percentage' ? '%' : '₹'}</td>
                                {!isAssigned && <td className="px-2 py-1.5 text-right">
                                  <button onClick={() => handleDeleteConfig('scheme_bbps_commissions', c.id)} disabled={deletingConfigId === c.id} className="text-red-400 hover:text-red-600 disabled:opacity-50">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </td>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 italic">No BBPS commissions configured</p>
                    )}
                  </div>

                  {/* Payout Charges */}
                  <div>
                    <h4 className="font-semibold text-sm text-green-700 dark:text-green-400 mb-2 flex items-center gap-1">
                      <Banknote className="w-4 h-4" /> Settlement-1 Charges ({scheme.payout_charges?.length || 0})
                    </h4>
                    {scheme.payout_charges && scheme.payout_charges.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-green-50 dark:bg-green-900/20">
                              <th className="px-2 py-1.5 text-left">Mode</th>
                              <th className="px-2 py-1.5 text-left">Slab</th>
                              <th className="px-2 py-1.5 text-right">Retailer Charge</th>
                              <th className="px-2 py-1.5 text-right">Retailer Comm</th>
                              <th className="px-2 py-1.5 text-right">Dist Comm</th>
                              <th className="px-2 py-1.5 text-right">MD Comm</th>
                              <th className="px-2 py-1.5"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {scheme.payout_charges.map((c: any) => (
                              <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700">
                                <td className="px-2 py-1.5">{c.transfer_mode}</td>
                                <td className="px-2 py-1.5">{`₹${c.min_amount} - ₹${c.max_amount >= 999999 ? '∞' : c.max_amount}`}</td>
                                <td className="px-2 py-1.5 text-right">{c.retailer_charge}{c.retailer_charge_type === 'percentage' ? '%' : '₹'}</td>
                                <td className="px-2 py-1.5 text-right">{c.retailer_commission}{c.retailer_commission_type === 'percentage' ? '%' : '₹'}</td>
                                <td className="px-2 py-1.5 text-right">{c.distributor_commission}{c.distributor_commission_type === 'percentage' ? '%' : '₹'}</td>
                                <td className="px-2 py-1.5 text-right">{c.md_commission}{c.md_commission_type === 'percentage' ? '%' : '₹'}</td>
                                {!isAssigned && <td className="px-2 py-1.5 text-right">
                                  <button onClick={() => handleDeleteConfig('scheme_payout_charges', c.id)} disabled={deletingConfigId === c.id} className="text-red-400 hover:text-red-600 disabled:opacity-50">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </td>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 italic">No Settlement-1 charges configured</p>
                    )}
                  </div>

                  {/* MDR Rates */}
                  <div>
                    <h4 className="font-semibold text-sm text-orange-700 dark:text-orange-400 mb-2 flex items-center gap-1">
                      <TrendingUp className="w-4 h-4" /> MDR Rates ({scheme.mdr_rates?.length || 0})
                    </h4>
                    {scheme.mdr_rates && scheme.mdr_rates.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-orange-50 dark:bg-orange-900/20">
                              <th className="px-2 py-1.5 text-left">Mode</th>
                              <th className="px-2 py-1.5 text-left">Card Type</th>
                              <th className="px-2 py-1.5 text-left">Brand</th>
                              {scheme.is_partner_plan ? (
                                <th className="px-2 py-1.5 text-right">MDR %</th>
                              ) : (
                                <>
                                  <th className="px-2 py-1.5 text-right">Ret T+1</th>
                                  <th className="px-2 py-1.5 text-right">Ret T+0</th>
                                  <th className="px-2 py-1.5 text-right">Dist T+1</th>
                                  <th className="px-2 py-1.5 text-right">Dist T+0</th>
                                  <th className="px-2 py-1.5 text-right">MD T+1</th>
                                  <th className="px-2 py-1.5 text-right">MD T+0</th>
                                </>
                              )}
                              <th className="px-2 py-1.5"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {scheme.mdr_rates.map((c: any) => (
                              <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700">
                                <td className="px-2 py-1.5">{c.mode}</td>
                                <td className="px-2 py-1.5">{c.card_type || '-'}</td>
                                <td className="px-2 py-1.5">{c.brand_type || '-'}</td>
                                {scheme.is_partner_plan ? (
                                  <td className="px-2 py-1.5 text-right">{c.partner_mdr ?? 0}%</td>
                                ) : (
                                  <>
                                    <td className="px-2 py-1.5 text-right">{c.retailer_mdr_t1}%</td>
                                    <td className="px-2 py-1.5 text-right">{c.retailer_mdr_t0}%</td>
                                    <td className="px-2 py-1.5 text-right">{c.distributor_mdr_t1}%</td>
                                    <td className="px-2 py-1.5 text-right">{c.distributor_mdr_t0}%</td>
                                    <td className="px-2 py-1.5 text-right">{c.md_mdr_t1}%</td>
                                    <td className="px-2 py-1.5 text-right">{c.md_mdr_t0}%</td>
                                  </>
                                )}
                                {!isAssigned && <td className="px-2 py-1.5 text-right">
                                  <button onClick={() => handleDeleteConfig('scheme_mdr_rates', c.id)} disabled={deletingConfigId === c.id} className="text-red-400 hover:text-red-600 disabled:opacity-50">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </td>}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 italic">No MDR rates configured</p>
                    )}
                  </div>

                  {/* AEPS Commissions */}
                  <div>
                    <h4 className="font-semibold text-sm text-teal-700 dark:text-teal-400 mb-2 flex items-center gap-1">
                      <Banknote className="w-4 h-4" /> AEPS Commissions ({scheme.aeps_commissions?.length || 0})
                    </h4>
                    {scheme.aeps_commissions && scheme.aeps_commissions.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-teal-50 dark:bg-teal-900/20">
                              <th className="px-2 py-1.5 text-left">Txn Type</th>
                              <th className="px-2 py-1.5 text-left">Range</th>
                              <th className="px-2 py-1.5 text-right">Pool</th>
                              <th className="px-2 py-1.5 text-right">Company</th>
                              <th className="px-2 py-1.5 text-right">MD</th>
                              <th className="px-2 py-1.5 text-right">DT</th>
                              <th className="px-2 py-1.5 text-right">RT</th>
                              <th className="px-2 py-1.5 text-right">TDS</th>
                              <th className="px-2 py-1.5"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {scheme.aeps_commissions.map((c: any) => {
                              const fmt = (v: number, t: string) => t === 'percentage' ? `${v}%` : `₹${v}`
                              return (
                                <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700">
                                  <td className="px-2 py-1.5">{c.transaction_type}</td>
                                  <td className="px-2 py-1.5">₹{c.min_amount?.toLocaleString('en-IN')}-{c.max_amount >= 100000 ? '∞' : c.max_amount?.toLocaleString('en-IN')}</td>
                                  <td className="px-2 py-1.5 text-right">{fmt(c.base_commission, c.base_commission_type)}</td>
                                  <td className="px-2 py-1.5 text-right">{fmt(c.company_earning, c.company_earning_type)}</td>
                                  <td className="px-2 py-1.5 text-right">{fmt(c.md_commission, c.md_commission_type)}</td>
                                  <td className="px-2 py-1.5 text-right">{fmt(c.distributor_commission, c.distributor_commission_type)}</td>
                                  <td className="px-2 py-1.5 text-right">{fmt(c.retailer_commission, c.retailer_commission_type)}</td>
                                  <td className="px-2 py-1.5 text-right">{c.tds_percentage}%</td>
                                  <td className="px-2 py-1.5 text-right">
                                    {!isAssigned && <button onClick={() => handleDeleteConfig('scheme_aeps_commissions', c.id)} disabled={deletingConfigId === c.id} className="text-red-400 hover:text-red-600 disabled:opacity-50">
                                      <Trash2 className="w-3 h-3" />
                                    </button>}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 italic">No AEPS commissions configured</p>
                    )}
                  </div>

                  {/* AEPS Settlement Charges */}
                  <div>
                    <h4 className="font-semibold text-sm text-purple-700 dark:text-purple-400 mb-2 flex items-center gap-1">
                      <DollarSign className="w-4 h-4" /> AEPS Settlement Charges ({scheme.aeps_settlement_charges?.length || 0})
                    </h4>
                    {scheme.aeps_settlement_charges && scheme.aeps_settlement_charges.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-purple-50 dark:bg-purple-900/20">
                              <th className="px-2 py-1.5 text-left">Amount Range</th>
                              <th className="px-2 py-1.5 text-right">Retailer Charge</th>
                              <th className="px-2 py-1.5 text-right">DT Margin</th>
                              <th className="px-2 py-1.5 text-right">MD Margin</th>
                              <th className="px-2 py-1.5 text-right">Company</th>
                              <th className="px-2 py-1.5"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {scheme.aeps_settlement_charges.map((c: any) => {
                              const fmt = (v: number, t: string) => t === 'percentage' ? `${v}%` : `₹${v}`
                              return (
                                <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700">
                                  <td className="px-2 py-1.5">₹{c.min_amount?.toLocaleString('en-IN')} – {c.max_amount >= 100000 ? '∞' : `₹${c.max_amount?.toLocaleString('en-IN')}`}</td>
                                  <td className="px-2 py-1.5 text-right font-medium">{fmt(c.retailer_charge, c.retailer_charge_type)}</td>
                                  <td className="px-2 py-1.5 text-right">{fmt(c.distributor_commission, c.distributor_commission_type)}</td>
                                  <td className="px-2 py-1.5 text-right">{fmt(c.md_commission, c.md_commission_type)}</td>
                                  <td className="px-2 py-1.5 text-right">{fmt(c.company_charge, c.company_charge_type)}</td>
                                  <td className="px-2 py-1.5 text-right">
                                    {!isAssigned && <button onClick={() => handleDeleteConfig('scheme_aeps_settlement_charges', c.id)} disabled={deletingConfigId === c.id} className="text-red-400 hover:text-red-600 disabled:opacity-50">
                                      <Trash2 className="w-3 h-3" />
                                    </button>}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 italic">No AEPS settlement charges configured</p>
                    )}
                  </div>
                  
                  {/* Settlement-2 Charges */}
                  <div>
                    <h4 className="font-semibold text-sm text-rose-700 dark:text-rose-400 mb-2 flex items-center gap-1">
                      <Banknote className="w-4 h-4" /> Settlement-2 Charges ({scheme.shadval_settlement_charges?.length || 0})
                    </h4>
                    {scheme.shadval_settlement_charges && scheme.shadval_settlement_charges.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-rose-50 dark:bg-rose-900/20">
                              <th className="px-2 py-1.5 text-left">Mode</th>
                              <th className="px-2 py-1.5 text-left">Slab</th>
                              <th className="px-2 py-1.5 text-right">Retailer Charge</th>
                              <th className="px-2 py-1.5 text-right">Dist Comm</th>
                              <th className="px-2 py-1.5 text-right">MD Comm</th>
                              <th className="px-2 py-1.5 text-right">Company</th>
                              <th className="px-2 py-1.5"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {scheme.shadval_settlement_charges.map((c: any) => {
                              const fmt = (v: number, t: string) => t === 'percentage' ? `${v}%` : `₹${v}`
                              return (
                                <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700">
                                  <td className="px-2 py-1.5 font-medium">{c.transfer_mode}</td>
                                  <td className="px-2 py-1.5">₹{c.min_amount?.toLocaleString('en-IN')} - {c.max_amount >= 999999 ? '∞' : `₹${c.max_amount?.toLocaleString('en-IN')}`}</td>
                                  <td className="px-2 py-1.5 text-right font-medium">{fmt(c.retailer_charge, c.retailer_charge_type)}</td>
                                  <td className="px-2 py-1.5 text-right">{fmt(c.distributor_commission, c.distributor_commission_type)}</td>
                                  <td className="px-2 py-1.5 text-right">{fmt(c.md_commission, c.md_commission_type)}</td>
                                  <td className="px-2 py-1.5 text-right">{fmt(c.company_charge, c.company_charge_type)}</td>
                                  <td className="px-2 py-1.5 text-right">
                                    {!isAssigned && <button onClick={() => handleDeleteConfig('scheme_shadval_settlement_charges', c.id)} disabled={deletingConfigId === c.id} className="text-red-400 hover:text-red-600 disabled:opacity-50">
                                      {deletingConfigId === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                                    </button>}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 italic">No Settlement-2 charges configured</p>
                    )}
                  </div>
                  
                  {/* Mapped Retailers */}
                  <div>
                    <h4 className="font-semibold text-sm mb-2">Mapped Retailers ({scheme.mappings?.length || 0})</h4>
                    {scheme.mappings && scheme.mappings.length > 0 ? (
                      <div className="space-y-1.5">
                        {scheme.mappings.map((m: any) => (
                          <div key={m.id} className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-xs">
                            <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-[10px] font-semibold uppercase">{m.entity_role}</span>
                            {m.entity_name && (
                              <span className="font-semibold text-gray-900 dark:text-white">{m.entity_name}</span>
                            )}
                            <span className="text-gray-500 dark:text-gray-400">({m.entity_id})</span>
                            <button
                              type="button"
                              onClick={() => handleUnmapRetailer(scheme.id, m.id)}
                              disabled={unmappingId === m.id}
                              className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 disabled:opacity-50"
                              title="Remove scheme from this retailer"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>{unmappingId === m.id ? 'Removing...' : 'Remove'}</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 italic">No retailers mapped yet</p>
                    )}
                  </div>
                </div>
                )
              })()}
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold mb-4">{editingScheme ? 'Edit Scheme' : 'Create Scheme'}</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Scheme Name</label>
                <input type="text" value={schemeForm.name} onChange={(e) => setSchemeForm({ ...schemeForm, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" placeholder="e.g., Premium Retailer Plan" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <textarea value={schemeForm.description} onChange={(e) => setSchemeForm({ ...schemeForm, description: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" rows={3} placeholder="Optional description" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Service Scope</label>
                <select value={schemeForm.service_scope} onChange={(e) => setSchemeForm({ ...schemeForm, service_scope: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                  <option value="all">All Services</option>
                  <option value="bbps">BBPS Only</option>
                  <option value="payout">Settlement-1 Only</option>
                  <option value="mdr">MDR Only</option>
                  <option value="aeps">AEPS Only</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={handleSaveScheme} disabled={savingScheme} className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
                {savingScheme ? 'Saving...' : editingScheme ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mapping Modal */}
      {showMappingModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold mb-4">Map Scheme to Retailer</h2>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {retailers.length === 0 ? (
                <p className="text-sm text-gray-500">No retailers available</p>
              ) : (
                retailers.map((ret) => (
                  <button
                    key={ret.partner_id}
                    onClick={() => handleMapScheme(ret.partner_id)}
                    disabled={mappingInProgress !== null}
                    className="w-full text-left p-3 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition disabled:opacity-50"
                  >
                    <div className="font-medium">{ret.name}</div>
                    <div className="text-xs text-gray-500">{ret.partner_id}</div>
                    {mappingInProgress === ret.partner_id && <div className="text-xs text-purple-600 mt-1">Mapping...</div>}
                  </button>
                ))
              )}
            </div>
            <button onClick={() => setShowMappingModal(false)} className="mt-4 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg w-full">Close</button>
          </div>
        </div>
      )}

      {/* Configuration Modal (BBPS / Settlement / MDR) */}
      {showConfigModal && configType && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col my-4">
            <div className="px-6 pt-5 pb-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
              <h2 className="text-lg font-bold flex items-center gap-2">
                {configType === 'bbps' && <><CreditCard className="w-5 h-5 text-blue-600" /> Add BBPS Commission</>}
                {configType === 'payout' && <><Banknote className="w-5 h-5 text-green-600" /> Add Settlement-1 Charge</>}
                {configType === 'mdr' && <><TrendingUp className="w-5 h-5 text-orange-600" /> Add MDR Rate</>}
                {configType === 'aeps' && <><Banknote className="w-5 h-5 text-teal-600" /> Add AEPS Commission</>}
                {configType === 'aeps_settlement' && <><DollarSign className="w-5 h-5 text-purple-600" /> Add AEPS Settlement Charge</>}
                {configType === 'shadval_settlement' && <><Banknote className="w-5 h-5 text-rose-600" /> Add Settlement-2 Charge</>}
              </h2>
            </div>

            <div className="overflow-y-auto flex-1 min-h-0 px-6 py-4">
            {/* BBPS Form */}
            {configType === 'bbps' && (
              <div className="space-y-2">
                <div>
                  <label className="block text-sm font-medium mb-1">BBPS Type</label>
                  <select value={bbpsForm.bbps_type} onChange={(e) => setBbpsForm({ ...bbpsForm, bbps_type: e.target.value as 'bbps_1' | 'bbps_2' })}
                    className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                    <option value="bbps_1">BBPS 1</option>
                    <option value="bbps_2">BBPS 2</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Category (leave empty for all)</label>
                  <select value={bbpsForm.category} onChange={(e) => setBbpsForm({ ...bbpsForm, category: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                    <option value="">All Categories</option>
                    <option value="Electricity">Electricity</option>
                    <option value="Gas">Gas</option>
                    <option value="Water">Water</option>
                    <option value="Insurance">Insurance</option>
                    <option value="Credit Card">Credit Card</option>
                    <option value="Loan">Loan</option>
                    <option value="Broadband">Broadband</option>
                    <option value="DTH">DTH</option>
                    <option value="Mobile Postpaid">Mobile Postpaid</option>
                    <option value="Mobile Prepaid">Mobile Prepaid</option>
                    <option value="FASTag">FASTag</option>
                    <option value="Municipal Tax">Municipal Tax</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Min Amount (₹)</label>
                    <input type="number" value={bbpsForm.min_amount} onChange={(e) => setBbpsForm({ ...bbpsForm, min_amount: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Max Amount (₹)</label>
                    <input type="number" value={bbpsForm.max_amount} onChange={(e) => setBbpsForm({ ...bbpsForm, max_amount: parseFloat(e.target.value) || 100000 })}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { label: 'Retailer Charge', key: 'retailer_charge', typeKey: 'retailer_charge_type' },
                  { label: 'Retailer Commission', key: 'retailer_commission', typeKey: 'retailer_commission_type' },
                  { label: 'Distributor Commission', key: 'distributor_commission', typeKey: 'distributor_commission_type' },
                  { label: 'MD Commission', key: 'md_commission', typeKey: 'md_commission_type' },
                ].map(({ label, key, typeKey }) => (
                  <div key={key} className="grid grid-cols-3 gap-2 items-end">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium mb-1">{label}</label>
                      <input type="number" step="0.01" value={(bbpsForm as any)[key]}
                        onChange={(e) => setBbpsForm({ ...bbpsForm, [key]: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                    </div>
                    <div>
                      <select value={(bbpsForm as any)[typeKey]}
                        onChange={(e) => setBbpsForm({ ...bbpsForm, [typeKey]: e.target.value })}
                        className="w-full px-2 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                        <option value="flat">₹ Flat</option>
                        <option value="percentage">% Pct</option>
                      </select>
                    </div>
                  </div>
                ))}
                </div>
              </div>
            )}

            {/* Payout Form */}
            {configType === 'payout' && (
              <div className="space-y-2">
                <div>
                  <label className="block text-sm font-medium mb-1">Transfer Mode</label>
                  <select value={payoutForm.transfer_mode} onChange={(e) => setPayoutForm({ ...payoutForm, transfer_mode: e.target.value as any })}
                    className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                    <option value="IMPS">IMPS</option>
                    <option value="NEFT">NEFT</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Min Amount (₹)</label>
                    <input type="number" value={payoutForm.min_amount} onChange={(e) => setPayoutForm({ ...payoutForm, min_amount: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Max Amount (₹)</label>
                    <input type="number" value={payoutForm.max_amount} onChange={(e) => setPayoutForm({ ...payoutForm, max_amount: parseFloat(e.target.value) || 100000 })}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { label: 'Retailer Charge', key: 'retailer_charge', typeKey: 'retailer_charge_type' },
                  { label: 'Retailer Commission', key: 'retailer_commission', typeKey: 'retailer_commission_type' },
                  { label: 'Distributor Commission', key: 'distributor_commission', typeKey: 'distributor_commission_type' },
                  { label: 'MD Commission', key: 'md_commission', typeKey: 'md_commission_type' },
                ].map(({ label, key, typeKey }) => (
                  <div key={key} className="grid grid-cols-3 gap-2 items-end">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium mb-1">{label}</label>
                      <input type="number" step="0.01" value={(payoutForm as any)[key]}
                        onChange={(e) => setPayoutForm({ ...payoutForm, [key]: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                    </div>
                    <div>
                      <select value={(payoutForm as any)[typeKey]}
                        onChange={(e) => setPayoutForm({ ...payoutForm, [typeKey]: e.target.value })}
                        className="w-full px-2 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                        <option value="flat">₹ Flat</option>
                        <option value="percentage">% Pct</option>
                      </select>
                    </div>
                  </div>
                ))}
                </div>
              </div>
            )}

            {/* MDR Form */}
            {configType === 'mdr' && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Mode</label>
                    <select value={mdrForm.mode} onChange={(e) => {
                      const newMode = e.target.value as 'CARD' | 'UPI'
                      const defaultCardType = newMode === 'UPI' ? 'UPI' : ''
                      const availableBrands = getAvailableBrands(newMode, defaultCardType)
                      setMdrForm({ 
                        ...mdrForm, 
                        mode: newMode, 
                        card_type: defaultCardType,
                        brand_type: availableBrands.length > 0 && availableBrands.includes(mdrForm.brand_type) ? mdrForm.brand_type : '',
                        card_classification: ''
                      })
                    }}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                      <option value="CARD">CARD</option>
                      <option value="UPI">UPI</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Card Type</label>
                    <select value={mdrForm.card_type} onChange={(e) => {
                      const newCardType = e.target.value
                      const availableBrands = getAvailableBrands(mdrForm.mode, newCardType)
                      setMdrForm({ 
                        ...mdrForm, 
                        card_type: newCardType,
                        brand_type: availableBrands.length > 0 && availableBrands.includes(mdrForm.brand_type) ? mdrForm.brand_type : ''
                      })
                    }}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                      {mdrForm.mode === 'CARD' ? (
                        <>
                          <option value="">Any</option>
                          <option value="CREDIT">CREDIT</option>
                          <option value="DEBIT">DEBIT</option>
                          <option value="PREPAID">PREPAID</option>
                        </>
                      ) : (
                        <>
                          <option value="UPI">UPI</option>
                          <option value="CREDIT">CREDIT</option>
                        </>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Brand</label>
                    <select 
                      value={mdrForm.brand_type} 
                      onChange={(e) => setMdrForm({ ...mdrForm, brand_type: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700"
                      disabled={getAvailableBrands(mdrForm.mode, mdrForm.card_type).length === 0}
                    >
                      <option value="">Select Brand</option>
                      {getAvailableBrands(mdrForm.mode, mdrForm.card_type).map((brand) => (
                        <option key={brand} value={brand}>{brand}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Classification</label>
                    <select
                      value={mdrForm.card_classification}
                      onChange={(e) => setMdrForm({ ...mdrForm, card_classification: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700"
                      disabled={mdrForm.mode === 'UPI'}
                    >
                      <option value="">Any</option>
                      <option value="CLASSIC">CLASSIC</option>
                      <option value="GOLD">GOLD</option>
                      <option value="PLATINUM">PLATINUM</option>
                      <option value="TITANIUM">TITANIUM</option>
                      <option value="SIGNATURE">SIGNATURE</option>
                      <option value="INFINITE">INFINITE</option>
                      <option value="WORLD">WORLD</option>
                      <option value="BUSINESS">BUSINESS</option>
                      <option value="CORPORATE">CORPORATE</option>
                      <option value="PREMIUM">PREMIUM</option>
                      <option value="STANDARD">STANDARD</option>
                      <option value="OTHER">OTHER</option>
                    </select>
                  </div>
                </div>
                {(() => {
                  const configScheme = schemes.find(s => s.id === configSchemeId)
                  const isPartnerPlan = configScheme?.is_partner_plan || false
                  if (isPartnerPlan) {
                    return (
                      <div>
                        <p className="text-xs text-gray-500 mb-2">Partner Plan — single MDR rate applies to the entire transaction.</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium mb-1">Partner MDR (%)</label>
                            <input type="number" step="0.01" value={mdrForm.partner_mdr}
                              onChange={(e) => setMdrForm({ ...mdrForm, partner_mdr: parseFloat(e.target.value) || 0 })}
                              className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                          </div>
                        </div>
                      </div>
                    )
                  }
                  return (
                    <>
                      <p className="text-xs text-gray-500">T+0 MDR = T+1 MDR + 1% (auto calculated if left as 0)</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium mb-1">Retailer MDR T+1 (%)</label>
                          <input type="number" step="0.01" value={mdrForm.retailer_mdr_t1}
                            onChange={(e) => {
                              const t1 = parseFloat(e.target.value) || 0
                              setMdrForm({ ...mdrForm, retailer_mdr_t1: t1, retailer_mdr_t0: mdrForm.retailer_mdr_t0 === 0 ? t1 + 1 : mdrForm.retailer_mdr_t0 })
                            }}
                            className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1">Retailer MDR T+0 (%)</label>
                          <input type="number" step="0.01" value={mdrForm.retailer_mdr_t0}
                            onChange={(e) => setMdrForm({ ...mdrForm, retailer_mdr_t0: parseFloat(e.target.value) || 0 })}
                            className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1">Distributor MDR T+1 (%)</label>
                          <input type="number" step="0.01" value={mdrForm.distributor_mdr_t1}
                            onChange={(e) => {
                              const t1 = parseFloat(e.target.value) || 0
                              setMdrForm({ ...mdrForm, distributor_mdr_t1: t1, distributor_mdr_t0: mdrForm.distributor_mdr_t0 === 0 ? t1 + 1 : mdrForm.distributor_mdr_t0 })
                            }}
                            className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1">Distributor MDR T+0 (%)</label>
                          <input type="number" step="0.01" value={mdrForm.distributor_mdr_t0}
                            onChange={(e) => setMdrForm({ ...mdrForm, distributor_mdr_t0: parseFloat(e.target.value) || 0 })}
                            className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1">MD MDR T+1 (%)</label>
                          <input type="number" step="0.01" value={mdrForm.md_mdr_t1}
                            onChange={(e) => {
                              const t1 = parseFloat(e.target.value) || 0
                              setMdrForm({ ...mdrForm, md_mdr_t1: t1, md_mdr_t0: mdrForm.md_mdr_t0 === 0 ? t1 + 1 : mdrForm.md_mdr_t0 })
                            }}
                            className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1">MD MDR T+0 (%)</label>
                          <input type="number" step="0.01" value={mdrForm.md_mdr_t0}
                            onChange={(e) => setMdrForm({ ...mdrForm, md_mdr_t0: parseFloat(e.target.value) || 0 })}
                            className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                        </div>
                      </div>
                    </>
                  )
                })()}
              </div>
            )}

            {/* AEPS Form */}
            {configType === 'aeps' && (
              <div className="space-y-2">
                <div>
                  <label className="block text-sm font-medium mb-1">Transaction Type</label>
                  <select value={aepsForm.transaction_type} onChange={(e) => setAepsForm({ ...aepsForm, transaction_type: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                    <option value="cash_withdrawal">Cash Withdrawal</option>
                    <option value="cash_deposit">Cash Deposit</option>
                    <option value="balance_inquiry">Balance Enquiry</option>
                    <option value="mini_statement">Mini Statement</option>
                    <option value="aadhaar_to_aadhaar">Aadhaar to Aadhaar</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Min Amount (₹)</label>
                    <input type="number" value={aepsForm.min_amount} onChange={(e) => setAepsForm({ ...aepsForm, min_amount: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Max Amount (₹)</label>
                    <input type="number" value={aepsForm.max_amount} onChange={(e) => setAepsForm({ ...aepsForm, max_amount: parseFloat(e.target.value) || 100000 })}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                  </div>
                </div>
                <p className="text-xs text-gray-500">Pool = what you receive from above. Company profit first; you keep DT margin; remainder goes to RT.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { label: 'Partner Pool (base)', key: 'base_commission', typeKey: 'base_commission_type' },
                  { label: 'Company Earning', key: 'company_earning', typeKey: 'company_earning_type' },
                  { label: 'MD Commission', key: 'md_commission', typeKey: 'md_commission_type' },
                  { label: 'Distributor Commission', key: 'distributor_commission', typeKey: 'distributor_commission_type' },
                  { label: 'Retailer Commission', key: 'retailer_commission', typeKey: 'retailer_commission_type' },
                ].map(({ label, key, typeKey }) => (
                  <div key={key} className="grid grid-cols-3 gap-2 items-end">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium mb-1">{label}</label>
                      <input type="number" step="0.0001" value={(aepsForm as any)[key]}
                        onChange={(e) => setAepsForm({ ...aepsForm, [key]: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                    </div>
                    <div>
                      <select value={(aepsForm as any)[typeKey]}
                        onChange={(e) => setAepsForm({ ...aepsForm, [typeKey]: e.target.value })}
                        className="w-full px-2 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                        <option value="flat">₹ Flat</option>
                        <option value="percentage">% Pct</option>
                      </select>
                    </div>
                  </div>
                ))}
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">TDS (%)</label>
                  <input type="number" step="0.01" value={aepsForm.tds_percentage}
                    onChange={(e) => setAepsForm({ ...aepsForm, tds_percentage: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                </div>
                {(() => {
                  const p = aepsPreview()
                  return (
                    <div className={`p-3 rounded-lg text-sm border ${p.valid ? 'bg-teal-50 border-teal-200 text-teal-800 dark:bg-teal-900/20 dark:border-teal-800 dark:text-teal-300' : 'bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300'}`}>
                      <div className="font-medium mb-1">Preview at ₹{p.amt}</div>
                      <div>Pool ₹{p.base} → Company ₹{p.company} · MD ₹{p.md} · DT ₹{p.dt} · RT ₹{p.rt}</div>
                      <div className="mt-1">Distributed ₹{p.distributed} / Pool ₹{p.base} {p.valid ? '✓ valid' : '✗ exceeds pool'}</div>
                    </div>
                  )
                })()}
              </div>
            )}

            {configType === 'aeps_settlement' && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Min Amount (₹)</label>
                    <input type="number" value={aepsSettleForm.min_amount} onChange={(e) => setAepsSettleForm({ ...aepsSettleForm, min_amount: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Max Amount (₹)</label>
                    <input type="number" value={aepsSettleForm.max_amount} onChange={(e) => setAepsSettleForm({ ...aepsSettleForm, max_amount: parseFloat(e.target.value) || 100000 })}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                  </div>
                </div>
                <p className="text-xs text-gray-500">Retailer charge is deducted from AEPS wallet on settlement. Margins are distributed to DT/MD/Company.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { label: 'Retailer Charge (deducted)', key: 'retailer_charge', typeKey: 'retailer_charge_type' },
                  { label: 'Distributor Margin', key: 'distributor_commission', typeKey: 'distributor_commission_type' },
                  { label: 'MD Margin', key: 'md_commission', typeKey: 'md_commission_type' },
                  { label: 'Company Earning', key: 'company_charge', typeKey: 'company_charge_type' },
                ].map(({ label, key, typeKey }) => (
                  <div key={key} className="grid grid-cols-3 gap-2 items-end">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium mb-1">{label}</label>
                      <input type="number" step="0.01" value={(aepsSettleForm as any)[key]}
                        onChange={(e) => setAepsSettleForm({ ...aepsSettleForm, [key]: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                    </div>
                    <div>
                      <select value={(aepsSettleForm as any)[typeKey]}
                        onChange={(e) => setAepsSettleForm({ ...aepsSettleForm, [typeKey]: e.target.value })}
                        className="w-full px-2 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                        <option value="flat">₹ Flat</option>
                        <option value="percentage">% Pct</option>
                      </select>
                    </div>
                  </div>
                ))}
                </div>
              </div>
            )}

            {configType === 'shadval_settlement' && (
              <div className="space-y-2">
                <div>
                  <label className="block text-sm font-medium mb-1">Transfer Mode</label>
                  <select value={shadvalSettleForm.transfer_mode} onChange={(e) => setShadvalSettleForm({ ...shadvalSettleForm, transfer_mode: e.target.value as any })}
                    className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                    <option value="IMPS">IMPS</option>
                    <option value="NEFT">NEFT</option>
                    <option value="RTGS">RTGS</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Min Amount (₹)</label>
                    <input type="number" value={shadvalSettleForm.min_amount} onChange={(e) => setShadvalSettleForm({ ...shadvalSettleForm, min_amount: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Max Amount (₹)</label>
                    <input type="number" value={shadvalSettleForm.max_amount} onChange={(e) => setShadvalSettleForm({ ...shadvalSettleForm, max_amount: parseFloat(e.target.value) || 100000 })}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                  </div>
                </div>
                <p className="text-xs text-gray-500">Retailer charge is deducted on Settlement-2 transfers. Margins go to DT/MD/Company.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { label: 'Retailer Charge (deducted)', key: 'retailer_charge', typeKey: 'retailer_charge_type' },
                  { label: 'Distributor Margin', key: 'distributor_commission', typeKey: 'distributor_commission_type' },
                  { label: 'MD Margin', key: 'md_commission', typeKey: 'md_commission_type' },
                  { label: 'Company Earning', key: 'company_charge', typeKey: 'company_charge_type' },
                ].map(({ label, key, typeKey }) => (
                  <div key={key} className="grid grid-cols-3 gap-2 items-end">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium mb-1">{label}</label>
                      <input type="number" step="0.01" value={(shadvalSettleForm as any)[key]}
                        onChange={(e) => setShadvalSettleForm({ ...shadvalSettleForm, [key]: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                    </div>
                    <div>
                      <select value={(shadvalSettleForm as any)[typeKey]}
                        onChange={(e) => setShadvalSettleForm({ ...shadvalSettleForm, [typeKey]: e.target.value })}
                        className="w-full px-2 py-1.5 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                        <option value="flat">₹ Flat</option>
                        <option value="percentage">% Pct</option>
                      </select>
                    </div>
                  </div>
                ))}
                </div>
              </div>
            )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 shrink-0 flex justify-end gap-2">
              <button onClick={() => setShowConfigModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={handleSaveConfig} disabled={savingConfig} className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
                {savingConfig ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Settings Tab
function SettingsTab() {
  const { user } = useAuth()
  const { showToast } = useToast()
  const [activeSection, setActiveSection] = useState<'profile' | 'account' | 'notifications' | 'security' | 'preferences'>('profile')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')
  
  const [profileData, setProfileData] = useState({
    name: user?.name || '',
    email: user?.email || '',
    phone: '',
    business_name: '',
    address: '',
    city: '',
    state: '',
    pincode: '',
  })

  const [accountSettings, setAccountSettings] = useState({
    email_notifications: true,
    sms_notifications: false,
    push_notifications: true,
    marketing_emails: false,
  })

  const [securitySettings, setSecuritySettings] = useState({
    two_factor_enabled: false,
    session_timeout: 30,
  })

  useEffect(() => {
    if (user) {
      setProfileData(prev => ({
        ...prev,
        name: user.name || '',
        email: user.email || '',
      }))
    }
  }, [user])

  const fetchUserData = async () => {
    if (!user?.partner_id) return
    try {
      const { data, error } = await supabase
        .from('distributors')
        .select('*')
        .eq('partner_id', user.partner_id)
        .maybeSingle()
      
      if (error) throw error
      if (data) {
        setProfileData({
          name: data.name || user.name || '',
          email: data.email || user.email || '',
          phone: data.phone || '',
          business_name: data.business_name || '',
          address: data.address || '',
          city: data.city || '',
          state: data.state || '',
          pincode: data.pincode || '',
        })
      }
    } catch (err: any) {
      console.error('Error fetching user data:', err)
      showToast('Failed to load profile data', 'error')
    }
  }

  useEffect(() => {
    fetchUserData()
  }, [user?.partner_id])

  const handleSaveProfile = async () => {
    if (!user?.partner_id) return
    setLoading(true)
    setError('')
    setSuccess('')
    
    try {
      const { error } = await supabase
        .from('distributors')
        .update({
          name: profileData.name,
          phone: profileData.phone,
          business_name: profileData.business_name || null,
          address: profileData.address || null,
          city: profileData.city || null,
          state: profileData.state || null,
          pincode: profileData.pincode || null,
        })
        .eq('partner_id', user.partner_id)
      
      if (error) throw error
      setSuccess('Profile updated successfully!')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err: any) {
      setError(err.message || 'Failed to update profile')
      setTimeout(() => setError(''), 3000)
    } finally {
      setLoading(false)
    }
  }

  const handleChangePassword = async (currentPassword: string, newPassword: string, confirmPassword: string) => {
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match')
      setTimeout(() => setError(''), 3000)
      return
    }
    
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters')
      setTimeout(() => setError(''), 3000)
      return
    }

    setLoading(true)
    setError('')
    setSuccess('')
    
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to change password')
      setSuccess('Password changed successfully!')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err: any) {
      setError(err.message || 'Failed to change password')
      setTimeout(() => setError(''), 3000)
    } finally {
      setLoading(false)
    }
  }

  const settingsSections = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'account', label: 'Account', icon: Settings },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'preferences', label: 'Preferences', icon: Sliders },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Settings className="w-6 h-6 text-purple-600" />
            Settings
          </h2>
          <p className="text-sm text-gray-500 mt-1">Manage your account settings and preferences</p>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-2 text-red-700 dark:text-red-400 text-sm">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg flex items-center gap-2 text-green-700 dark:text-green-400 text-sm">
          <CheckCircle className="w-4 h-4" /> {success}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar Navigation */}
        <div className="lg:col-span-1">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 p-2">
            <nav className="space-y-1">
              {settingsSections.map((section) => {
                const Icon = section.icon
                return (
                  <button
                    key={section.id}
                    onClick={() => setActiveSection(section.id as any)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      activeSection === section.id
                        ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{section.label}</span>
                  </button>
                )
              })}
            </nav>
          </div>
        </div>

        {/* Main Content */}
        <div className="lg:col-span-3">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-lg border border-gray-200 dark:border-gray-800 p-6">
            {activeSection === 'profile' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Profile Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Full Name *</label>
                      <input
                        type="text"
                        value={profileData.name}
                        onChange={(e) => setProfileData({ ...profileData, name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
                      <input
                        type="email"
                        value={profileData.email}
                        disabled
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                      />
                      <p className="text-xs text-gray-500 mt-1">Email cannot be changed</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone</label>
                      <input
                        type="tel"
                        value={profileData.phone}
                        onChange={(e) => setProfileData({ ...profileData, phone: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Business Name</label>
                      <input
                        type="text"
                        value={profileData.business_name}
                        onChange={(e) => setProfileData({ ...profileData, business_name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Address</label>
                      <input
                        type="text"
                        value={profileData.address}
                        onChange={(e) => setProfileData({ ...profileData, address: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">City</label>
                      <input
                        type="text"
                        value={profileData.city}
                        onChange={(e) => setProfileData({ ...profileData, city: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">State</label>
                      <input
                        type="text"
                        value={profileData.state}
                        onChange={(e) => setProfileData({ ...profileData, state: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Pincode</label>
                      <input
                        type="text"
                        value={profileData.pincode}
                        onChange={(e) => setProfileData({ ...profileData, pincode: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>
                  <div className="mt-6 flex justify-end">
                    <button
                      onClick={handleSaveProfile}
                      disabled={loading}
                      className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
                    >
                      {loading ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'account' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Account Settings</h3>
                  <div className="space-y-4">
                    <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <h4 className="font-medium text-gray-900 dark:text-white">Partner ID</h4>
                          <p className="text-sm text-gray-500 dark:text-gray-400">Your unique partner identifier</p>
                        </div>
                        <span className="text-sm font-mono text-gray-700 dark:text-gray-300">{user?.partner_id || 'N/A'}</span>
                      </div>
                    </div>
                    <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <h4 className="font-medium text-gray-900 dark:text-white">Account Status</h4>
                          <p className="text-sm text-gray-500 dark:text-gray-400">Current account status</p>
                        </div>
                        <span className="px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400 rounded-full text-sm font-medium">
                          Active
                        </span>
                      </div>
                    </div>
                    <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium text-gray-900 dark:text-white">Account Type</h4>
                          <p className="text-sm text-gray-500 dark:text-gray-400">Your role in the system</p>
                        </div>
                        <span className="text-sm text-gray-700 dark:text-gray-300">Distributor</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'notifications' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Notification Preferences</h3>
                  <div className="space-y-4">
                    {Object.entries(accountSettings).map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                        <div>
                          <h4 className="font-medium text-gray-900 dark:text-white capitalize">
                            {key.replace(/_/g, ' ')}
                          </h4>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            {key.includes('email') && 'Receive email notifications'}
                            {key.includes('sms') && 'Receive SMS notifications'}
                            {key.includes('push') && 'Receive push notifications'}
                            {key.includes('marketing') && 'Receive marketing and promotional emails'}
                          </p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={value}
                            onChange={(e) => setAccountSettings({ ...accountSettings, [key]: e.target.checked })}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 dark:peer-focus:ring-purple-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-purple-600"></div>
                        </label>
                      </div>
                    ))}
                    <div className="mt-6 flex justify-end">
                      <button
                        onClick={() => {
                          setSuccess('Notification preferences saved!')
                          setTimeout(() => setSuccess(''), 3000)
                        }}
                        className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                      >
                        Save Preferences
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'security' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Security Settings</h3>
                  <div className="space-y-6">
                    <ChangePasswordForm onPasswordChange={handleChangePassword} loading={loading} />
                    <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium text-gray-900 dark:text-white">Two-Factor Authentication</h4>
                          <p className="text-sm text-gray-500 dark:text-gray-400">Add an extra layer of security to your account</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={securitySettings.two_factor_enabled}
                            onChange={(e) => setSecuritySettings({ ...securitySettings, two_factor_enabled: e.target.checked })}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 dark:peer-focus:ring-purple-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-purple-600"></div>
                        </label>
                      </div>
                    </div>
                    <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium text-gray-900 dark:text-white">Session Timeout</h4>
                          <p className="text-sm text-gray-500 dark:text-gray-400">Automatically log out after inactivity</p>
                        </div>
                        <select
                          value={securitySettings.session_timeout}
                          onChange={(e) => setSecuritySettings({ ...securitySettings, session_timeout: parseInt(e.target.value) })}
                          className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                        >
                          <option value={15}>15 minutes</option>
                          <option value={30}>30 minutes</option>
                          <option value={60}>1 hour</option>
                          <option value={120}>2 hours</option>
                          <option value={0}>Never</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeSection === 'preferences' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Preferences</h3>
                  <div className="space-y-4">
                    <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium text-gray-900 dark:text-white">Language</h4>
                          <p className="text-sm text-gray-500 dark:text-gray-400">Select your preferred language</p>
                        </div>
                        <select className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                          <option value="en">English</option>
                          <option value="hi">Hindi</option>
                        </select>
                      </div>
                    </div>
                    <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium text-gray-900 dark:text-white">Date Format</h4>
                          <p className="text-sm text-gray-500 dark:text-gray-400">Choose how dates are displayed</p>
                        </div>
                        <select className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                          <option value="dd/mm/yyyy">DD/MM/YYYY</option>
                          <option value="mm/dd/yyyy">MM/DD/YYYY</option>
                          <option value="yyyy-mm-dd">YYYY-MM-DD</option>
                        </select>
                      </div>
                    </div>
                    <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium text-gray-900 dark:text-white">Time Zone</h4>
                          <p className="text-sm text-gray-500 dark:text-gray-400">Your local time zone</p>
                        </div>
                        <select className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white">
                          <option value="IST">IST (Indian Standard Time)</option>
                          <option value="UTC">UTC</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Change Password Form Component
function ChangePasswordForm({ onPasswordChange, loading }: ChangePasswordFormProps) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState({ current: false, new: false, confirm: false })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onPasswordChange(currentPassword, newPassword, confirmPassword)
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
  }

  return (
    <div className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
      <h4 className="font-medium text-gray-900 dark:text-white mb-4">Change Password</h4>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Current Password</label>
          <div className="relative">
            <input
              type={showPasswords.current ? 'text' : 'password'}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white pr-10"
              required
            />
            <button
              type="button"
              onClick={() => setShowPasswords({ ...showPasswords, current: !showPasswords.current })}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <Eye className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">New Password</label>
          <div className="relative">
            <input
              type={showPasswords.new ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white pr-10"
              required
              minLength={6}
            />
            <button
              type="button"
              onClick={() => setShowPasswords({ ...showPasswords, new: !showPasswords.new })}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <Eye className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirm New Password</label>
          <div className="relative">
            <input
              type={showPasswords.confirm ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white pr-10"
              required
              minLength={6}
            />
            <button
              type="button"
              onClick={() => setShowPasswords({ ...showPasswords, confirm: !showPasswords.confirm })}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <Eye className="w-4 h-4" />
            </button>
          </div>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Changing Password...' : 'Change Password'}
        </button>
      </form>
    </div>
  )
}

export default function DistributorDashboard() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-white to-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-purple-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    }>
      <DistributorDashboardContent />
    </Suspense>
  )
}
