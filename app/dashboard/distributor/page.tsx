'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import DistributorSidebar from '@/components/DistributorSidebar'
import DistributorHeader from '@/components/DistributorHeader'
import { 
  TrendingUp, DollarSign, Users, Activity, 
  LogOut, Package, Network, BarChart3,
  ArrowUpRight, ArrowDownRight, UserPlus, Receipt, Wallet,
  ArrowUpCircle, ArrowDownCircle, Download, Search, Eye,
  Settings, PieChart as PieChartIcon, Plus, X, Percent,
  Edit, Trash2, CreditCard, Smartphone, RefreshCw, AlertCircle, Menu,
  Layers, Banknote, Link2, ChevronDown, ChevronUp,
  User, Bell, Shield, Sliders, CheckCircle
} from 'lucide-react'
import TransactionsTable from '@/components/TransactionsTable'
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { motion } from 'framer-motion'
import { apiFetch } from '@/lib/api-client'
import POSMachinesTab from '@/components/POSMachinesTab'

type TabType = 'dashboard' | 'wallet' | 'network' | 'commission' | 'mdr-schemes' | 'analytics' | 'reports' | 'settings' | 'scheme-management' | 'pos-machines'

type ChangePasswordFormProps = {
  onPasswordChange: (current: string, newPassword: string, confirm: string) => void
  loading: boolean
}

