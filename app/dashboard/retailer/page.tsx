'use client'

import { useState, useEffect, useMemo, useCallback, Suspense, lazy } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { apiFetch, apiFetchJson } from '@/lib/api-client'
import RetailerHeader from '@/components/RetailerHeader'
import { 
  TrendingUp, DollarSign, Users, Activity, 
  ShoppingCart, CreditCard, ArrowUpRight, Menu,
  RefreshCw, Settings, X, Check, AlertCircle, Eye, Receipt, Wallet, Download,
  Send, Banknote
} from 'lucide-react'
import TransactionsTable from '@/components/TransactionsTable'
import BBPSPayment from '@/components/BBPSPayment'
import PayoutTransfer from '@/components/PayoutTransfer'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

// Lazy load RetailerSidebar to prevent module loading errors from breaking the page
const RetailerSidebar = lazy(() => 
  import('@/components/RetailerSidebar').catch((error) => {
    // Return a fallback component if import fails
    return {
      default: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => (
        <aside className="hidden lg:flex flex-col w-56 bg-gray-50 border-r border-gray-200 h-[calc(100vh-4rem)] fixed left-0 top-16" />
      )
    }
  })
)

// Import framer-motion with a fallback component for SSR safety
import { motion } from 'framer-motion'

type TabType = 'dashboard' | 'wallet' | 'services' | 'bbps' | 'payout' | 'transactions' | 'reports' | 'settings'

