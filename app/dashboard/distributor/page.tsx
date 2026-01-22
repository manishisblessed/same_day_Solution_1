'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { 
  TrendingUp, DollarSign, Users, Activity, 
  LogOut, Package, Network, BarChart3,
  ArrowUpRight, ArrowDownRight, UserPlus, Receipt, Wallet,
  ArrowUpCircle, ArrowDownCircle, Download, Search, Eye,
  Settings, PieChart as PieChartIcon, Plus, X
} from 'lucide-react'
import TransactionsTable from '@/components/TransactionsTable'
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { motion } from 'framer-motion'

type TabType = 'dashboard' | 'wallet' | 'network' | 'commission' | 'analytics' | 'reports' | 'settings'

function DistributorDashboardContent() {
  const { user, logout, loading: authLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const getInitialTab = (): TabType => {
    const tab = searchParams.get('tab')
    if (tab && ['dashboard', 'wallet', 'network', 'commission', 'analytics', 'reports', 'settings'].includes(tab)) {
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
    const tab = searchParams.get('tab')
    if (tab && ['dashboard', 'wallet', 'network', 'commission', 'analytics', 'reports', 'settings'].includes(tab)) {
      setActiveTab(tab as TabType)
    }
  }, [searchParams])

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
    { id: 'analytics' as TabType, label: 'Analytics', icon: BarChart3 },
    { id: 'reports' as TabType, label: 'Reports', icon: Download },
    { id: 'settings' as TabType, label: 'Settings', icon: Settings },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Distributor Dashboard</h1>
              <p className="text-sm text-gray-600">Welcome back, {user?.name || user?.email}</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm text-gray-600">Partner ID</p>
                <p className="text-sm font-semibold text-gray-900">{user?.partner_id}</p>
              </div>
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Tabs */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 mb-6 overflow-hidden">
          <div className="flex space-x-1 border-b border-gray-200 p-1 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id)
                  router.push(`/dashboard/distributor?tab=${tab.id}`, { scroll: false })
                }}
                className={`relative flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all duration-200 rounded-lg whitespace-nowrap flex-shrink-0 ${
                  activeTab === tab.id
                    ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-md'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'dashboard' && <DashboardTab stats={stats} chartData={chartData} pieData={pieData} onTabChange={setActiveTab} router={router} />}
        {activeTab === 'wallet' && <WalletTab user={user} />}
        {activeTab === 'network' && <NetworkTab retailers={retailers} user={user} onRefresh={fetchDashboardData} />}
        {activeTab === 'commission' && <CommissionTab commissionData={commissionData} stats={stats} />}
        {activeTab === 'analytics' && <AnalyticsTab categoryData={categoryData} />}
        {activeTab === 'reports' && <ReportsTab user={user} />}
        {activeTab === 'settings' && <SettingsTab />}
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
      const response = await fetch('/api/distributor/wallet/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    aadhar_attachment: null as File | null,
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
    return fetch('/api/admin/upload-document', {
      method: 'POST',
      body: uploadFormData,
      headers,
      credentials: 'include'
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
    if (!formData.aadhar_number || !formData.aadhar_attachment) {
      alert('AADHAR Number and AADHAR Attachment are mandatory')
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
      let aadharUrl = ''
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

      // Upload AADHAR
      if (formData.aadhar_attachment) {
        const aadharFormData = new FormData()
        aadharFormData.append('file', formData.aadhar_attachment)
        aadharFormData.append('documentType', 'aadhar')
        aadharFormData.append('partnerId', partnerId)
        
        const aadharResponse = await uploadWithAuth(aadharFormData)
        
        if (!aadharResponse.ok) {
          const error = await aadharResponse.json()
          throw new Error(error.error || 'Failed to upload AADHAR document')
        }
        const aadharResult = await aadharResponse.json()
        aadharUrl = aadharResult.url
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
      const authHeaders: HeadersInit = {
        'Content-Type': 'application/json',
      }
      if (session?.access_token) {
        authHeaders['Authorization'] = `Bearer ${session.access_token}`
      }
      
      const response = await fetch('/api/distributor/create-retailer', {
        method: 'POST',
        headers: authHeaders,
        credentials: 'include',
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
            aadhar_attachment_url: aadharUrl || null,
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
              {/* AADHAR Attachment */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">
                  AADHAR Attachment *
                  <span className="text-xs text-red-500 ml-1">(Mandatory)</span>
                </label>
                <input
                  type="file"
                  required
                  accept="image/*,application/pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null
                    setFormData({ ...formData, aadhar_attachment: file })
                  }}
                  className="w-full px-3 py-2 border rounded-lg file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100"
                />
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

      const response = await fetch('/api/distributor/commission/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      const response = await fetch(`/api/reports/${reportType}?start=${dateRange.start}&end=${dateRange.end}&format=${format}`, {
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

// Settings Tab
function SettingsTab() {
  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
      <h3 className="text-lg font-semibold mb-4">Settings</h3>
      <p className="text-gray-600">Settings functionality coming soon...</p>
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