function DistributorDashboardContent() {
  const { user, logout, loading: authLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  
  const getInitialTab = (): TabType => {
    const tab = searchParams.get('tab')
    if (tab && ['dashboard', 'wallet', 'network', 'commission', 'mdr-schemes', 'analytics', 'reports', 'settings', 'scheme-management', 'pos-machines'].includes(tab)) {
      return tab as TabType
    }
    return 'dashboard'
  }
  
  const [activeTab, setActiveTab] = useState<TabType>(getInitialTab())
  const [loading, setLoading] = useState(true)
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
        .eq('user_id', user.partner_id)
        .order('created_at', { ascending: false })
        .limit(100)

      setCommissionData(commissionLedger || [])
      const totalCommission = commissionLedger?.reduce((sum, entry) => sum + (entry.commission_amount || 0), 0) || 0

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
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    // Wait for auth to finish loading before checking user
    if (authLoading) return
    
    // Only redirect if we're sure the user is not a distributor
    if (user && user.role !== 'distributor') {
      router.push('/business-login')
      return
    }
    // Only fetch data if user exists and is a distributor
    if (user && user.role === 'distributor') {
      fetchDashboardData()
    } else if (!authLoading) {
      // Stop loading if no user after auth loads
      setLoading(false)
    }
  }, [user, router, authLoading, fetchDashboardData])

  useEffect(() => {
    // Redirect from old scheme-management route to tab-based route
    if (pathname === '/dashboard/distributor/scheme-management') {
      router.replace('/dashboard/distributor?tab=scheme-management', { scroll: false })
      return
    }
    
    const tab = searchParams.get('tab')
    if (tab && ['dashboard', 'wallet', 'network', 'commission', 'mdr-schemes', 'analytics', 'reports', 'settings', 'scheme-management', 'pos-machines'].includes(tab)) {
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
    { id: 'wallet' as TabType, label: 'Wallet', icon: Wallet },
    { id: 'network' as TabType, label: 'Network', icon: Network },
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
          {/* Page Header - Compact */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                  <h1 className="text-xl sm:text-2xl md:text-3xl font-bold bg-gradient-to-r from-purple-600 to-purple-700 bg-clip-text text-transparent">
                    Distributor Dashboard
                  </h1>
                </div>
                <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                  Welcome back, {user?.name || user?.email}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={fetchDashboardData}
                  className="p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  title="Refresh"
                >
                  <RefreshCw className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                </button>
              </div>
            </div>
          </motion.div>

          {/* Tab Content - Direct rendering based on activeTab */}
          {activeTab === 'dashboard' && <DashboardTab stats={stats} chartData={chartData} pieData={pieData} onTabChange={setActiveTab} router={router} />}
          {activeTab === 'wallet' && <WalletTab user={user} />}
          {activeTab === 'network' && <NetworkTab retailers={retailers} user={user} onRefresh={fetchDashboardData} />}
          {activeTab === 'commission' && <CommissionTab commissionData={commissionData} stats={stats} />}
          {activeTab === 'mdr-schemes' && <MDRSchemesTab user={user} retailers={retailers} onRefresh={fetchDashboardData} />}
          {activeTab === 'analytics' && <AnalyticsTab categoryData={categoryData} />}
          {activeTab === 'reports' && <ReportsTab user={user} />}
          {activeTab === 'settings' && <SettingsTab />}
          {activeTab === 'scheme-management' && <SchemeManagementTab user={user} retailers={retailers} onRefresh={fetchDashboardData} />}
          {activeTab === 'pos-machines' && <POSMachinesTab user={user} accentColor="purple" />}
        </div>
      </div>
    </div>
  )
}

// Dashboard Tab
function DashboardTab({ stats, chartData, pieData, onTabChange, router }: { stats: any, chartData: any[], pieData: any[], onTabChange: (tab: TabType) => void, router: any }) {
  const COLORS = ['#f97316', '#22c55e', '#3b82f6', '#a855f7', '#ef4444']
  
  return (
    <>
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card bg-gradient-to-br from-blue-500 to-blue-600 text-white cursor-pointer hover:shadow-xl transition-shadow"
          onClick={() => {
            onTabChange('network')
            router.push('/dashboard/distributor?tab=network', { scroll: false })
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-sm font-medium">Total Retailers</p>
              <p className="text-3xl font-bold mt-2">{stats.totalRetailers}</p>
              <div className="flex items-center gap-1 mt-2">
                <ArrowUpRight className="w-4 h-4" />
                <span className="text-sm text-blue-100">Click to manage</span>
              </div>
            </div>
            <Users className="w-12 h-12 text-blue-200" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card bg-gradient-to-br from-green-500 to-green-600 text-white cursor-pointer hover:shadow-xl transition-shadow"
          onClick={() => {
            onTabChange('network')
            router.push('/dashboard/distributor?tab=network', { scroll: false })
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-green-100 text-sm font-medium">Active Retailers</p>
              <p className="text-3xl font-bold mt-2">{stats.activeRetailers}</p>
              <div className="flex items-center gap-1 mt-2">
                <ArrowUpRight className="w-4 h-4" />
                <span className="text-sm text-green-100">Click to manage</span>
              </div>
            </div>
            <UserPlus className="w-12 h-12 text-green-200" />
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
          <div className="flex items-center justify-between">
            <div>
              <p className="text-purple-100 text-sm font-medium">Total Revenue</p>
              <p className="text-3xl font-bold mt-2">₹{stats.totalRevenue.toLocaleString()}</p>
              <div className="flex items-center gap-1 mt-2">
                <ArrowUpRight className="w-4 h-4" />
                <span className="text-sm text-purple-100">Click for details</span>
              </div>
            </div>
            <DollarSign className="w-12 h-12 text-purple-200" />
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
          <div className="flex items-center justify-between">
            <div>
              <p className="text-orange-100 text-sm font-medium">Commission Earned</p>
              <p className="text-3xl font-bold mt-2">₹{stats.commissionEarned.toLocaleString()}</p>
              <div className="flex items-center gap-1 mt-2">
                <ArrowUpRight className="w-4 h-4" />
                <span className="text-sm text-orange-100">Click to view</span>
              </div>
            </div>
            <TrendingUp className="w-12 h-12 text-orange-200" />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card bg-gradient-to-br from-indigo-500 to-indigo-600 text-white cursor-pointer hover:shadow-xl transition-shadow"
          onClick={() => {
            onTabChange('wallet')
            router.push('/dashboard/distributor?tab=wallet', { scroll: false })
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-indigo-100 text-sm font-medium">Wallet Balance</p>
              <p className="text-3xl font-bold mt-2">₹{stats.walletBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              <div className="flex items-center gap-1 mt-2">
                <span className="text-sm text-indigo-100">Click to manage</span>
              </div>
            </div>
            <Wallet className="w-12 h-12 text-indigo-200" />
          </div>
        </motion.div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card lg:col-span-2"
        >
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Retailer Network Performance</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="retailers" stroke="#3b82f6" strokeWidth={2} name="Active Retailers" />
              <Line type="monotone" dataKey="revenue" stroke="#22c55e" strokeWidth={2} name="Revenue (₹)" />
            </LineChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="card"
        >
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Retailer Status</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={pieData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${percent ? (percent * 100).toFixed(0) : 0}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
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
}

// Wallet Tab
function WalletTab({ user }: { user: any }) {
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
        .eq('user_id', user.partner_id)
        .eq('wallet_type', 'primary')
        .order('created_at', { ascending: false })
        .limit(50)

      setLedgerEntries(ledger || [])
    } catch (error) {
      console.error('Error fetching wallet data:', error)
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
                      {new Date(entry.created_at).toLocaleDateString()}
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
  const [searchTerm, setSearchTerm] = useState('')
  const [showFundTransfer, setShowFundTransfer] = useState(false)
  const [showAddRetailer, setShowAddRetailer] = useState(false)
  const [selectedUser, setSelectedUser] = useState<any>(null)
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
      alert('Please fill all fields')
      return
    }

    const amount = parseFloat(transferData.amount)
    if (isNaN(amount) || amount <= 0) {
      alert('Please enter a valid amount')
      return
    }

    try {
      const response = await apiFetch('/api/distributor/wallet/transfer', {
        method: 'POST',
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
        alert(`Fund ${action} successful!`)
        setShowFundTransfer(false)
        setSelectedUser(null)
        setTransferData({ amount: '', fund_category: 'cash', remarks: '' })
        onRefresh()
      } else {
        alert(data.error || 'Transfer failed')
      }
    } catch (error) {
      console.error('Transfer error:', error)
      alert('Failed to transfer funds')
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
                  className="flex-1 bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700"
                >
                  Push Funds
                </button>
                <button
                  onClick={() => handleFundTransfer('pull')}
                  className="flex-1 bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700"
                >
                  Pull Funds
                </button>
                <button
                  onClick={() => {
                    setShowFundTransfer(false)
                    setSelectedUser(null)
                  }}
                  className="flex-1 bg-gray-200 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-300"
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
    </div>
  )
}

// Add Retailer Modal Component
function AddRetailerModal({ onClose, onSuccess }: { onClose: () => void, onSuccess: () => void }) {
  const [currentStep, setCurrentStep] = useState(1) // 1: Basic Details, 2: Documents
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
    // Bank account details (mandatory)
    bank_name: '',
    account_number: '',
    ifsc_code: '',
    bank_document: null as File | null,
    // Document fields
    aadhar_number: '',
    aadhar_front_attachment: null as File | null,
    aadhar_back_attachment: null as File | null,
    pan_number: '',
    pan_attachment: null as File | null,
    udhyam_applicable: false,
    udhyam_number: '',
    udhyam_attachment: null as File | null,
    gst_applicable: false,
    gst_number: '',
    gst_attachment: null as File | null,
  })
  const [loading, setLoading] = useState(false)
  const [uploadingDocs, setUploadingDocs] = useState(false)

  // Helper to upload document with auth token (fallback for cookie issues)
  const uploadWithAuth = async (uploadFormData: FormData): Promise<Response> => {
    const { data: { session } } = await supabase.auth.getSession()
    const headers: HeadersInit = {}
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`
    }
    return apiFetch('/api/admin/upload-document', {
      method: 'POST',
      body: uploadFormData,
      headers,
    })
  }

  const handleStep1Next = (e: React.FormEvent) => {
    e.preventDefault()
    // Validate basic fields
    if (!formData.name || !formData.email || !formData.phone || !formData.password) {
      alert('Please fill all required fields')
      return
    }
    setCurrentStep(2)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validate bank account requirements
    if (!formData.bank_name || !formData.account_number || !formData.ifsc_code || !formData.bank_document) {
      alert('Bank Name, Account Number, IFSC Code, and Bank Document (passbook/cheque) are mandatory')
      return
    }
    // Validate document requirements
    if (!formData.aadhar_number || !formData.aadhar_front_attachment || !formData.aadhar_back_attachment) {
      alert('AADHAR Number, AADHAR Front, and AADHAR Back attachments are mandatory')
      return
    }
    if (!formData.pan_number || !formData.pan_attachment) {
      alert('PAN Number and PAN Attachment are mandatory')
      return
    }
    // Validate UDHYAM if applicable checkbox is checked
    if (formData.udhyam_applicable) {
      if (!formData.udhyam_number || !formData.udhyam_attachment) {
        alert('UDHYAM Number and Certificate are required when UDHYAM is applicable')
        return
      }
    }
    
    // Validate GST if applicable checkbox is checked
    if (formData.gst_applicable) {
      if (!formData.gst_number || !formData.gst_attachment) {
        alert('GST Number and Certificate are required when GST is applicable')
        return
      }
    }

    setUploadingDocs(true)

    try {
      // First, upload all documents
      const partnerId = `RET${Date.now().toString().slice(-8)}`
      let bankDocumentUrl = ''
      let aadharFrontUrl = ''
      let aadharBackUrl = ''
      let panUrl = ''
      let udhyamUrl = ''
      let gstUrl = ''

      // Upload Bank Document
      if (formData.bank_document) {
        const bankFormData = new FormData()
        bankFormData.append('file', formData.bank_document)
        bankFormData.append('documentType', 'bank')
        bankFormData.append('partnerId', partnerId)
        
        const bankResponse = await uploadWithAuth(bankFormData)
        
        if (!bankResponse.ok) {
          const error = await bankResponse.json()
          throw new Error(error.error || 'Failed to upload bank document')
        }
        const bankResult = await bankResponse.json()
        bankDocumentUrl = bankResult.url
      }

      // Upload AADHAR Front
      if (formData.aadhar_front_attachment) {
        const aadharFrontFormData = new FormData()
        aadharFrontFormData.append('file', formData.aadhar_front_attachment)
        aadharFrontFormData.append('documentType', 'aadhar-front')
        aadharFrontFormData.append('partnerId', partnerId)
        
        const aadharFrontResponse = await uploadWithAuth(aadharFrontFormData)
        
        if (!aadharFrontResponse.ok) {
          const error = await aadharFrontResponse.json()
          throw new Error(error.error || 'Failed to upload AADHAR Front document')
        }
        const aadharFrontResult = await aadharFrontResponse.json()
        aadharFrontUrl = aadharFrontResult.url
      }

      // Upload AADHAR Back
      if (formData.aadhar_back_attachment) {
        const aadharBackFormData = new FormData()
        aadharBackFormData.append('file', formData.aadhar_back_attachment)
        aadharBackFormData.append('documentType', 'aadhar-back')
        aadharBackFormData.append('partnerId', partnerId)
        
        const aadharBackResponse = await uploadWithAuth(aadharBackFormData)
        
        if (!aadharBackResponse.ok) {
          const error = await aadharBackResponse.json()
          throw new Error(error.error || 'Failed to upload AADHAR Back document')
        }
        const aadharBackResult = await aadharBackResponse.json()
        aadharBackUrl = aadharBackResult.url
      }

      // Upload PAN
      if (formData.pan_attachment) {
        const panFormData = new FormData()
        panFormData.append('file', formData.pan_attachment)
        panFormData.append('documentType', 'pan')
        panFormData.append('partnerId', partnerId)
        
        const panResponse = await uploadWithAuth(panFormData)
        
        if (!panResponse.ok) {
          const error = await panResponse.json()
          throw new Error(error.error || 'Failed to upload PAN document')
        }
        const panResult = await panResponse.json()
        panUrl = panResult.url
      }

      // Upload UDHYAM (if applicable and provided)
      if (formData.udhyam_applicable && formData.udhyam_attachment) {
        const udhyamFormData = new FormData()
        udhyamFormData.append('file', formData.udhyam_attachment)
        udhyamFormData.append('documentType', 'udhyam')
        udhyamFormData.append('partnerId', partnerId)
        
        const udhyamResponse = await uploadWithAuth(udhyamFormData)
        
        if (udhyamResponse.ok) {
          const udhyamResult = await udhyamResponse.json()
          udhyamUrl = udhyamResult.url
        }
      }

      // Upload GST (if applicable and provided)
      if (formData.gst_applicable && formData.gst_attachment) {
        const gstFormData = new FormData()
        gstFormData.append('file', formData.gst_attachment)
        gstFormData.append('documentType', 'gst')
        gstFormData.append('partnerId', partnerId)
        
        const gstResponse = await uploadWithAuth(gstFormData)
        
        if (gstResponse.ok) {
          const gstResult = await gstResponse.json()
          gstUrl = gstResult.url
        }
      }

      // Now create the retailer with all data
      setLoading(true)
      
      // Get auth token for fallback authentication
      const { data: { session } } = await supabase.auth.getSession()
      const authHeaders: HeadersInit = {}
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
            // Bank account details (mandatory)
            bank_name: formData.bank_name,
            account_number: formData.account_number,
            ifsc_code: formData.ifsc_code,
            bank_document_url: bankDocumentUrl,
            // Document fields
            aadhar_number: formData.aadhar_number || null,
            aadhar_front_url: aadharFrontUrl || null,
            aadhar_back_url: aadharBackUrl || null,
            pan_number: formData.pan_number || null,
            pan_attachment_url: panUrl || null,
            udhyam_number: formData.udhyam_number || null,
            udhyam_certificate_url: udhyamUrl || null,
            gst_number: formData.gst_number || null,
            gst_certificate_url: gstUrl || null,
          }
        })
      })

      const data = await response.json()
      if (data.success) {
        alert('Retailer created successfully! Status: Pending Verification. Admin will review and approve.')
        onSuccess()
      } else {
        alert(data.error || 'Failed to create retailer')
      }
    } catch (error: any) {
      console.error('Error creating retailer:', error)
      alert(error.message || 'Failed to create retailer')
    } finally {
      setLoading(false)
      setUploadingDocs(false)
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
                Step {currentStep} of 2: {currentStep === 1 ? 'Basic Details' : 'Document Upload'}
              </p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>
          {/* Progress indicator */}
          <div className="mt-4 flex gap-2">
            <div className={`flex-1 h-2 rounded ${currentStep >= 1 ? 'bg-purple-600' : 'bg-gray-200'}`}></div>
            <div className={`flex-1 h-2 rounded ${currentStep >= 2 ? 'bg-purple-600' : 'bg-gray-200'}`}></div>
          </div>
        </div>

        {currentStep === 1 ? (
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
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Password *</label>
              <input
                type="password"
                required
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Business Name</label>
              <input
                type="text"
                value={formData.business_name}
                onChange={(e) => setFormData({ ...formData, business_name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Commission Rate (%)</label>
              <input
                type="number"
                step="0.01"
                value={formData.commission_rate}
                onChange={(e) => setFormData({ ...formData, commission_rate: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Address</label>
              <input
                type="text"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">City</label>
              <input
                type="text"
                value={formData.city}
                onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">State</label>
              <select
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="">Select State</option>
                <option value="Andhra Pradesh">Andhra Pradesh</option>
                <option value="Arunachal Pradesh">Arunachal Pradesh</option>
                <option value="Assam">Assam</option>
                <option value="Bihar">Bihar</option>
                <option value="Chhattisgarh">Chhattisgarh</option>
                <option value="Goa">Goa</option>
                <option value="Gujarat">Gujarat</option>
                <option value="Haryana">Haryana</option>
                <option value="Himachal Pradesh">Himachal Pradesh</option>
                <option value="Jharkhand">Jharkhand</option>
                <option value="Karnataka">Karnataka</option>
                <option value="Kerala">Kerala</option>
                <option value="Madhya Pradesh">Madhya Pradesh</option>
                <option value="Maharashtra">Maharashtra</option>
                <option value="Manipur">Manipur</option>
                <option value="Meghalaya">Meghalaya</option>
                <option value="Mizoram">Mizoram</option>
                <option value="Nagaland">Nagaland</option>
                <option value="Odisha">Odisha</option>
                <option value="Punjab">Punjab</option>
                <option value="Rajasthan">Rajasthan</option>
                <option value="Sikkim">Sikkim</option>
                <option value="Tamil Nadu">Tamil Nadu</option>
                <option value="Telangana">Telangana</option>
                <option value="Tripura">Tripura</option>
                <option value="Uttar Pradesh">Uttar Pradesh</option>
                <option value="Uttarakhand">Uttarakhand</option>
                <option value="West Bengal">West Bengal</option>
                <option value="Andaman and Nicobar Islands">Andaman and Nicobar Islands</option>
                <option value="Chandigarh">Chandigarh</option>
                <option value="Dadra and Nagar Haveli and Daman and Diu">Dadra and Nagar Haveli and Daman and Diu</option>
                <option value="Delhi">Delhi</option>
                <option value="Jammu and Kashmir">Jammu and Kashmir</option>
                <option value="Ladakh">Ladakh</option>
                <option value="Lakshadweep">Lakshadweep</option>
                <option value="Puducherry">Puducherry</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Pincode</label>
              <input
                type="text"
                value={formData.pincode}
                onChange={(e) => setFormData({ ...formData, pincode: e.target.value })}
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
              Next: Upload Documents
            </button>
          </div>
        </form>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div className="mb-4">
              <h4 className="text-lg font-semibold mb-2">Bank Account & Document Details</h4>
              <p className="text-sm text-gray-600">Please provide bank account details and upload all required documents for verification.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Bank Account Details Section */}
              <div className="md:col-span-2">
                <h5 className="text-md font-semibold mb-3 text-purple-600 border-b pb-2">Bank Account Details (Mandatory)</h5>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Bank Name *
                  <span className="text-xs text-red-500 ml-1">(Mandatory)</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.bank_name}
                  onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Enter bank name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Account Number *
                  <span className="text-xs text-red-500 ml-1">(Mandatory)</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.account_number}
                  onChange={(e) => setFormData({ ...formData, account_number: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Enter account number"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  IFSC Code *
                  <span className="text-xs text-red-500 ml-1">(Mandatory)</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.ifsc_code}
                  onChange={(e) => setFormData({ ...formData, ifsc_code: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Enter IFSC code"
                  maxLength={11}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Bank Document (Passbook/Cheque) *
                  <span className="text-xs text-red-500 ml-1">(Mandatory)</span>
                </label>
                <input
                  type="file"
                  required
                  accept="image/*,application/pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null
                    setFormData({ ...formData, bank_document: file })
                  }}
                  className="w-full px-3 py-2 border rounded-lg file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100"
                />
                <p className="text-xs text-gray-500 mt-1">Upload passbook or cancelled cheque</p>
              </div>

              {/* Document Details Section */}
              <div className="md:col-span-2 mt-4">
                <h5 className="text-md font-semibold mb-3 text-purple-600 border-b pb-2">Identity & Business Documents</h5>
              </div>
              {/* AADHAR Number */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">
                  AADHAR Number *
                  <span className="text-xs text-red-500 ml-1">(Mandatory)</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.aadhar_number}
                  onChange={(e) => setFormData({ ...formData, aadhar_number: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Enter 12-digit AADHAR number"
                />
              </div>
              {/* AADHAR Front Attachment */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  AADHAR Front *
                  <span className="text-xs text-red-500 ml-1">(Mandatory)</span>
                </label>
                <input
                  type="file"
                  required
                  accept="image/*,application/pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null
                    setFormData({ ...formData, aadhar_front_attachment: file })
                  }}
                  className="w-full px-3 py-2 border rounded-lg file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100"
                />
                {formData.aadhar_front_attachment && (
                  <p className="text-xs text-green-600 mt-1">✓ {formData.aadhar_front_attachment.name}</p>
                )}
              </div>
              {/* AADHAR Back Attachment */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  AADHAR Back *
                  <span className="text-xs text-red-500 ml-1">(Mandatory)</span>
                </label>
                <input
                  type="file"
                  required
                  accept="image/*,application/pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null
                    setFormData({ ...formData, aadhar_back_attachment: file })
                  }}
                  className="w-full px-3 py-2 border rounded-lg file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100"
                />
                {formData.aadhar_back_attachment && (
                  <p className="text-xs text-green-600 mt-1">✓ {formData.aadhar_back_attachment.name}</p>
                )}
              </div>

              {/* PAN Number */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">
                  PAN Number *
                  <span className="text-xs text-red-500 ml-1">(Mandatory)</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.pan_number}
                  onChange={(e) => setFormData({ ...formData, pan_number: e.target.value.toUpperCase() })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Enter PAN number (e.g., ABCDE1234F)"
                  maxLength={10}
                />
              </div>
              {/* PAN Attachment */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">
                  PAN Attachment *
                  <span className="text-xs text-red-500 ml-1">(Mandatory)</span>
                </label>
                <input
                  type="file"
                  required
                  accept="image/*,application/pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null
                    setFormData({ ...formData, pan_attachment: file })
                  }}
                  className="w-full px-3 py-2 border rounded-lg file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100"
                />
              </div>

              {/* UDHYAM Section */}
              <div className="md:col-span-2">
                <div className="flex items-center mb-2">
                  <input
                    type="checkbox"
                    id="udhyam_applicable"
                    checked={formData.udhyam_applicable}
                    onChange={(e) => {
                      const checked = e.target.checked
                      setFormData({ 
                        ...formData, 
                        udhyam_applicable: checked,
                        // Clear fields if unchecked
                        udhyam_number: checked ? formData.udhyam_number : '',
                        udhyam_attachment: checked ? formData.udhyam_attachment : null
                      })
                    }}
                    className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                  />
                  <label htmlFor="udhyam_applicable" className="ml-2 text-sm font-medium">
                    UDHYAM Certificate Applicable
                    {formData.udhyam_applicable && <span className="text-xs text-red-500 ml-1">(Mandatory if checked)</span>}
                  </label>
                </div>
              </div>
              {formData.udhyam_applicable && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      UDHYAM Number *
                      <span className="text-xs text-red-500 ml-1">(Required)</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.udhyam_number}
                      onChange={(e) => setFormData({ ...formData, udhyam_number: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg"
                      placeholder="Enter UDHYAM registration number"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      UDHYAM Certificate *
                      <span className="text-xs text-red-500 ml-1">(Required)</span>
                    </label>
                    <input
                      type="file"
                      required
                      accept="image/*,application/pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null
                        setFormData({ ...formData, udhyam_attachment: file })
                      }}
                      className="w-full px-3 py-2 border rounded-lg file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100"
                    />
                  </div>
                </>
              )}

              {/* GST Section */}
              <div className="md:col-span-2">
                <div className="flex items-center mb-2">
                  <input
                    type="checkbox"
                    id="gst_applicable"
                    checked={formData.gst_applicable}
                    onChange={(e) => {
                      const checked = e.target.checked
                      setFormData({ 
                        ...formData, 
                        gst_applicable: checked,
                        // Clear fields if unchecked
                        gst_number: checked ? formData.gst_number : '',
                        gst_attachment: checked ? formData.gst_attachment : null
                      })
                    }}
                    className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                  />
                  <label htmlFor="gst_applicable" className="ml-2 text-sm font-medium">
                    GST Certificate Applicable
                    {formData.gst_applicable && <span className="text-xs text-red-500 ml-1">(Mandatory if checked)</span>}
                  </label>
                </div>
              </div>
              {formData.gst_applicable && (
                <>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      GST Number *
                      <span className="text-xs text-red-500 ml-1">(Required)</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.gst_number}
                      onChange={(e) => setFormData({ ...formData, gst_number: e.target.value.toUpperCase() })}
                      className="w-full px-3 py-2 border rounded-lg"
                      placeholder="Enter GST number"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">
                      GST Certificate *
                      <span className="text-xs text-red-500 ml-1">(Required)</span>
                    </label>
                    <input
                      type="file"
                      required
                      accept="image/*,application/pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null
                        setFormData({ ...formData, gst_attachment: file })
                      }}
                      className="w-full px-3 py-2 border rounded-lg file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100"
                    />
                  </div>
                </>
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
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || uploadingDocs}
                className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                {uploadingDocs ? 'Uploading Documents...' : loading ? 'Creating...' : 'Submit for Verification'}
              </button>
            </div>
          </form>
        )}
      </motion.div>
    </div>
  )
}

// Commission Tab
function CommissionTab({ commissionData, stats }: { commissionData: any[], stats: any }) {
  const [showAdjustment, setShowAdjustment] = useState(false)
  const [selectedCommission, setSelectedCommission] = useState<any>(null)
  const [adjustmentData, setAdjustmentData] = useState({
    adjustment_amount: '',
    adjustment_type: 'add' as 'add' | 'deduct',
    remarks: ''
  })

  const handleAdjustment = async () => {
    if (!selectedCommission || !adjustmentData.adjustment_amount) {
      alert('Please fill all fields')
      return
    }

    const amount = parseFloat(adjustmentData.adjustment_amount)
    if (isNaN(amount) || amount <= 0) {
      alert('Please enter a valid amount')
      return
    }

    try {
      // Get retailer_id from transaction
      const { data: transaction } = await supabase
        .from('razorpay_transactions')
        .select('retailer_id')
        .eq('id', selectedCommission.transaction_id)
        .single()

      if (!transaction) {
        alert('Transaction not found')
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
        alert(`Commission ${adjustmentData.adjustment_type === 'add' ? 'added' : 'deducted'} successfully!`)
        setShowAdjustment(false)
        setSelectedCommission(null)
        setAdjustmentData({ adjustment_amount: '', adjustment_type: 'add', remarks: '' })
        window.location.reload() // Refresh to show updated commission
      } else {
        alert(data.error || 'Adjustment failed')
      }
    } catch (error) {
      console.error('Adjustment error:', error)
      alert('Failed to adjust commission')
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
                      {new Date(entry.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">{entry.reference_id || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{entry.service_type || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{entry.mdr_percentage || 0}%</td>
                    <td className="px-4 py-3 text-sm font-medium text-green-600">
                      ₹{entry.commission_amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || '0.00'}
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
              <p className="text-sm text-gray-600">Current Commission: ₹{selectedCommission.commission_amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || '0.00'}</p>
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
                  className="flex-1 bg-orange-600 text-white py-2 px-4 rounded-lg hover:bg-orange-700"
                >
                  {adjustmentData.adjustment_type === 'add' ? 'Add' : 'Deduct'} Commission
                </button>
                <button
                  onClick={() => {
                    setShowAdjustment(false)
                    setSelectedCommission(null)
                    setAdjustmentData({ adjustment_amount: '', adjustment_type: 'add', remarks: '' })
                  }}
                  className="flex-1 bg-gray-200 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-300"
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
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={categoryData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} ${percent ? (percent * 100).toFixed(0) : 0}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="revenue"
                >
                  {categoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
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
  const [reportType, setReportType] = useState<'ledger' | 'transactions' | 'commission'>('ledger')
  const [dateRange, setDateRange] = useState({ start: '', end: '' })
  const [format, setFormat] = useState<'csv' | 'pdf' | 'zip'>('csv')

  const handleDownload = async () => {
    if (!dateRange.start || !dateRange.end) {
      alert('Please select date range')
      return
    }

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
        alert('Report downloaded successfully!')
      } else {
        alert('Failed to download report')
      }
    } catch (error) {
      console.error('Download error:', error)
      alert('Failed to download report')
    }
  }

  return (
    <div className="space-y-6">
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
            className="w-full bg-purple-600 text-white py-2 px-4 rounded-lg hover:bg-purple-700 flex items-center justify-center gap-2"
          >
            <Download className="w-5 h-5" />
            Download Report
          </button>
        </div>
      </div>
    </div>
  )
}

// MDR Schemes Tab
function MDRSchemesTab({ user, retailers, onRefresh }: { user: any, retailers: any[], onRefresh: () => void }) {
  const [schemes, setSchemes] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editingScheme, setEditingScheme] = useState<any>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedRetailer, setSelectedRetailer] = useState('')

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

      // Validate
      if (retailer_mdr_t1 < distributor_mdr_t1) {
        alert('Retailer MDR T+1 must be >= Distributor MDR T+1')
        return
      }
      if (retailer_mdr_t0 < distributor_mdr_t0) {
        alert('Retailer MDR T+0 must be >= Distributor MDR T+0')
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
    } catch (error: any) {
      console.error('Error saving scheme:', error)
      alert(error.message || 'Failed to save scheme')
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
    try {
      const { error } = await supabase
        .from('retailer_schemes')
        .delete()
        .eq('id', id)
      if (error) throw error
      fetchSchemes()
    } catch (error: any) {
      alert(error.message || 'Failed to delete scheme')
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
                        <button onClick={() => handleDelete(scheme.id)} className="p-1 text-red-600 hover:text-red-800">
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
  const [schemes, setSchemes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [expandedSchemeId, setExpandedSchemeId] = useState<string | null>(null)
  const [editingScheme, setEditingScheme] = useState<any>(null)
  const [showMappingModal, setShowMappingModal] = useState(false)
  const [mappingSchemeId, setMappingSchemeId] = useState<string>('')
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [configSchemeId, setConfigSchemeId] = useState<string>('')
  const [configType, setConfigType] = useState<'bbps' | 'payout' | 'mdr' | null>(null)

  const [schemeForm, setSchemeForm] = useState({
    name: '',
    description: '',
    scheme_type: 'custom' as 'custom',
    service_scope: 'all' as string,
    priority: 100,
  })

  const [bbpsForm, setBbpsForm] = useState({
    category: '',
    min_amount: 0,
    max_amount: 999999999,
    retailer_charge: 0,
    retailer_charge_type: 'flat' as 'flat' | 'percentage',
    retailer_commission: 0,
    retailer_commission_type: 'flat' as 'flat' | 'percentage',
    distributor_commission: 0,
    distributor_commission_type: 'flat' as 'flat' | 'percentage',
    md_commission: 0,
    md_commission_type: 'flat' as 'flat' | 'percentage',
    company_charge: 0,
    company_charge_type: 'flat' as 'flat' | 'percentage',
  })

  const [payoutForm, setPayoutForm] = useState({
    transfer_mode: 'IMPS' as 'IMPS' | 'NEFT',
    min_amount: 0,
    max_amount: 999999999,
    retailer_charge: 0,
    retailer_charge_type: 'flat' as 'flat' | 'percentage',
    retailer_commission: 0,
    retailer_commission_type: 'flat' as 'flat' | 'percentage',
    distributor_commission: 0,
    distributor_commission_type: 'flat' as 'flat' | 'percentage',
    md_commission: 0,
    md_commission_type: 'flat' as 'flat' | 'percentage',
    company_charge: 0,
    company_charge_type: 'flat' as 'flat' | 'percentage',
  })

  const [mdrForm, setMdrForm] = useState({
    mode: 'CARD' as 'CARD' | 'UPI',
    card_type: '' as string,
    brand_type: '',
    retailer_mdr_t1: 0,
    retailer_mdr_t0: 0,
    distributor_mdr_t1: 0,
    distributor_mdr_t0: 0,
    md_mdr_t1: 0,
    md_mdr_t0: 0,
  })

  const fetchSchemes = useCallback(async () => {
    if (!user?.partner_id) return
    setLoading(true)
    try {
      let query = supabase
        .from('schemes')
        .select('*')
        .eq('created_by_id', user.partner_id)
        .eq('created_by_role', 'distributor')
        .order('created_at', { ascending: false })
      
      const { data, error } = await query
      if (error) throw error
      
      let filtered = data || []
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
    
    const [bbps, payout, mdr, mappings] = await Promise.all([
      supabase.from('scheme_bbps_commissions').select('*').eq('scheme_id', schemeId).eq('status', 'active').order('min_amount'),
      supabase.from('scheme_payout_charges').select('*').eq('scheme_id', schemeId).eq('status', 'active').order('transfer_mode'),
      supabase.from('scheme_mdr_rates').select('*').eq('scheme_id', schemeId).eq('status', 'active').order('mode'),
      supabase.from('scheme_mappings').select('*').eq('scheme_id', schemeId).eq('status', 'active'),
    ])

    // Resolve entity names for mappings
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
      mappings: enrichedMappings,
    } : s))
    
    setExpandedSchemeId(schemeId)
  }

  const openCreateModal = () => {
    setSchemeForm({ name: '', description: '', scheme_type: 'custom', service_scope: 'all', priority: 100 })
    setEditingScheme(null)
    setShowCreateModal(true)
  }

  const handleSaveScheme = async () => {
    if (!user?.partner_id) return
    try {
      if (editingScheme) {
        const { error } = await supabase.from('schemes').update({
          name: schemeForm.name,
          description: schemeForm.description || null,
          service_scope: schemeForm.service_scope,
        }).eq('id', editingScheme.id)
        if (error) throw error
        setSuccess('Scheme updated successfully')
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
      }
      setShowCreateModal(false)
      fetchSchemes()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err: any) {
      setError(err.message)
      setTimeout(() => setError(''), 3000)
    }
  }

  const openMappingModal = (schemeId: string) => {
    setMappingSchemeId(schemeId)
    setShowMappingModal(true)
  }

  const openConfigModal = (schemeId: string, type: 'bbps' | 'payout' | 'mdr') => {
    setConfigSchemeId(schemeId)
    setConfigType(type)
    // Reset forms
    setBbpsForm({ category: '', min_amount: 0, max_amount: 999999999, retailer_charge: 0, retailer_charge_type: 'flat', retailer_commission: 0, retailer_commission_type: 'flat', distributor_commission: 0, distributor_commission_type: 'flat', md_commission: 0, md_commission_type: 'flat', company_charge: 0, company_charge_type: 'flat' })
    setPayoutForm({ transfer_mode: 'IMPS', min_amount: 0, max_amount: 999999999, retailer_charge: 0, retailer_charge_type: 'flat', retailer_commission: 0, retailer_commission_type: 'flat', distributor_commission: 0, distributor_commission_type: 'flat', md_commission: 0, md_commission_type: 'flat', company_charge: 0, company_charge_type: 'flat' })
    setMdrForm({ mode: 'CARD', card_type: '', brand_type: '', retailer_mdr_t1: 0, retailer_mdr_t0: 0, distributor_mdr_t1: 0, distributor_mdr_t0: 0, md_mdr_t1: 0, md_mdr_t0: 0 })
    setShowConfigModal(true)
  }

  const handleSaveConfig = async () => {
    try {
      if (configType === 'bbps') {
        const { error } = await supabase.from('scheme_bbps_commissions').insert({
          scheme_id: configSchemeId,
          category: bbpsForm.category || null,
          min_amount: bbpsForm.min_amount,
          max_amount: bbpsForm.max_amount,
          retailer_charge: bbpsForm.retailer_charge,
          retailer_charge_type: bbpsForm.retailer_charge_type,
          retailer_commission: bbpsForm.retailer_commission,
          retailer_commission_type: bbpsForm.retailer_commission_type,
          distributor_commission: bbpsForm.distributor_commission,
          distributor_commission_type: bbpsForm.distributor_commission_type,
          md_commission: bbpsForm.md_commission,
          md_commission_type: bbpsForm.md_commission_type,
          company_charge: bbpsForm.company_charge,
          company_charge_type: bbpsForm.company_charge_type,
          status: 'active',
        })
        if (error) throw error
      } else if (configType === 'payout') {
        const { error } = await supabase.from('scheme_payout_charges').insert({
          scheme_id: configSchemeId,
          transfer_mode: payoutForm.transfer_mode,
          min_amount: payoutForm.min_amount,
          max_amount: payoutForm.max_amount,
          retailer_charge: payoutForm.retailer_charge,
          retailer_charge_type: payoutForm.retailer_charge_type,
          retailer_commission: payoutForm.retailer_commission,
          retailer_commission_type: payoutForm.retailer_commission_type,
          distributor_commission: payoutForm.distributor_commission,
          distributor_commission_type: payoutForm.distributor_commission_type,
          md_commission: payoutForm.md_commission,
          md_commission_type: payoutForm.md_commission_type,
          company_charge: payoutForm.company_charge,
          company_charge_type: payoutForm.company_charge_type,
          status: 'active',
        })
        if (error) throw error
      } else if (configType === 'mdr') {
        const { error } = await supabase.from('scheme_mdr_rates').insert({
          scheme_id: configSchemeId,
          mode: mdrForm.mode,
          card_type: mdrForm.card_type || null,
          brand_type: mdrForm.brand_type || null,
          retailer_mdr_t1: mdrForm.retailer_mdr_t1,
          retailer_mdr_t0: mdrForm.retailer_mdr_t0,
          distributor_mdr_t1: mdrForm.distributor_mdr_t1,
          distributor_mdr_t0: mdrForm.distributor_mdr_t0,
          md_mdr_t1: mdrForm.md_mdr_t1,
          md_mdr_t0: mdrForm.md_mdr_t0,
          status: 'active',
        })
        if (error) throw error
      }
      setSuccess(`${configType?.toUpperCase()} configuration added successfully`)
      setShowConfigModal(false)
      // Refresh expanded scheme
      if (expandedSchemeId === configSchemeId) {
        toggleExpand(configSchemeId)
      } else {
        fetchSchemes()
      }
      setTimeout(() => setSuccess(''), 3000)
    } catch (err: any) {
      setError(err.message)
      setTimeout(() => setError(''), 3000)
    }
  }

  const handleDeleteConfig = async (table: string, id: string) => {
    if (!confirm('Delete this configuration?')) return
    try {
      const { error } = await supabase.from(table).delete().eq('id', id)
      if (error) throw error
      setSuccess('Configuration deleted')
      if (expandedSchemeId) toggleExpand(expandedSchemeId)
      setTimeout(() => setSuccess(''), 3000)
    } catch (err: any) {
      setError(err.message)
      setTimeout(() => setError(''), 3000)
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
    try {
      // Check if mapping already exists
      const { data: existing } = await supabase
        .from('scheme_mappings')
        .select('id')
        .eq('scheme_id', mappingSchemeId)
        .eq('entity_id', retailerId)
        .eq('entity_role', 'retailer')
        .eq('status', 'active')
        .maybeSingle()

      if (existing) {
        setError('Scheme already mapped to this retailer')
        setTimeout(() => setError(''), 3000)
        return
      }

      // Deactivate any existing mapping for this retailer
      await supabase
        .from('scheme_mappings')
        .update({ status: 'inactive' })
        .eq('entity_id', retailerId)
        .eq('entity_role', 'retailer')

      // Create new mapping
      const { error } = await supabase.from('scheme_mappings').insert({
        scheme_id: mappingSchemeId,
        entity_id: retailerId,
        entity_role: 'retailer',
        assigned_by_id: user?.partner_id,
        assigned_by_role: 'distributor',
        status: 'active',
        priority: 100,
      })

      if (error) throw error
      setSuccess('Scheme mapped successfully')
      setShowMappingModal(false)
      fetchSchemes()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err: any) {
      setError(err.message)
      setTimeout(() => setError(''), 3000)
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
                    <h3 className="font-semibold text-gray-900 dark:text-white">{scheme.name}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {scheme.service_scope} • {scheme.mapping_count || 0} mappings
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={(e) => { e.stopPropagation(); openConfigModal(scheme.id, 'bbps') }}
                    className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-600" title="Add BBPS Commission">
                    <CreditCard className="w-4 h-4" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); openConfigModal(scheme.id, 'payout') }}
                    className="p-1.5 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 text-green-600" title="Add Payout Charge">
                    <Banknote className="w-4 h-4" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); openConfigModal(scheme.id, 'mdr') }}
                    className="p-1.5 rounded-lg hover:bg-orange-50 dark:hover:bg-orange-900/20 text-orange-600" title="Add MDR Rate">
                    <TrendingUp className="w-4 h-4" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); openMappingModal(scheme.id) }}
                    className="p-1.5 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/20 text-purple-600" title="Map to Retailer">
                    <Link2 className="w-4 h-4" />
                  </button>
                  {expandedSchemeId === scheme.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                </div>
              </div>

              {expandedSchemeId === scheme.id && (
                <div className="border-t border-gray-200 dark:border-gray-800 p-4 space-y-4 bg-gray-50 dark:bg-gray-800/30">
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
                              <th className="px-2 py-1.5 text-left">Category</th>
                              <th className="px-2 py-1.5 text-left">Slab</th>
                              <th className="px-2 py-1.5 text-right">Retailer Charge</th>
                              <th className="px-2 py-1.5 text-right">Retailer Comm</th>
                              <th className="px-2 py-1.5 text-right">Dist Comm</th>
                              <th className="px-2 py-1.5 text-right">MD Comm</th>
                              <th className="px-2 py-1.5 text-right">Company</th>
                              <th className="px-2 py-1.5"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {scheme.bbps_commissions.map((c: any) => (
                              <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700">
                                <td className="px-2 py-1.5">{c.category || 'All'}</td>
                                <td className="px-2 py-1.5">{`₹${c.min_amount} - ₹${c.max_amount >= 999999 ? '∞' : c.max_amount}`}</td>
                                <td className="px-2 py-1.5 text-right">{c.retailer_charge}{c.retailer_charge_type === 'percentage' ? '%' : '₹'}</td>
                                <td className="px-2 py-1.5 text-right">{c.retailer_commission}{c.retailer_commission_type === 'percentage' ? '%' : '₹'}</td>
                                <td className="px-2 py-1.5 text-right">{c.distributor_commission}{c.distributor_commission_type === 'percentage' ? '%' : '₹'}</td>
                                <td className="px-2 py-1.5 text-right">{c.md_commission}{c.md_commission_type === 'percentage' ? '%' : '₹'}</td>
                                <td className="px-2 py-1.5 text-right">{c.company_charge}{c.company_charge_type === 'percentage' ? '%' : '₹'}</td>
                                <td className="px-2 py-1.5 text-right">
                                  <button onClick={() => handleDeleteConfig('scheme_bbps_commissions', c.id)} className="text-red-400 hover:text-red-600">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </td>
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
                      <Banknote className="w-4 h-4" /> Payout Charges ({scheme.payout_charges?.length || 0})
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
                              <th className="px-2 py-1.5 text-right">Company</th>
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
                                <td className="px-2 py-1.5 text-right">{c.company_charge}{c.company_charge_type === 'percentage' ? '%' : '₹'}</td>
                                <td className="px-2 py-1.5 text-right">
                                  <button onClick={() => handleDeleteConfig('scheme_payout_charges', c.id)} className="text-red-400 hover:text-red-600">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 italic">No payout charges configured</p>
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
                              <th className="px-2 py-1.5 text-right">Ret T+1</th>
                              <th className="px-2 py-1.5 text-right">Ret T+0</th>
                              <th className="px-2 py-1.5 text-right">Dist T+1</th>
                              <th className="px-2 py-1.5 text-right">Dist T+0</th>
                              <th className="px-2 py-1.5 text-right">MD T+1</th>
                              <th className="px-2 py-1.5 text-right">MD T+0</th>
                              <th className="px-2 py-1.5"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {scheme.mdr_rates.map((c: any) => (
                              <tr key={c.id} className="border-b border-gray-100 dark:border-gray-700">
                                <td className="px-2 py-1.5">{c.mode}</td>
                                <td className="px-2 py-1.5">{c.card_type || '-'}</td>
                                <td className="px-2 py-1.5">{c.brand_type || '-'}</td>
                                <td className="px-2 py-1.5 text-right">{c.retailer_mdr_t1}%</td>
                                <td className="px-2 py-1.5 text-right">{c.retailer_mdr_t0}%</td>
                                <td className="px-2 py-1.5 text-right">{c.distributor_mdr_t1}%</td>
                                <td className="px-2 py-1.5 text-right">{c.distributor_mdr_t0}%</td>
                                <td className="px-2 py-1.5 text-right">{c.md_mdr_t1}%</td>
                                <td className="px-2 py-1.5 text-right">{c.md_mdr_t0}%</td>
                                <td className="px-2 py-1.5 text-right">
                                  <button onClick={() => handleDeleteConfig('scheme_mdr_rates', c.id)} className="text-red-400 hover:text-red-600">
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 italic">No MDR rates configured</p>
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
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 italic">No retailers mapped yet</p>
                    )}
                  </div>
                </div>
              )}
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
                  <option value="payout">Payout Only</option>
                  <option value="mdr">MDR Only</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={handleSaveScheme} className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700">
                {editingScheme ? 'Update' : 'Create'}
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
                    className="w-full text-left p-3 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition"
                  >
                    <div className="font-medium">{ret.name}</div>
                    <div className="text-xs text-gray-500">{ret.partner_id}</div>
                  </button>
                ))
              )}
            </div>
            <button onClick={() => setShowMappingModal(false)} className="mt-4 px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg w-full">Close</button>
          </div>
        </div>
      )}

      {/* Configuration Modal (BBPS / Payout / MDR) */}
      {showConfigModal && configType && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg p-6 my-8">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              {configType === 'bbps' && <><CreditCard className="w-5 h-5 text-blue-600" /> Add BBPS Commission</>}
              {configType === 'payout' && <><Banknote className="w-5 h-5 text-green-600" /> Add Payout Charge</>}
              {configType === 'mdr' && <><TrendingUp className="w-5 h-5 text-orange-600" /> Add MDR Rate</>}
            </h2>

            {/* BBPS Form */}
            {configType === 'bbps' && (
              <div className="space-y-3">
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
                    <input type="number" value={bbpsForm.max_amount} onChange={(e) => setBbpsForm({ ...bbpsForm, max_amount: parseFloat(e.target.value) || 999999999 })}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                  </div>
                </div>
                {[
                  { label: 'Retailer Charge', key: 'retailer_charge', typeKey: 'retailer_charge_type' },
                  { label: 'Retailer Commission', key: 'retailer_commission', typeKey: 'retailer_commission_type' },
                  { label: 'Distributor Commission', key: 'distributor_commission', typeKey: 'distributor_commission_type' },
                  { label: 'MD Commission', key: 'md_commission', typeKey: 'md_commission_type' },
                  { label: 'Company Earning', key: 'company_charge', typeKey: 'company_charge_type' },
                ].map(({ label, key, typeKey }) => (
                  <div key={key} className="grid grid-cols-3 gap-2 items-end">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium mb-1">{label}</label>
                      <input type="number" step="0.01" value={(bbpsForm as any)[key]}
                        onChange={(e) => setBbpsForm({ ...bbpsForm, [key]: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                    </div>
                    <div>
                      <select value={(bbpsForm as any)[typeKey]}
                        onChange={(e) => setBbpsForm({ ...bbpsForm, [typeKey]: e.target.value })}
                        className="w-full px-2 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                        <option value="flat">₹ Flat</option>
                        <option value="percentage">% Pct</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Payout Form */}
            {configType === 'payout' && (
              <div className="space-y-3">
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
                    <input type="number" value={payoutForm.max_amount} onChange={(e) => setPayoutForm({ ...payoutForm, max_amount: parseFloat(e.target.value) || 999999999 })}
                      className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                  </div>
                </div>
                {[
                  { label: 'Retailer Charge', key: 'retailer_charge', typeKey: 'retailer_charge_type' },
                  { label: 'Retailer Commission', key: 'retailer_commission', typeKey: 'retailer_commission_type' },
                  { label: 'Distributor Commission', key: 'distributor_commission', typeKey: 'distributor_commission_type' },
                  { label: 'MD Commission', key: 'md_commission', typeKey: 'md_commission_type' },
                  { label: 'Company Earning', key: 'company_charge', typeKey: 'company_charge_type' },
                ].map(({ label, key, typeKey }) => (
                  <div key={key} className="grid grid-cols-3 gap-2 items-end">
                    <div className="col-span-2">
                      <label className="block text-xs font-medium mb-1">{label}</label>
                      <input type="number" step="0.01" value={(payoutForm as any)[key]}
                        onChange={(e) => setPayoutForm({ ...payoutForm, [key]: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700" />
                    </div>
                    <div>
                      <select value={(payoutForm as any)[typeKey]}
                        onChange={(e) => setPayoutForm({ ...payoutForm, [typeKey]: e.target.value })}
                        className="w-full px-2 py-2 border rounded-lg text-sm dark:bg-gray-800 dark:border-gray-700">
                        <option value="flat">₹ Flat</option>
                        <option value="percentage">% Pct</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* MDR Form */}
            {configType === 'mdr' && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
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
                        brand_type: availableBrands.length > 0 && availableBrands.includes(mdrForm.brand_type) ? mdrForm.brand_type : ''
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
                </div>
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
              </div>
            )}

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowConfigModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={handleSaveConfig} className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700">
                Save Configuration
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
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      })
      
      if (error) throw error
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