function RetailerDashboardContent() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  
  const getInitialTab = (): TabType => {
    const tab = searchParams.get('tab')
    if (tab && ['dashboard', 'wallet', 'services', 'bbps', 'payout', 'transactions', 'reports', 'settings'].includes(tab)) {
      return tab as TabType
    }
    return 'dashboard'
  }
  
  const [activeTab, setActiveTab] = useState<TabType>(getInitialTab())
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    totalTransactions: 0,
    totalRevenue: 0,
    commissionEarned: 0,
    walletBalance: 0,
  })
  const [recentTransactions, setRecentTransactions] = useState<any[]>([])
  const [chartData, setChartData] = useState<any[]>([])

  // Add a mounted flag to prevent redirect on initial mount
  const [authChecked, setAuthChecked] = useState(false)
  
  useEffect(() => {
    // Wait for auth to finish loading before making redirect decisions
    if (!authLoading) {
      // Add a small delay to ensure session state is fully synchronized
      const timer = setTimeout(() => {
        setAuthChecked(true)
        if (!user || user.role !== 'retailer') {
          console.log('Auth check failed, redirecting to login. User:', user?.role || 'null')
          router.push('/business-login')
        }
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [user, authLoading, router])

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab && ['dashboard', 'wallet', 'services', 'bbps', 'payout', 'transactions', 'reports', 'settings'].includes(tab)) {
      if (tab !== activeTab) {
        setActiveTab(tab as TabType)
      }
    }
  }, [searchParams, activeTab])

  const fetchDashboardData = useCallback(async () => {
    if (!user) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      // Use maybeSingle() to avoid 406 errors
      // Note: We already have user data from auth, so this query is just for additional retailer info
      // Use a shorter timeout since we don't strictly need this data to show the dashboard
      const retailerQuery = supabase
        .from('retailers')
        .select('*')
        .eq('email', user.email)
        .maybeSingle()

      const timeoutPromise = new Promise((resolve) => 
        setTimeout(() => resolve({ data: null, error: { message: 'Timeout' } }), 3000)
      )

      const { data: retailerData, error: retailerError } = await Promise.race([
        retailerQuery,
        timeoutPromise
      ]) as any

      if (retailerError && retailerError.message !== 'Timeout') {
        console.error('Error fetching retailer data:', retailerError)
        // Continue with default values instead of blocking
      }

      // Fetch wallet balance (non-blocking with timeout - don't fail if function doesn't exist yet)
      let walletBalance = 0
      if (user.partner_id) {
        try {
          // Add timeout to prevent hanging (reduced to 3 seconds for faster loading)
          const walletTimeout = new Promise((resolve) => 
            setTimeout(() => resolve({ data: null, error: { message: 'Timeout' } }), 3000)
          )

          // Try new function first with timeout
          const balanceResult = await Promise.race([
            supabase.rpc('get_wallet_balance_v2', {
              p_user_id: user.partner_id,
              p_wallet_type: 'primary'
            }),
            walletTimeout
          ]) as any

          if (balanceResult?.data !== null && balanceResult?.data !== undefined && !balanceResult?.error) {
            walletBalance = balanceResult.data || 0
          } else if (user.role === 'retailer') {
            // Fallback to old function for retailers (backward compatibility) with timeout
            try {
              const oldBalanceResult = await Promise.race([
                supabase.rpc('get_wallet_balance', {
                  p_retailer_id: user.partner_id
                }),
                walletTimeout
              ]) as any
              walletBalance = oldBalanceResult?.data || 0
            } catch {
              walletBalance = 0
            }
          } else {
            walletBalance = 0
          }
        } catch (error) {
          // If new function doesn't exist, try old function for retailers with timeout
          if (user.role === 'retailer') {
            try {
              const walletTimeout = new Promise((resolve) => 
                setTimeout(() => resolve({ data: null, error: { message: 'Timeout' } }), 3000)
              )
              const oldBalanceResult = await Promise.race([
                supabase.rpc('get_wallet_balance', {
                  p_retailer_id: user.partner_id
                }),
                walletTimeout
              ]) as any
              walletBalance = oldBalanceResult?.data || 0
            } catch {
              walletBalance = 0
            }
          } else {
            walletBalance = 0
          }
        }
      }

      // Fetch real transaction data from ledger
      const { data: ledgerData } = await supabase
        .from('wallet_ledger')
        .select('*')
        .eq('retailer_id', user.partner_id)
        .eq('wallet_type', 'primary')
        .order('created_at', { ascending: false })
        .limit(1000)

      // Calculate real stats from ledger
      const totalTransactions = ledgerData?.length || 0
      const totalRevenue = ledgerData?.reduce((sum, entry) => sum + (entry.credit || 0), 0) || 0
      
      // Fetch commission data
      const { data: commissionData } = await supabase
        .from('commission_ledger')
        .select('commission_amount')
        .eq('user_id', user.partner_id)
      
      const commissionEarned = commissionData?.reduce((sum, entry) => sum + (entry.commission_amount || 0), 0) || 0

      setStats({
        totalTransactions,
        totalRevenue,
        commissionEarned,
        walletBalance,
      })

      // Get recent transactions from ledger (last 5)
      const recentLedgerEntries = (ledgerData || []).slice(0, 5).map(entry => ({
        id: entry.id,
        type: entry.service_type || entry.transaction_type || 'Transaction',
        amount: entry.credit || entry.debit || 0,
        status: entry.status || 'completed',
        date: new Date(entry.created_at).toLocaleDateString(),
        customer: 'Customer', // Can be enhanced with actual customer data if available
      }))

      setRecentTransactions(recentLedgerEntries)

      // Calculate weekly chart data from ledger
      const now = new Date()
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      
      const weeklyData = (ledgerData || []).filter(entry => {
        const entryDate = new Date(entry.created_at)
        return entryDate >= weekAgo
      })

      // Group by day of week
      const dayMap: Record<string, { transactions: number; revenue: number }> = {}
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      
      weeklyData.forEach(entry => {
        const entryDate = new Date(entry.created_at)
        const dayName = dayNames[entryDate.getDay()]
        
        if (!dayMap[dayName]) {
          dayMap[dayName] = { transactions: 0, revenue: 0 }
        }
        
        dayMap[dayName].transactions += 1
        dayMap[dayName].revenue += (entry.credit || 0)
      })

      // Create chart data in order (Mon-Sun)
      const orderedDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      setChartData(orderedDays.map(day => ({
        name: day,
        transactions: dayMap[day]?.transactions || 0,
        revenue: dayMap[day]?.revenue || 0,
      })))
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
      // Set default values to prevent dashboard from being stuck
      setStats({
        totalTransactions: 0,
        totalRevenue: 0,
        commissionEarned: 0,
        walletBalance: 0,
      })
      setRecentTransactions([])
      setChartData([])
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (user?.role === 'retailer') {
      fetchDashboardData().catch((error) => {
        console.error('Error in fetchDashboardData:', error)
        setLoading(false)
      })
    } else if (!authLoading) {
      // If auth is done but user is not a retailer or doesn't exist, stop loading
      // (will redirect via the other useEffect if user doesn't exist or wrong role)
      setLoading(false)
    }
  }, [user, authLoading, fetchDashboardData])

  // Safety timeout to prevent infinite loading
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (loading && !authLoading) {
        console.warn('Loading timeout reached, forcing dashboard to render')
        setLoading(false)
      }
    }, 15000) // 15 second timeout

    return () => clearTimeout(timeout)
  }, [loading, authLoading])

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 overflow-x-hidden">
      <RetailerHeader />
      <Suspense fallback={<div className="hidden lg:flex flex-col w-56 bg-gray-50 border-r border-gray-200 h-[calc(100vh-4rem)] fixed left-0 top-16" />}>
        <RetailerSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      </Suspense>
      
      <div className="flex-1 lg:ml-56 min-w-0 overflow-x-hidden pt-16">
        {/* Mobile Menu Button */}
        <button
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden fixed top-20 left-4 z-30 p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700"
        >
          <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
        </button>

        <div className="p-3 sm:p-4 lg:p-5 max-w-full h-[calc(100vh-4rem)] overflow-y-auto overflow-x-hidden">
          {/* Page Header */}
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex-1">
                <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-blue-600 to-blue-700 bg-clip-text text-transparent">
                  Retailer Dashboard
                </h1>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
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

          {/* Tabs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 mb-6 overflow-hidden"
          >
            <div className="flex space-x-1 border-b border-gray-200 dark:border-gray-700 p-1 overflow-x-auto">
              {[
                { id: 'dashboard' as TabType, label: 'Dashboard', icon: Activity },
                { id: 'wallet' as TabType, label: 'Wallet', icon: Wallet },
                { id: 'services' as TabType, label: 'Services', icon: ShoppingCart },
                { id: 'bbps' as TabType, label: 'BBPS Payments', icon: Receipt },
                { id: 'payout' as TabType, label: 'Settlement', icon: Banknote },
                { id: 'transactions' as TabType, label: 'Transactions', icon: CreditCard },
                { id: 'reports' as TabType, label: 'Reports', icon: TrendingUp },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id)
                    router.push(`/dashboard/retailer?tab=${tab.id}`, { scroll: false })
                  }}
                  className={`relative flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all duration-200 rounded-lg whitespace-nowrap flex-shrink-0 ${
                    activeTab === tab.id
                      ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <tab.icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          </motion.div>

          {/* Tab Content */}
          {activeTab === 'dashboard' && <DashboardTab stats={stats} chartData={chartData} recentTransactions={recentTransactions} />}
          {activeTab === 'wallet' && <WalletTab user={user} />}
          {activeTab === 'services' && <ServicesTab />}
          {activeTab === 'bbps' && <BBPSTab />}
          {activeTab === 'payout' && <PayoutTransfer title="Settlement to Bank Account" />}
          {activeTab === 'transactions' && <TransactionsTable role="retailer" autoPoll={true} pollInterval={10000} />}
          {activeTab === 'reports' && <ReportsTab chartData={chartData} stats={stats} />}
        </div>
      </div>
    </div>
  )
}

