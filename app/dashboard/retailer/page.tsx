'use client'

import { useState, useEffect, useMemo, Suspense } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import RetailerSidebar from '@/components/RetailerSidebar'
import RetailerHeader from '@/components/RetailerHeader'
import { 
  TrendingUp, DollarSign, Users, Activity, 
  ShoppingCart, CreditCard, ArrowUpRight, Menu,
  RefreshCw, Settings, X, Check, AlertCircle, Eye, Receipt, Wallet
} from 'lucide-react'
import TransactionsTable from '@/components/TransactionsTable'
import BBPSPayment from '@/components/BBPSPayment'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { motion, AnimatePresence } from 'framer-motion'

type TabType = 'dashboard' | 'services' | 'bbps' | 'transactions' | 'customers' | 'reports' | 'settings'

function RetailerDashboardContent() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  
  const getInitialTab = (): TabType => {
    const tab = searchParams.get('tab')
    if (tab && ['dashboard', 'services', 'bbps', 'transactions', 'customers', 'reports', 'settings'].includes(tab)) {
      return tab as TabType
    }
    return 'dashboard'
  }
  
  const [activeTab, setActiveTab] = useState<TabType>(getInitialTab())
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    totalTransactions: 0,
    totalRevenue: 0,
    activeCustomers: 0,
    commissionEarned: 0,
    walletBalance: 0,
  })
  const [recentTransactions, setRecentTransactions] = useState<any[]>([])
  const [chartData, setChartData] = useState<any[]>([])

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'retailer')) {
      router.push('/business-login')
    }
  }, [user, authLoading, router])

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab && ['dashboard', 'services', 'bbps', 'transactions', 'customers', 'reports', 'settings'].includes(tab)) {
      if (tab !== activeTab) {
        setActiveTab(tab as TabType)
      }
    }
  }, [searchParams, activeTab])

  useEffect(() => {
    if (user?.role === 'retailer') {
      fetchDashboardData()
    }
  }, [user, activeTab])

  const fetchDashboardData = async () => {
    if (!user) return
    setLoading(true)
    try {
      const { data: retailerData } = await supabase
        .from('retailers')
        .select('*')
        .eq('email', user.email)
        .single()

      // Fetch wallet balance
      let walletBalance = 0
      if (user.partner_id) {
        try {
          const { data: balance } = await supabase.rpc('get_wallet_balance', {
            p_retailer_id: user.partner_id
          })
          walletBalance = balance || 0
        } catch (error) {
          console.error('Error fetching wallet balance:', error)
        }
      }

      // Mock data for demo
      setStats({
        totalTransactions: 1247,
        totalRevenue: 245680,
        activeCustomers: 342,
        commissionEarned: 2456.80,
        walletBalance,
      })

      setRecentTransactions([
        { id: 1, type: 'Recharge', amount: 500, status: 'success', date: '2024-01-15', customer: 'Customer 1' },
        { id: 2, type: 'Bill Payment', amount: 1200, status: 'success', date: '2024-01-15', customer: 'Customer 2' },
        { id: 3, type: 'Money Transfer', amount: 5000, status: 'pending', date: '2024-01-14', customer: 'Customer 3' },
        { id: 4, type: 'Recharge', amount: 299, status: 'success', date: '2024-01-14', customer: 'Customer 4' },
        { id: 5, type: 'Bill Payment', amount: 850, status: 'success', date: '2024-01-13', customer: 'Customer 5' },
      ])

      setChartData([
        { name: 'Mon', transactions: 45, revenue: 12000 },
        { name: 'Tue', transactions: 52, revenue: 15000 },
        { name: 'Wed', transactions: 48, revenue: 13000 },
        { name: 'Thu', transactions: 61, revenue: 18000 },
        { name: 'Fri', transactions: 55, revenue: 16000 },
        { name: 'Sat', transactions: 67, revenue: 20000 },
        { name: 'Sun', transactions: 58, revenue: 17000 },
      ])
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

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
      <RetailerSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      
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
                { id: 'services' as TabType, label: 'Services', icon: ShoppingCart },
                { id: 'bbps' as TabType, label: 'BBPS Payments', icon: Receipt },
                { id: 'transactions' as TabType, label: 'Transactions', icon: CreditCard },
                { id: 'customers' as TabType, label: 'Customers', icon: Users },
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
          {activeTab === 'services' && <ServicesTab />}
          {activeTab === 'bbps' && <BBPSTab />}
          {activeTab === 'transactions' && <TransactionsTable role="retailer" autoPoll={true} pollInterval={10000} />}
          {activeTab === 'customers' && <CustomersTab />}
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
          label="Active Customers"
          value={stats.activeCustomers}
          icon={Users}
          gradient="from-purple-500 to-purple-600"
          delay={0.2}
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

// BBPS Tab Component
function BBPSTab() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <BBPSPayment />
    </motion.div>
  )
}

// Services Tab Component
function ServicesTab() {
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
            <p className="text-xl font-bold text-green-600 dark:text-green-400">₹6.8L</p>
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

// Customers Tab Component
function CustomersTab() {
  const customers = [
    { id: 1, name: 'Customer 1', phone: '+91 98765 43210', transactions: 45, totalSpent: '₹12,500', lastVisit: '2024-01-15' },
    { id: 2, name: 'Customer 2', phone: '+91 98765 43211', transactions: 32, totalSpent: '₹8,900', lastVisit: '2024-01-14' },
    { id: 3, name: 'Customer 3', phone: '+91 98765 43212', transactions: 28, totalSpent: '₹7,200', lastVisit: '2024-01-13' },
  ]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden"
    >
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Customers</h3>
        <button className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700">
          Add Customer
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Name</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Phone</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Transactions</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total Spent</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Last Visit</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {customers.map((customer) => (
              <tr key={customer.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{customer.name}</td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{customer.phone}</td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-white">{customer.transactions}</td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-white">{customer.totalSpent}</td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{customer.lastVisit}</td>
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
function ReportsTab({ chartData, stats }: { chartData: any[], stats: any }) {
  return (
    <div className="space-y-4">
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