// Dashboard Tab Component
function DashboardTab({ stats, chartData, recentTransactions }: { stats: any, chartData: any[], recentTransactions: any[] }) {
  return (
    <>
      {/* Stats Cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4 w-full"
      >
        <StatCard
          label="Total Transactions"
          value={stats.totalTransactions}
          icon={Activity}
          gradient="from-blue-500 to-blue-600"
          delay={0}
        />
        <StatCard
          label="Total Revenue"
          value={`₹${stats.totalRevenue.toLocaleString()}`}
          icon={DollarSign}
          gradient="from-green-500 to-green-600"
          delay={0.1}
        />
        <StatCard
          label="Commission Earned"
          value={`₹${stats.commissionEarned.toLocaleString()}`}
          icon={TrendingUp}
          gradient="from-orange-500 to-orange-600"
          delay={0.3}
        />
        <StatCard
          label="Wallet Balance"
          value={`₹${stats.walletBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          icon={Wallet}
          gradient="from-purple-500 to-purple-600"
          delay={0.4}
        />
      </motion.div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4"
        >
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Transaction Trends</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="transactions" stroke="#3b82f6" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4"
        >
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Revenue Overview</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="revenue" fill="#22c55e" />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      {/* Recent Transactions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden"
      >
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Recent Transactions</h3>
          <button className="text-blue-600 hover:text-blue-700 text-sm font-medium">View All</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {recentTransactions.slice(0, 5).map((transaction) => (
                <tr key={transaction.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {transaction.type === 'Recharge' && <CreditCard className="w-4 h-4 text-blue-500" />}
                      {transaction.type === 'Bill Payment' && <ShoppingCart className="w-4 h-4 text-green-500" />}
                      {transaction.type === 'Money Transfer' && <DollarSign className="w-4 h-4 text-purple-500" />}
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{transaction.type}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                    ₹{transaction.amount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                      transaction.status === 'success' 
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' 
                        : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                    }`}>
                      {transaction.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                    {transaction.date}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </>
  )
}

// BBPS Tab Component with Sub-tabs
function BBPSTab() {
  const [bbpsSubTab, setBbpsSubTab] = useState<'recharge' | 'utilities' | 'creditcard' | 'others'>('recharge')

  // Category groupings - ALL 28 categories covered
  const RECHARGE_CATEGORIES = [
    'Mobile Prepaid', 'DTH', 'Fastag', 'NCMC Recharge', 'Broadband Postpaid', 
    'Landline Postpaid', 'Mobile Postpaid', 'Cable TV'
  ]
  
  const UTILITY_CATEGORIES = [
    'Electricity', 'Gas', 'Water', 'LPG Gas', 'Municipal Services', 'Municipal Taxes', 
    'Housing Society', 'Rental', 'Prepaid meter'
  ]
  
  const CREDITCARD_CATEGORIES = ['Credit Card']
  
  // Other services - Insurance, Loans, Education, Health, etc.
  const OTHER_CATEGORIES = [
    'Insurance', 'Loan Repayment', 'Education Fees', 'Hospital', 'Hospital and Pathology',
    'Clubs and Associations', 'Subscription', 'Recurring Deposit', 'NPS', 'Donation'
  ]

  const subTabs = [
    { id: 'recharge' as const, label: 'Recharge & Postpaid', description: 'Mobile, DTH, Fastag, Cable TV', color: 'from-blue-500 to-blue-600' },
    { id: 'utilities' as const, label: 'Utility Bills', description: 'Electricity, Gas, Water, LPG', color: 'from-green-500 to-green-600' },
    { id: 'creditcard' as const, label: 'Credit Card', description: 'Credit Card Bill Payment', color: 'from-purple-500 to-purple-600' },
    { id: 'others' as const, label: 'Other Services', description: 'Insurance, Loan, Education, Health', color: 'from-orange-500 to-orange-600' },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Sub-tab Navigation */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-2">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {subTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setBbpsSubTab(tab.id)}
              className={`p-3 rounded-lg text-left transition-all ${
                bbpsSubTab === tab.id
                  ? `bg-gradient-to-r ${tab.color} text-white shadow-md`
                  : 'bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
              }`}
            >
              <div className="font-semibold text-sm">{tab.label}</div>
              <div className={`text-xs mt-0.5 ${bbpsSubTab === tab.id ? 'text-white/80' : 'text-gray-500 dark:text-gray-400'}`}>
                {tab.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* BBPS Payment Component with Category Filter */}
      <BBPSPayment 
        categoryFilter={
          bbpsSubTab === 'recharge' ? RECHARGE_CATEGORIES :
          bbpsSubTab === 'utilities' ? UTILITY_CATEGORIES :
          bbpsSubTab === 'creditcard' ? CREDITCARD_CATEGORIES :
          OTHER_CATEGORIES
        }
        title={
          bbpsSubTab === 'recharge' ? 'Recharge & Postpaid Services' :
          bbpsSubTab === 'utilities' ? 'Utility Bill Payments' :
          bbpsSubTab === 'creditcard' ? 'Credit Card Bill Payment' :
          'Other Services'
        }
      />
    </motion.div>
  )
}

// Services Tab Component
function ServicesTab() {
  const { user } = useAuth()
  const [services, setServices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchServiceData()
  }, [user])

  const fetchServiceData = async () => {
    if (!user?.partner_id) {
      setLoading(false)
      return
    }

    try {
      // Fetch all ledger entries for this retailer
      const { data: ledgerData } = await supabase
        .from('wallet_ledger')
        .select('*')
        .eq('retailer_id', user.partner_id)
        .eq('wallet_type', 'primary')

      // Map service types to display names and icons
      const serviceMap: Record<string, { name: string; icon: string }> = {
        'bbps': { name: 'Utility Bill Payments', icon: '📄' },
        'aeps': { name: 'AEPS Services', icon: '👆' },
        'pos': { name: 'Mini-ATM, POS & WPOS', icon: '🏧' },
        'settlement': { name: 'Settlement', icon: '💰' },
        'admin': { name: 'Admin Services', icon: '🏦' },
        'other': { name: 'Other Services', icon: '📱' },
      }

      // Aggregate data by service type
      const serviceStats: Record<string, { transactions: number; revenue: number }> = {};
      
      ledgerData?.forEach(entry => {
        const serviceType = entry.service_type || 'other'
        if (!serviceStats[serviceType]) {
          serviceStats[serviceType] = { transactions: 0, revenue: 0 }
        }
        serviceStats[serviceType].transactions += 1
        serviceStats[serviceType].revenue += (entry.credit || 0)
      })

      // Create services array from aggregated data
      const servicesList = Object.entries(serviceStats).map(([serviceType, stats]) => {
        const serviceInfo = serviceMap[serviceType] || { name: serviceType, icon: '📱' }
        return {
          id: serviceType,
          name: serviceInfo.name,
          icon: serviceInfo.icon,
          status: 'active' as const,
          transactions: stats.transactions,
          revenue: `₹${stats.revenue.toLocaleString('en-IN')}`,
        }
      })

      // Add default services that might not have transactions yet
      const defaultServices = [
        { id: 'banking-payments', name: 'Banking & Payments', icon: '🏦' },
        { id: 'mini-atm', name: 'Mini-ATM, POS & WPOS', icon: '🏧' },
        { id: 'aeps', name: 'AEPS Services', icon: '👆' },
        { id: 'merchant-payments', name: 'Aadhaar Pay', icon: '💳' },
        { id: 'dmt', name: 'Domestic Money Transfer', icon: '💸' },
        { id: 'bill-payments', name: 'Utility Bill Payments', icon: '📄' },
        { id: 'recharge', name: 'Mobile Recharge', icon: '📱' },
        { id: 'travel', name: 'Travel Services', icon: '✈️' },
        { id: 'cash-management', name: 'Cash Management', icon: '💰' },
        { id: 'lic-payment', name: 'LIC Bill Payment', icon: '🛡️' },
        { id: 'insurance', name: 'Insurance', icon: '🏥' },
      ]

      // Merge default services with actual data
      const mergedServices = defaultServices.map(defaultService => {
        const existing = servicesList.find(s => s.id === defaultService.id || 
          (defaultService.id === 'bill-payments' && s.id === 'bbps') ||
          (defaultService.id === 'mini-atm' && s.id === 'pos'))
        
        if (existing) {
          return existing
        }
        
        return {
          ...defaultService,
          status: 'active' as const,
          transactions: 0,
          revenue: '₹0',
        }
      })

      setServices(mergedServices)
    } catch (error) {
      console.error('Error fetching service data:', error)
      // Set empty services on error
      setServices([])
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Services Grid */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3"
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
              <button className="flex-1 px-2 py-1.5 text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors">
                View Details
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
        className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4"
      >
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Service Overview</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Total Services</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{services.length}</p>
          </div>
          <div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Active Services</p>
            <p className="text-xl font-bold text-green-600 dark:text-green-400">{services.filter(s => s.status === 'active').length}</p>
          </div>
          <div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Total Transactions</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{services.reduce((sum, s) => sum + s.transactions, 0).toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Total Revenue</p>
            <p className="text-xl font-bold text-green-600 dark:text-green-400">
              ₹{services.reduce((sum, s) => {
                const revenueStr = s.revenue.replace('₹', '').replace(/,/g, '')
                return sum + (parseFloat(revenueStr) || 0)
              }, 0).toLocaleString('en-IN')}
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// Transactions Tab Component
function TransactionsTab({ transactions }: { transactions: any[] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden"
    >
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">All Transactions</h3>
        <div className="flex gap-2">
          <button className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600">
            Filter
          </button>
          <button className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600">
            Export
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">ID</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Amount</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Customer</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Date</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {transactions.map((transaction) => (
              <tr key={transaction.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-white">#{transaction.id}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    {transaction.type === 'Recharge' && <CreditCard className="w-4 h-4 text-blue-500" />}
                    {transaction.type === 'Bill Payment' && <ShoppingCart className="w-4 h-4 text-green-500" />}
                    {transaction.type === 'Money Transfer' && <DollarSign className="w-4 h-4 text-purple-500" />}
                    <span className="text-sm font-medium text-gray-900 dark:text-white">{transaction.type}</span>
                  </div>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-white">
                  ₹{transaction.amount.toLocaleString()}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                  {transaction.customer}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                    transaction.status === 'success' 
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' 
                      : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400'
                  }`}>
                    {transaction.status}
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                  {transaction.date}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <button className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors">
                    <Eye className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  )
}

// Reports Tab Component
// Wallet Tab Component
function WalletTab({ user }: { user: any }) {
  const [walletBalance, setWalletBalance] = useState<number | null>(null)
  const [aepsBalance, setAepsBalance] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [ledgerEntries, setLedgerEntries] = useState<any[]>([])
  const [showSettlement, setShowSettlement] = useState(false)
  const [settlementAmount, setSettlementAmount] = useState('')
  const [bankDetails, setBankDetails] = useState({
    account_number: '',
    ifsc: '',
    account_name: ''
  })

  useEffect(() => {
    fetchWalletData()
  }, [user])

  const fetchWalletData = async () => {
    if (!user?.partner_id) return
    setLoading(true)
    try {
      // Fetch PRIMARY wallet balance
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

      // Fetch AEPS wallet balance
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

      // Fetch ledger entries
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
    } finally {
      setLoading(false)
    }
  }

  const handleSettlement = async () => {
    if (!settlementAmount || parseFloat(settlementAmount) <= 0) {
      alert('Please enter a valid settlement amount')
      return
    }

    if (!bankDetails.account_number || !bankDetails.ifsc || !bankDetails.account_name) {
      alert('Please fill all bank details')
      return
    }

    try {
      const data = await apiFetchJson<{ success: boolean; error?: string }>('/api/settlement/create', {
        method: 'POST',
        body: JSON.stringify({
          amount: parseFloat(settlementAmount),
          bank_account_number: bankDetails.account_number,
          bank_ifsc: bankDetails.ifsc,
          bank_account_name: bankDetails.account_name,
          settlement_mode: 'instant'
        })
      })

      if (data.success) {
        alert('Settlement request created successfully!')
        setShowSettlement(false)
        setSettlementAmount('')
        setBankDetails({ account_number: '', ifsc: '', account_name: '' })
        fetchWalletData()
      } else {
        alert(data.error || 'Settlement failed')
      }
    } catch (error: any) {
      console.error('Settlement error:', error)
      alert(error.message || 'Failed to create settlement request')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Wallet Balance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg p-6 text-white"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-blue-100 text-sm font-medium mb-1">Primary Wallet</p>
              <p className="text-3xl font-bold">
                ₹{walletBalance?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
              </p>
            </div>
            <Wallet className="w-12 h-12 text-blue-200" />
          </div>
          <button
            onClick={() => setShowSettlement(true)}
            className="w-full mt-4 bg-white/20 hover:bg-white/30 text-white font-medium py-2 px-4 rounded-lg transition-colors"
          >
            Request Settlement
          </button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl shadow-lg p-6 text-white"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-purple-100 text-sm font-medium mb-1">AEPS Wallet</p>
              <p className="text-3xl font-bold">
                ₹{aepsBalance?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
              </p>
            </div>
            <Wallet className="w-12 h-12 text-purple-200" />
          </div>
        </motion.div>
      </div>

      {/* Settlement Modal */}
      {showSettlement && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6"
          >
            <h3 className="text-xl font-bold mb-4">Request Settlement</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Amount (₹)</label>
                <input
                  type="number"
                  value={settlementAmount}
                  onChange={(e) => setSettlementAmount(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg"
                  placeholder="Enter amount"
                  max="200000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Bank Account Number</label>
                <input
                  type="text"
                  value={bankDetails.account_number}
                  onChange={(e) => setBankDetails({ ...bankDetails, account_number: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg"
                  placeholder="Enter account number"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">IFSC Code</label>
                <input
                  type="text"
                  value={bankDetails.ifsc}
                  onChange={(e) => setBankDetails({ ...bankDetails, ifsc: e.target.value.toUpperCase() })}
                  className="w-full px-4 py-2 border rounded-lg"
                  placeholder="Enter IFSC code"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Account Holder Name</label>
                <input
                  type="text"
                  value={bankDetails.account_name}
                  onChange={(e) => setBankDetails({ ...bankDetails, account_name: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg"
                  placeholder="Enter account holder name"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleSettlement}
                  className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700"
                >
                  Submit
                </button>
                <button
                  onClick={() => setShowSettlement(false)}
                  className="flex-1 bg-gray-200 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Ledger Entries */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
      >
        <h3 className="text-lg font-semibold mb-4">Transaction History</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Category</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Credit</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Debit</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Balance</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {ledgerEntries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    No transactions found
                  </td>
                </tr>
              ) : (
                ledgerEntries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                      {new Date(entry.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{entry.transaction_type}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{entry.fund_category || '-'}</td>
                    <td className="px-4 py-3 text-sm text-green-600 dark:text-green-400">
                      {entry.credit > 0 ? `₹${entry.credit.toLocaleString()}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-red-600 dark:text-red-400">
                      {entry.debit > 0 ? `₹${entry.debit.toLocaleString()}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
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

function ReportsTab({ chartData, stats }: { chartData: any[], stats: any }) {
  const { user } = useAuth()
  const [reportType, setReportType] = useState<'ledger' | 'transactions' | 'commission'>('ledger')
  const [dateRange, setDateRange] = useState({ start: '', end: '' })
  const [format, setFormat] = useState<'csv' | 'pdf' | 'zip'>('csv')
  const [downloading, setDownloading] = useState(false)

  const handleDownload = async () => {
    if (!dateRange.start || !dateRange.end) {
      alert('Please select date range')
      return
    }

    setDownloading(true)
    try {
      const response = await apiFetch(`/api/reports/${reportType}?start=${dateRange.start}&end=${dateRange.end}&format=${format}`, {
        method: 'GET',
      })

      if (response.ok) {
        if (format === 'zip') {
          // For ZIP, handle JSON response
          const data = await response.json()
          if (data.files) {
            // Create a simple text file listing (in production, use JSZip)
            const fileList = Object.keys(data.files).join('\n')
            const blob = new Blob([fileList], { type: 'text/plain' })
            const url = window.URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `${reportType}_report_${dateRange.start}_to_${dateRange.end}.txt`
            document.body.appendChild(a)
            a.click()
            window.URL.revokeObjectURL(url)
            document.body.removeChild(a)
          }
        } else {
          const blob = await response.blob()
          const url = window.URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          const extension = format === 'pdf' ? 'html' : format
          a.download = `${reportType}_report_${dateRange.start}_to_${dateRange.end}.${extension}`
          document.body.appendChild(a)
          a.click()
          window.URL.revokeObjectURL(url)
          document.body.removeChild(a)
        }
        alert('Report downloaded successfully!')
      } else {
        const error = await response.json()
        alert(error.error || 'Failed to download report')
      }
    } catch (error) {
      console.error('Download error:', error)
      alert('Failed to download report')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Performance Charts */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4"
      >
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Performance Report</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Weekly Transaction Trend</p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="transactions" stroke="#3b82f6" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Revenue Breakdown</p>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="revenue" fill="#22c55e" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </motion.div>

      {/* Download Reports Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6"
      >
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Download Reports</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Report Type</label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value as 'ledger' | 'transactions' | 'commission')}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="ledger">Ledger Report</option>
              <option value="transactions">Transaction Report</option>
              <option value="commission">Commission Report</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Start Date</label>
              <input
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">End Date</label>
              <input
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Format</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as 'csv' | 'pdf' | 'zip')}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="csv">CSV</option>
              <option value="pdf">PDF (HTML)</option>
              <option value="zip">ZIP (Bulk Export)</option>
            </select>
          </div>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-5 h-5" />
            {downloading ? 'Downloading...' : 'Download Report'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// Stat Card Component
function StatCard({ label, value, icon: Icon, gradient, delay }: { 
  label: string
  value: string | number
  icon: any
  gradient: string
  delay: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay }}
      className={`relative overflow-hidden rounded-lg bg-gradient-to-br ${gradient} text-white p-4 shadow-md hover:shadow-lg transition-shadow`}
    >
      <div className="relative z-10 flex items-center justify-between">
        <div>
          <p className="text-white/80 text-xs font-medium mb-0.5">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
        <div className="p-2 bg-white/20 rounded-lg backdrop-blur-sm">
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <div className="absolute -bottom-3 -right-3 w-16 h-16 bg-white/10 rounded-full blur-xl"></div>
    </motion.div>
  )
}

export default function RetailerDashboard() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading dashboard...</p>
        </div>
      </div>
    }>
      <RetailerDashboardContent />
    </Suspense>
  )
}
