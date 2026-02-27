'use client'

import { useState, useEffect, useMemo, useCallback, Suspense, lazy, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useGeolocation } from '@/hooks/useGeolocation'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { apiFetch, apiFetchJson } from '@/lib/api-client'
import RetailerHeader from '@/components/RetailerHeader'
import { 
  TrendingUp, DollarSign, Users, Activity, 
  ShoppingCart, CreditCard, ArrowUpRight, Menu,
  RefreshCw, Settings, X, Check, AlertCircle, Eye, Receipt, Wallet, Download,
  Send, Banknote, Lock, EyeOff, Shield, Key, Percent, Smartphone, Globe, Info,
  Network, Link2, Building2, Phone, Mail, Calendar
} from 'lucide-react'
import TransactionsTable from '@/components/TransactionsTable'
import BBPSTransactionsTable from '@/components/BBPSTransactionsTable'
import BBPSPayment from '@/components/BBPSPayment'
import PayoutTransfer from '@/components/PayoutTransfer'
import LedgerTab from '@/components/LedgerTab'
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
import POSMachinesTab from '@/components/POSMachinesTab'
import POSTransactionsTable from '@/components/POSTransactionsTable'
import ServiceTransactionReport from '@/components/ServiceTransactionReport'

type TabType = 'dashboard' | 'wallet' | 'services' | 'bbps' | 'payout' | 'transactions' | 'ledger' | 'mdr-schemes' | 'reports' | 'settings' | 'pos-machines'

function RetailerDashboardContent() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  
  const getInitialTab = (): TabType => {
    const tab = searchParams.get('tab')
    if (tab && ['dashboard', 'wallet', 'services', 'bbps', 'payout', 'transactions', 'ledger', 'mdr-schemes', 'reports', 'settings', 'pos-machines'].includes(tab)) {
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

  // Geolocation - request permission on load
  const { location: geoLocation, error: geoError, loading: geoLoading, permissionStatus, requestLocation, isSupported } = useGeolocation()
  const [geoBannerDismissed, setGeoBannerDismissed] = useState(false)
  const geoRequestedRef = useRef(false)

  useEffect(() => {
    if (!authLoading && user && isSupported && !geoRequestedRef.current) {
      geoRequestedRef.current = true
      requestLocation()
    }
  }, [authLoading, user, isSupported, requestLocation])

  const showGeoBanner = isSupported && !geoBannerDismissed && !geoLocation && (permissionStatus === 'prompt' || permissionStatus === 'denied' || geoError)

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
    if (tab && ['dashboard', 'wallet', 'services', 'bbps', 'payout', 'transactions', 'ledger', 'mdr-schemes', 'reports', 'settings', 'pos-machines'].includes(tab)) {
      if (tab !== activeTab) {
        setActiveTab(tab as TabType)
      }
    } else if (!tab && activeTab !== 'dashboard') {
      // If no tab param, default to dashboard
      setActiveTab('dashboard')
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

      // Fetch POS transactions
      let posTransactions: any[] = []
      try {
        // Get device serials for this retailer
        const { data: mappings } = await supabase
          .from('pos_device_mapping')
          .select('device_serial')
          .eq('retailer_id', user.partner_id)
          .eq('status', 'ACTIVE')

        const deviceSerials = (mappings || []).map((m: any) => m.device_serial).filter(Boolean)

        if (deviceSerials.length > 0) {
          // Fetch POS transactions for these devices
          const { data: posData } = await supabase
            .from('razorpay_pos_transactions')
            .select('*')
            .in('device_serial', deviceSerials)
            .order('transaction_time', { ascending: false })
            .limit(1000)

          posTransactions = posData || []
        }
      } catch (posError) {
        console.error('Error fetching POS transactions:', posError)
        // Continue without POS transactions if there's an error
      }

      // Combine ledger and POS transactions for stats
      const ledgerTransactions = ledgerData?.length || 0
      const posTransactionsCount = posTransactions.length
      const totalTransactions = ledgerTransactions + posTransactionsCount

      // Calculate revenue from ledger (credits)
      const ledgerRevenue = ledgerData?.reduce((sum, entry) => sum + (entry.credit || 0), 0) || 0
      // Calculate revenue from POS transactions (only successful ones)
      const posRevenue = posTransactions
        .filter(tx => (tx.display_status || tx.status || '').toUpperCase() === 'SUCCESS' || (tx.status || '').toUpperCase() === 'CAPTURED')
        .reduce((sum, tx) => sum + (parseFloat(tx.amount || 0) / 100 || 0), 0) // Amount is in paise, convert to rupees
      const totalRevenue = ledgerRevenue + posRevenue
      
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

      // Combine recent transactions from both ledger and POS
      const recentLedgerEntries = (ledgerData || []).slice(0, 5).map(entry => ({
        id: entry.id,
        type: entry.service_type || entry.transaction_type || 'Transaction',
        amount: entry.credit || entry.debit || 0,
        status: entry.status || 'completed',
        date: new Date(entry.created_at).toLocaleDateString(),
        customer: 'Customer',
        source: 'ledger',
        timestamp: new Date(entry.created_at).getTime(),
      }))

      const recentPOSEntries = posTransactions.slice(0, 5).map(tx => ({
        id: tx.txn_id || tx.id,
        type: 'POS Transaction',
        amount: parseFloat(tx.amount || 0) / 100 || 0, // Convert from paise to rupees
        status: (tx.display_status || tx.status || 'PENDING').toLowerCase(),
        date: tx.transaction_time ? new Date(tx.transaction_time).toLocaleDateString() : new Date().toLocaleDateString(),
        customer: 'POS Customer',
        source: 'pos',
        timestamp: tx.transaction_time ? new Date(tx.transaction_time).getTime() : new Date().getTime(),
      }))

      // Combine and sort by timestamp (most recent first), then take top 5
      const allRecentTransactions = [...recentLedgerEntries, ...recentPOSEntries]
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 5)
        .map(({ timestamp, source, ...rest }) => rest) // Remove internal fields

      setRecentTransactions(allRecentTransactions)

      // Calculate weekly chart data from both ledger and POS
      const now = new Date()
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      
      const weeklyLedgerData = (ledgerData || []).filter(entry => {
        const entryDate = new Date(entry.created_at)
        return entryDate >= weekAgo
      })

      const weeklyPOSData = posTransactions.filter(tx => {
        if (!tx.transaction_time) return false
        const txDate = new Date(tx.transaction_time)
        return txDate >= weekAgo
      })

      // Group by day of week
      const dayMap: Record<string, { transactions: number; revenue: number }> = {}
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      
      // Process ledger data
      weeklyLedgerData.forEach(entry => {
        const entryDate = new Date(entry.created_at)
        const dayName = dayNames[entryDate.getDay()]
        
        if (!dayMap[dayName]) {
          dayMap[dayName] = { transactions: 0, revenue: 0 }
        }
        
        dayMap[dayName].transactions += 1
        dayMap[dayName].revenue += (entry.credit || 0)
      })

      // Process POS data
      weeklyPOSData.forEach(tx => {
        const txDate = new Date(tx.transaction_time)
        const dayName = dayNames[txDate.getDay()]
        
        if (!dayMap[dayName]) {
          dayMap[dayName] = { transactions: 0, revenue: 0 }
        }
        
        // Only count successful POS transactions
        const isSuccess = (tx.display_status || tx.status || '').toUpperCase() === 'SUCCESS' || (tx.status || '').toUpperCase() === 'CAPTURED'
        if (isSuccess) {
          dayMap[dayName].transactions += 1
          dayMap[dayName].revenue += (parseFloat(tx.amount || 0) / 100 || 0) // Convert from paise to rupees
        }
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

          {/* Geolocation Permission Banner */}
          {showGeoBanner && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`mb-4 rounded-xl border p-4 flex items-start gap-3 ${
                permissionStatus === 'denied'
                  ? 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800'
                  : 'bg-amber-50 border-amber-200 dark:bg-amber-900/20 dark:border-amber-800'
              }`}
            >
              <Globe className={`w-5 h-5 mt-0.5 flex-shrink-0 ${
                permissionStatus === 'denied' ? 'text-red-500' : 'text-amber-500'
              }`} />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${
                  permissionStatus === 'denied' ? 'text-red-800 dark:text-red-300' : 'text-amber-800 dark:text-amber-300'
                }`}>
                  {permissionStatus === 'denied'
                    ? 'Location access is blocked'
                    : 'Location access required'}
                </p>
                <p className={`text-xs mt-0.5 ${
                  permissionStatus === 'denied' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'
                }`}>
                  {permissionStatus === 'denied'
                    ? 'Please enable location in your browser settings. Location is required for transaction tracking and compliance.'
                    : 'Please allow location access for secure transaction tracking and compliance.'}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {permissionStatus !== 'denied' && (
                  <button
                    onClick={requestLocation}
                    disabled={geoLoading}
                    className="px-3 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors"
                  >
                    {geoLoading ? 'Requesting...' : 'Allow Location'}
                  </button>
                )}
                <button
                  onClick={() => setGeoBannerDismissed(true)}
                  className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                  title="Dismiss"
                >
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>
            </motion.div>
          )}

          {/* Tab Content */}
          {activeTab === 'dashboard' && <DashboardTab user={user} stats={stats} chartData={chartData} recentTransactions={recentTransactions} />}
          {activeTab === 'wallet' && <WalletTab user={user} />}
          {activeTab === 'services' && <ServicesTab />}
          {activeTab === 'bbps' && <BBPSTab />}
          {activeTab === 'payout' && <PayoutTransfer title="Settlement to Bank Account" />}
          {activeTab === 'transactions' && <POSTransactionsTable autoPoll={true} pollInterval={15000} />}
          {activeTab === 'ledger' && <LedgerTab user={user} />}
          {activeTab === 'mdr-schemes' && <MDRSchemesTab user={user} />}
          {activeTab === 'pos-machines' && <POSMachinesTab user={user} accentColor="blue" />}
          {activeTab === 'reports' && <ReportsTab chartData={chartData} stats={stats} />}
          {activeTab === 'settings' && <SettingsTab user={user} />}
        </div>
      </div>
    </div>
  )
}

// Distributor Connection Card Component
function DistributorConnectionCard({ user }: { user: any }) {
  const [distributorInfo, setDistributorInfo] = useState<any>(null)
  const [schemesCount, setSchemesCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (user?.partner_id) {
      fetchDistributorInfo()
    }
  }, [user])

  const fetchDistributorInfo = async () => {
    if (!user?.partner_id) return
    setLoading(true)
    try {
      // Fetch retailer data to get distributor_id
      const { data: retailerData } = await supabase
        .from('retailers')
        .select('distributor_id, created_at')
        .eq('partner_id', user.partner_id)
        .maybeSingle()

      if (!retailerData?.distributor_id) {
        setLoading(false)
        return
      }

      // Fetch distributor information
      const { data: distributorData } = await supabase
        .from('distributors')
        .select('partner_id, name, email, phone, business_name, status, created_at')
        .eq('partner_id', retailerData.distributor_id)
        .maybeSingle()

      if (distributorData) {
        setDistributorInfo({
          ...distributorData,
          connected_at: retailerData.created_at
        })
      }

      // Fetch count of active schemes assigned by this distributor
      const { data: schemesData } = await supabase
        .from('scheme_mappings')
        .select('id', { count: 'exact' })
        .eq('entity_id', user.partner_id)
        .eq('entity_role', 'retailer')
        .eq('assigned_by_id', retailerData.distributor_id)
        .eq('status', 'active')

      setSchemesCount(schemesData?.length || 0)
    } catch (error) {
      console.error('Error fetching distributor info:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-4 mb-4"
      >
        <div className="flex items-center justify-center py-4">
          <RefreshCw className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      </motion.div>
    )
  }

  if (!distributorInfo) {
    return null
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 border-2 border-purple-200 dark:border-purple-800 rounded-xl shadow-lg p-6 mb-4"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
            <Network className="w-6 h-6 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
              Connected to Distributor
              <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 text-xs font-semibold rounded-full flex items-center gap-1">
                <Check className="w-3 h-3" />
                Active
              </span>
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              You are assigned and managed by your distributor
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-purple-100 dark:border-purple-900/30">
          <div className="flex items-center gap-2 mb-2">
            <Building2 className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Distributor Name</span>
          </div>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">
            {distributorInfo.business_name || distributorInfo.name}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Partner ID: {distributorInfo.partner_id}
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-purple-100 dark:border-purple-900/30">
          <div className="flex items-center gap-2 mb-2">
            <Link2 className="w-4 h-4 text-purple-600 dark:text-purple-400" />
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Active Schemes</span>
          </div>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">
            {schemesCount} {schemesCount === 1 ? 'Scheme' : 'Schemes'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Assigned by distributor
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex items-center gap-3 text-sm">
          <Mail className="w-4 h-4 text-gray-400" />
          <div>
            <span className="text-gray-500 dark:text-gray-400">Email: </span>
            <span className="text-gray-900 dark:text-white font-medium">{distributorInfo.email}</span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Phone className="w-4 h-4 text-gray-400" />
          <div>
            <span className="text-gray-500 dark:text-gray-400">Phone: </span>
            <span className="text-gray-900 dark:text-white font-medium">{distributorInfo.phone}</span>
          </div>
        </div>
        {distributorInfo.connected_at && (
          <div className="flex items-center gap-3 text-sm">
            <Calendar className="w-4 h-4 text-gray-400" />
            <div>
              <span className="text-gray-500 dark:text-gray-400">Connected: </span>
              <span className="text-gray-900 dark:text-white font-medium">
                {new Date(distributorInfo.connected_at).toLocaleDateString('en-IN', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </span>
            </div>
          </div>
        )}
        <div className="flex items-center gap-3 text-sm">
          <div className="w-2 h-2 rounded-full bg-green-500"></div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">Status: </span>
            <span className="text-gray-900 dark:text-white font-medium capitalize">{distributorInfo.status}</span>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// Dashboard Tab Component
function DashboardTab({ user, stats, chartData, recentTransactions }: { user: any, stats: any, chartData: any[], recentTransactions: any[] }) {
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


// Transactions Tab Component (legacy)
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
  const [settlementLimitTier, setSettlementLimitTier] = useState<number>(100000)
  const [settlementAmountError, setSettlementAmountError] = useState<string | null>(null)
  const [bankDetails, setBankDetails] = useState({
    account_number: '',
    ifsc: '',
    account_name: ''
  })

  useEffect(() => {
    fetchWalletData()
    fetchSettlementLimit()
  }, [user])

  // Fetch settlement limit tier for the retailer
  const fetchSettlementLimit = async () => {
    if (!user?.partner_id) return
    try {
      const { data, error } = await supabase
        .from('retailers')
        .select('settlement_limit_tier')
        .eq('partner_id', user.partner_id)
        .single()
      
      if (!error && data?.settlement_limit_tier) {
        setSettlementLimitTier(parseFloat(data.settlement_limit_tier.toString()))
      }
    } catch (err) {
      console.error('Error fetching settlement limit:', err)
    }
  }

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

    const amount = parseFloat(settlementAmount)
    
    // Check settlement limit tier
    if (amount > settlementLimitTier) {
      alert(`Amount exceeds your settlement limit of ₹${settlementLimitTier.toLocaleString('en-IN')}. Please contact admin to increase your limit.`)
      setSettlementAmountError(`Amount exceeds your settlement limit of ₹${settlementLimitTier.toLocaleString('en-IN')}`)
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
                  onChange={(e) => {
                    const value = e.target.value
                    if (value === '' || /^\d*\.?\d*$/.test(value)) {
                      setSettlementAmount(value)
                      setSettlementAmountError(null)
                    }
                  }}
                  onBlur={() => {
                    const numValue = parseFloat(settlementAmount)
                    if (settlementAmount && !isNaN(numValue)) {
                      if (numValue > settlementLimitTier) {
                        setSettlementAmountError(`Amount exceeds your settlement limit of ₹${settlementLimitTier.toLocaleString('en-IN')}. Please contact admin to increase your limit.`)
                      } else if (numValue <= 0) {
                        setSettlementAmountError('Amount must be greater than 0')
                      } else {
                        setSettlementAmountError(null)
                      }
                    }
                  }}
                  className={`w-full px-4 py-2 border rounded-lg ${
                    settlementAmountError ? 'border-red-500' : ''
                  }`}
                  placeholder="Enter amount"
                  max={settlementLimitTier}
                  min="1"
                />
                {settlementAmountError && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    {settlementAmountError}
                  </p>
                )}
                <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-xs">
                  <span className="text-blue-800 dark:text-blue-300 font-medium">
                    Your Settlement Payment Limit: ₹{settlementLimitTier.toLocaleString('en-IN')}
                  </span>
                  {settlementLimitTier > 100000 && (
                    <span className="ml-2 text-blue-600 dark:text-blue-400">
                      (Enhanced limit enabled)
                    </span>
                  )}
                </div>
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
      {/* Service Transaction Report */}
      <ServiceTransactionReport userRole="retailer" userName={user?.name || user?.email} />

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

// Settings Tab Component with TPIN Management
// MDR Schemes Tab Component
function MDRSchemesTab({ user }: { user: any }) {
  const [loading, setLoading] = useState(false)
  const [customSchemes, setCustomSchemes] = useState<any[]>([])
  const [globalSchemes, setGlobalSchemes] = useState<any[]>([])
  const [applicableSchemes, setApplicableSchemes] = useState<any[]>([])

  useEffect(() => {
    if (user?.partner_id) {
      fetchSchemes()
    }
  }, [user])

  const fetchSchemes = async () => {
    if (!user?.partner_id) {
      console.warn('MDR Schemes: No partner_id found for user')
      return
    }
    setLoading(true)
    try {
      // Fetch schemes mapped to this retailer from scheme_mappings
      const { data: mappingsData, error: mappingsError } = await supabase
        .from('scheme_mappings')
        .select(`
          *,
          scheme:schemes (
            id,
            name,
            description,
            scheme_type,
            service_scope,
            status,
            priority,
            effective_from,
            effective_to,
            bbps_commissions:scheme_bbps_commissions (*),
            payout_charges:scheme_payout_charges (*),
            mdr_rates:scheme_mdr_rates (*)
          )
        `)
        .eq('entity_id', user.partner_id)
        .eq('entity_role', 'retailer')
        .eq('status', 'active')
        .order('priority', { ascending: true })

      if (mappingsError) {
        console.error('Error fetching scheme mappings:', mappingsError)
        throw mappingsError
      }

      // Extract schemes from mappings (only show schemes that are explicitly mapped to this retailer)
      const now = new Date()
      const mappedSchemes = (mappingsData || []).map((m: any) => ({
        ...m.scheme,
        mapping_id: m.id,
        mapping_effective_from: m.effective_from, // Effective date from mapping
        mapping_effective_to: m.effective_to,
        assigned_by: m.assigned_by_id,
        assigned_by_role: m.assigned_by_role,
      })).filter((s: any) => {
        if (!s || !s.id) return false
        // Filter out expired mappings (effective_to has passed)
        if (s.mapping_effective_to && new Date(s.mapping_effective_to) < now) return false
        // Filter out not-yet-active mappings (effective_from is in the future)
        if (s.mapping_effective_from && new Date(s.mapping_effective_from) > now) return false
        // Filter out expired schemes
        if (s.effective_to && new Date(s.effective_to) < now) return false
        // Filter out not-yet-active schemes
        if (s.effective_from && new Date(s.effective_from) > now) return false
        // Only show active schemes
        if (s.status !== 'active') return false
        return true
      })

      // Separate custom and global schemes from mappings
      const customSchemesList = mappedSchemes.filter((s: any) => s.scheme_type === 'custom')
      const globalSchemesList = mappedSchemes.filter((s: any) => s.scheme_type === 'global')

      setCustomSchemes(customSchemesList || [])
      setGlobalSchemes(globalSchemesList || [])

      // Build applicable schemes from MDR rates (only from explicitly mapped schemes)
      const applicable: any[] = []
      
      // Get all MDR rates from mapped schemes (both custom and global that are mapped)
      const mappedMdrRates: any[] = []
      mappedSchemes.forEach((scheme: any) => {
        if (scheme.mdr_rates && scheme.mdr_rates.length > 0) {
          scheme.mdr_rates.forEach((rate: any) => {
            mappedMdrRates.push({
              ...rate,
              scheme_name: scheme.name,
              scheme_type: scheme.scheme_type,
              source: scheme.scheme_type === 'global' ? 'Global Scheme (Mapped)' : 'Custom Scheme (Mapped)'
            })
          })
        }
      })
      
      // Deduplicate by mode, card_type, and brand_type (mapped schemes take priority)
      const uniqueRates = mappedMdrRates.filter((rate, index, self) =>
        index === self.findIndex(r => 
          r.mode === rate.mode && 
          r.card_type === rate.card_type && 
          r.brand_type === rate.brand_type
        )
      )
      
      applicable.push(...uniqueRates)

      // Remove duplicates
      const uniqueApplicable = applicable.filter((scheme, index, self) =>
        index === self.findIndex(s => 
          s.mode === scheme.mode && 
          s.card_type === scheme.card_type && 
          s.brand_type === scheme.brand_type
        )
      )

      setApplicableSchemes(uniqueApplicable)
    } catch (error) {
      console.error('Error fetching schemes:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Distributor Connection Card */}
      <DistributorConnectionCard user={user} />
      
      {/* Info Banner */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4"
      >
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <h3 className="font-semibold text-blue-900 dark:text-blue-200 mb-1">Scheme Information</h3>
            <p className="text-sm text-blue-800 dark:text-blue-300">
              Your charges and rates (MDR, BBPS, Payout) are determined by schemes assigned to you by your distributor. 
              Only schemes that are mapped to your account are shown here. These charges are automatically applied during transactions.
            </p>
          </div>
        </div>
      </motion.div>

      {/* Applicable Schemes */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white">Applicable MDR Schemes</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">Schemes that will be used for your transactions</p>
          </div>
          <button
            onClick={fetchSchemes}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-gray-400">Loading schemes...</p>
          </div>
        ) : applicableSchemes.length === 0 ? (
          <div className="text-center py-12">
            <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 dark:text-gray-400">No applicable schemes found</p>
            <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
              Contact your distributor or admin to set up MDR schemes
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {applicableSchemes.map((scheme, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.1 }}
                className={`border-2 rounded-xl p-5 ${
                  scheme.scheme_type === 'custom'
                    ? 'border-purple-300 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/20'
                    : 'border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20'
                }`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-2 flex-1">
                    {scheme.mode === 'CARD' ? (
                      <CreditCard className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    ) : (
                      <Smartphone className="w-5 h-5 text-green-600 dark:text-green-400" />
                    )}
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-gray-900 dark:text-white">
                        {scheme.mode}
                        {scheme.mode === 'CARD' && scheme.card_type && (
                          <span className="ml-2 text-sm font-normal text-gray-600 dark:text-gray-400">
                            {scheme.display_card_type || scheme.card_type}
                          </span>
                        )}
                      </h4>
                      {scheme.brand_type && (
                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                          Brand: {scheme.display_brand_type || scheme.brand_type}
                        </p>
                      )}
                      {scheme.mode === 'CARD' && !scheme.card_type && (
                        <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">All Card Types</p>
                      )}
                    </div>
                  </div>
                  <span className={`px-2 py-1 text-xs rounded-full flex-shrink-0 ${
                    scheme.scheme_type === 'custom'
                      ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                      : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                  }`}>
                    {scheme.scheme_type === 'custom' ? 'Custom' : 'Global'}
                  </span>
                </div>

                <div className="space-y-3">
                  <div className="bg-white dark:bg-gray-700 rounded-lg p-3">
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Source</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{scheme.source}</p>
                    {scheme.scheme_name && (
                      <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">Scheme: {scheme.scheme_name}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white dark:bg-gray-700 rounded-lg p-3">
                      <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Retailer MDR T+1</p>
                      <p className="text-lg font-bold text-gray-900 dark:text-white">
                        {scheme.retailer_mdr_t1 !== null && scheme.retailer_mdr_t1 !== undefined 
                          ? `${scheme.retailer_mdr_t1}%` 
                          : scheme.rt_mdr_t1 !== null && scheme.rt_mdr_t1 !== undefined 
                          ? `${scheme.rt_mdr_t1}%` 
                          : 'N/A'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Next-day settlement</p>
                    </div>
                    <div className="bg-white dark:bg-gray-700 rounded-lg p-3 border-2 border-green-300 dark:border-green-700">
                      <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Retailer MDR T+0</p>
                      <p className="text-lg font-bold text-green-600 dark:text-green-400">
                        {scheme.retailer_mdr_t0 !== null && scheme.retailer_mdr_t0 !== undefined 
                          ? `${scheme.retailer_mdr_t0}%` 
                          : scheme.rt_mdr_t0 !== null && scheme.rt_mdr_t0 !== undefined 
                          ? `${scheme.rt_mdr_t0}%` 
                          : 'N/A'}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Instant settlement</p>
                    </div>
                  </div>

                  <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-3">
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Distributor MDR</p>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-700 dark:text-gray-300">
                        T+1: {scheme.distributor_mdr_t1 !== null && scheme.distributor_mdr_t1 !== undefined 
                          ? `${scheme.distributor_mdr_t1}%` 
                          : scheme.dt_mdr_t1 !== null && scheme.dt_mdr_t1 !== undefined 
                          ? `${scheme.dt_mdr_t1}%` 
                          : 'N/A'}
                      </span>
                      <span className="text-gray-700 dark:text-gray-300">
                        T+0: {scheme.distributor_mdr_t0 !== null && scheme.distributor_mdr_t0 !== undefined 
                          ? `${scheme.distributor_mdr_t0}%` 
                          : scheme.dt_mdr_t0 !== null && scheme.dt_mdr_t0 !== undefined 
                          ? `${scheme.dt_mdr_t0}%` 
                          : 'N/A'}
                      </span>
                    </div>
                  </div>

                  {/* Additional Details */}
                  {(scheme.effective_date || scheme.card_type || scheme.brand_type) && (
                    <div className="bg-white dark:bg-gray-700 rounded-lg p-3 border border-gray-200 dark:border-gray-600">
                      <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">Additional Details</p>
                      <div className="space-y-1 text-xs">
                        {scheme.effective_date && (
                          <div className="flex justify-between">
                            <span className="text-gray-500 dark:text-gray-400">Effective Date:</span>
                            <span className="text-gray-900 dark:text-white font-medium">
                              {new Date(scheme.effective_date).toLocaleDateString('en-IN')}
                            </span>
                          </div>
                        )}
                        {scheme.mode === 'CARD' && scheme.card_type && (
                          <div className="flex justify-between">
                            <span className="text-gray-500 dark:text-gray-400">Card Type:</span>
                            <span className="text-gray-900 dark:text-white font-medium">
                              {scheme.display_card_type || scheme.card_type}
                            </span>
                          </div>
                        )}
                        {scheme.brand_type && (
                          <div className="flex justify-between">
                            <span className="text-gray-500 dark:text-gray-400">Brand:</span>
                            <span className="text-gray-900 dark:text-white font-medium">
                              {scheme.display_brand_type || scheme.brand_type}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Custom Schemes Detail */}
      {customSchemes.length > 0 && (() => {
        // Extract all MDR rates from custom schemes for the table
        const customMdrRates: any[] = []
        customSchemes.forEach((scheme: any) => {
          if (scheme.mdr_rates && Array.isArray(scheme.mdr_rates) && scheme.mdr_rates.length > 0) {
            scheme.mdr_rates.forEach((rate: any) => {
              if (rate && rate.status === 'active') {
                // Determine effective date: mapping > scheme > rate created_at
                const effectiveDate = scheme.mapping_effective_from || scheme.effective_from || rate.created_at
                customMdrRates.push({
                  ...rate,
                  scheme_name: scheme.name,
                  scheme_id: scheme.id,
                  effective_date: effectiveDate
                })
              }
            })
          }
        })

        return (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
          >
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">Custom Schemes (From Distributor)</h3>
            {customMdrRates.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 dark:bg-gray-700">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Mode</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Card Type</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Brand</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">RT MDR T+1</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">RT MDR T+0</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Effective Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {customMdrRates.map((rate, index) => (
                      <tr key={`${rate.scheme_id}-${rate.id || index}`} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-4 py-3 text-sm font-medium">{rate.mode || '-'}</td>
                        <td className="px-4 py-3 text-sm">{rate.display_card_type || rate.card_type || '-'}</td>
                        <td className="px-4 py-3 text-sm">{rate.display_brand_type || rate.brand_type || '-'}</td>
                        <td className="px-4 py-3 text-sm font-medium">
                          {rate.retailer_mdr_t1 !== null && rate.retailer_mdr_t1 !== undefined 
                            ? `${rate.retailer_mdr_t1}%` 
                            : rate.rt_mdr_t1 !== null && rate.rt_mdr_t1 !== undefined 
                            ? `${rate.rt_mdr_t1}%` 
                            : '-'}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-green-600 dark:text-green-400">
                          {rate.retailer_mdr_t0 !== null && rate.retailer_mdr_t0 !== undefined 
                            ? `${rate.retailer_mdr_t0}%` 
                            : rate.rt_mdr_t0 !== null && rate.rt_mdr_t0 !== undefined 
                            ? `${rate.rt_mdr_t0}%` 
                            : '-'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                          {rate.effective_date ? new Date(rate.effective_date).toLocaleDateString('en-IN') : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8">
                <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600 dark:text-gray-400">No MDR rates configured for custom schemes</p>
                <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
                  Contact your distributor to configure MDR rates for the assigned schemes
                </p>
              </div>
            )}
          </motion.div>
        )
      })()}

      {/* BBPS Charges Section */}
      {(() => {
        const allBbpsCharges: any[] = []
        const allSchemes = [...customSchemes, ...globalSchemes]
        allSchemes.forEach((scheme: any) => {
          if (scheme.bbps_commissions && Array.isArray(scheme.bbps_commissions) && scheme.bbps_commissions.length > 0) {
            scheme.bbps_commissions.forEach((comm: any) => {
              if (comm && comm.status === 'active') {
                allBbpsCharges.push({
                  ...comm,
                  scheme_name: scheme.name,
                  scheme_type: scheme.scheme_type,
                  effective_date: scheme.mapping_effective_from || scheme.effective_from || comm.created_at,
                })
              }
            })
          }
        })

        if (allBbpsCharges.length === 0) return null

        return (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
          >
            <div className="flex items-center gap-2 mb-4">
              <Receipt className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">BBPS Charges</h3>
              <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 px-2 py-0.5 rounded-full">From Scheme</span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Transaction charges applicable for BBPS bill payments</p>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Category</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Amount Range</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Your Charge</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Your Commission</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Scheme</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Effective</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {allBbpsCharges.map((charge, index) => (
                    <tr key={charge.id || index} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-4 py-3 text-sm">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          !charge.category || charge.category === '' || charge.category.toLowerCase() === 'all'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                            : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                        }`}>
                          {!charge.category || charge.category === '' || charge.category.toLowerCase() === 'all' 
                            ? 'All Categories' 
                            : charge.category}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                        ₹{Number(charge.min_amount).toLocaleString('en-IN')} – ₹{Number(charge.max_amount).toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-red-600 dark:text-red-400">
                        {charge.retailer_charge_type === 'percentage' 
                          ? `${charge.retailer_charge}%` 
                          : `₹${Number(charge.retailer_charge).toLocaleString('en-IN')}`}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-green-600 dark:text-green-400">
                        {Number(charge.retailer_commission) > 0
                          ? charge.retailer_commission_type === 'percentage' 
                            ? `${charge.retailer_commission}%` 
                            : `₹${Number(charge.retailer_commission).toLocaleString('en-IN')}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{charge.scheme_name}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                        {charge.effective_date ? new Date(charge.effective_date).toLocaleDateString('en-IN') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )
      })()}

      {/* Payout / Settlement Charges Section */}
      {(() => {
        const allPayoutCharges: any[] = []
        const allSchemes = [...customSchemes, ...globalSchemes]
        allSchemes.forEach((scheme: any) => {
          if (scheme.payout_charges && Array.isArray(scheme.payout_charges) && scheme.payout_charges.length > 0) {
            scheme.payout_charges.forEach((charge: any) => {
              if (charge && charge.status === 'active') {
                allPayoutCharges.push({
                  ...charge,
                  scheme_name: scheme.name,
                  scheme_type: scheme.scheme_type,
                  effective_date: scheme.mapping_effective_from || scheme.effective_from || charge.created_at,
                })
              }
            })
          }
        })

        if (allPayoutCharges.length === 0) return null

        // Sort: IMPS first, then NEFT, then by amount range
        allPayoutCharges.sort((a, b) => {
          if (a.transfer_mode !== b.transfer_mode) return a.transfer_mode === 'IMPS' ? -1 : 1
          return (a.min_amount || 0) - (b.min_amount || 0)
        })

        return (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
          >
            <div className="flex items-center gap-2 mb-4">
              <Banknote className="w-5 h-5 text-green-600 dark:text-green-400" />
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Payout / Settlement Charges</h3>
              <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 px-2 py-0.5 rounded-full">From Scheme</span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Charges for bank settlements (IMPS & NEFT transfers)</p>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Transfer Mode</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Amount Range</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Your Charge</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Your Commission</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Scheme</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Effective</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {allPayoutCharges.map((charge, index) => (
                    <tr key={charge.id || index} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-4 py-3 text-sm">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold ${
                          charge.transfer_mode === 'IMPS'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
                        }`}>
                          {charge.transfer_mode}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                        ₹{Number(charge.min_amount).toLocaleString('en-IN')} – ₹{Number(charge.max_amount).toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-red-600 dark:text-red-400">
                        {charge.retailer_charge_type === 'percentage' 
                          ? `${charge.retailer_charge}%` 
                          : `₹${Number(charge.retailer_charge).toLocaleString('en-IN')}`}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-green-600 dark:text-green-400">
                        {Number(charge.retailer_commission) > 0
                          ? charge.retailer_commission_type === 'percentage' 
                            ? `${charge.retailer_commission}%` 
                            : `₹${Number(charge.retailer_commission).toLocaleString('en-IN')}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{charge.scheme_name}</td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                        {charge.effective_date ? new Date(charge.effective_date).toLocaleDateString('en-IN') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )
      })()}

      {/* Settlement Type Info */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border border-green-200 dark:border-green-800 rounded-xl p-6"
      >
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Info className="w-5 h-5 text-green-600 dark:text-green-400" />
          Settlement Types Explained
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-green-200 dark:border-green-700">
            <h4 className="font-semibold text-gray-900 dark:text-white mb-2">T+1 Settlement (Next-Day)</h4>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              Your wallet is credited the next business day after the transaction.
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500">
              Lower MDR rate • Standard processing
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border-2 border-green-300 dark:border-green-600">
            <h4 className="font-semibold text-gray-900 dark:text-white mb-2">T+0 Settlement (Instant)</h4>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              Your wallet is credited immediately after the transaction is captured.
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500">
              Higher MDR rate • Instant processing
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

function SettingsTab({ user }: { user: any }) {
  const [tpinStatus, setTpinStatus] = useState<{
    tpin_enabled: boolean
    is_locked: boolean
    locked_until: string | null
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [showTpinSetup, setShowTpinSetup] = useState(false)
  const [currentTpin, setCurrentTpin] = useState('')
  const [newTpin, setNewTpin] = useState('')
  const [confirmTpin, setConfirmTpin] = useState('')
  const [showCurrentTpin, setShowCurrentTpin] = useState(false)
  const [showNewTpin, setShowNewTpin] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    fetchTpinStatus()
  }, [user])

  const fetchTpinStatus = async () => {
    if (!user?.partner_id) return
    setLoading(true)
    try {
      const response = await apiFetchJson(`/api/tpin?user_id=${user.partner_id}`)
      if (response.success) {
        setTpinStatus({
          tpin_enabled: response.tpin_enabled,
          is_locked: response.is_locked,
          locked_until: response.locked_until,
        })
      }
    } catch (error) {
      console.error('Error fetching TPIN status:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSetTpin = async () => {
    setMessage(null)
    
    if (newTpin.length !== 4) {
      setMessage({ type: 'error', text: 'TPIN must be exactly 4 digits' })
      return
    }
    
    if (newTpin !== confirmTpin) {
      setMessage({ type: 'error', text: 'New TPIN and confirmation do not match' })
      return
    }
    
    // If TPIN is already set, require current TPIN
    if (tpinStatus?.tpin_enabled && !currentTpin) {
      setMessage({ type: 'error', text: 'Current TPIN is required to change TPIN' })
      return
    }

    setSaving(true)
    try {
      const response = await apiFetchJson('/api/tpin', {
        method: 'POST',
        body: JSON.stringify({
          tpin: newTpin,
          current_tpin: tpinStatus?.tpin_enabled ? currentTpin : undefined,
          user_id: user.partner_id,
        }),
      })

      if (response.success) {
        setMessage({ type: 'success', text: response.message || 'TPIN set successfully!' })
        setShowTpinSetup(false)
        setCurrentTpin('')
        setNewTpin('')
        setConfirmTpin('')
        fetchTpinStatus()
      } else {
        setMessage({ type: 'error', text: response.error || 'Failed to set TPIN' })
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'Failed to set TPIN' })
    } finally {
      setSaving(false)
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
      {/* TPIN Settings Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
            <Shield className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Transaction PIN (TPIN)</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Secure your transactions with a 4-digit PIN
            </p>
          </div>
        </div>

        {message && (
          <div className={`mb-4 p-3 rounded-lg flex items-center gap-2 ${
            message.type === 'success' 
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' 
              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
          }`}>
            {message.type === 'success' ? <Check className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            {message.text}
          </div>
        )}

        {/* TPIN Status */}
        <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Key className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              <div>
                <p className="font-medium text-gray-900 dark:text-white">TPIN Status</p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {tpinStatus?.tpin_enabled ? 'Your TPIN is set and active' : 'TPIN not configured'}
                </p>
              </div>
            </div>
            <span className={`px-3 py-1 text-sm rounded-full ${
              tpinStatus?.tpin_enabled
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
            }`}>
              {tpinStatus?.tpin_enabled ? 'Active' : 'Not Set'}
            </span>
          </div>

          {tpinStatus?.is_locked && (
            <div className="mt-3 p-2 bg-red-50 dark:bg-red-900/20 rounded text-red-700 dark:text-red-400 text-sm flex items-center gap-2">
              <Lock className="w-4 h-4" />
              Account locked due to failed attempts. Try again after {new Date(tpinStatus.locked_until!).toLocaleTimeString()}
            </div>
          )}
        </div>

        {/* Set/Change TPIN Section */}
        {!showTpinSetup ? (
          <button
            onClick={() => setShowTpinSetup(true)}
            disabled={tpinStatus?.is_locked}
            className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Key className="w-5 h-5" />
            {tpinStatus?.tpin_enabled ? 'Change TPIN' : 'Set Up TPIN'}
          </button>
        ) : (
          <div className="space-y-4">
            {/* Current TPIN (if already set) */}
            {tpinStatus?.tpin_enabled && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Current TPIN
                </label>
                <div className="relative">
                  <input
                    type={showCurrentTpin ? 'text' : 'password'}
                    value={currentTpin}
                    onChange={(e) => setCurrentTpin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="Enter current TPIN"
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white pr-10"
                    maxLength={4}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentTpin(!showCurrentTpin)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    {showCurrentTpin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            )}

            {/* New TPIN */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                New TPIN (4 digits)
              </label>
              <div className="relative">
                <input
                  type={showNewTpin ? 'text' : 'password'}
                  value={newTpin}
                  onChange={(e) => setNewTpin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="Enter new 4-digit TPIN"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white pr-10"
                  maxLength={4}
                />
                <button
                  type="button"
                  onClick={() => setShowNewTpin(!showNewTpin)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  {showNewTpin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Confirm TPIN */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Confirm TPIN
              </label>
              <input
                type="password"
                value={confirmTpin}
                onChange={(e) => setConfirmTpin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="Re-enter new TPIN"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                maxLength={4}
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowTpinSetup(false)
                  setCurrentTpin('')
                  setNewTpin('')
                  setConfirmTpin('')
                  setMessage(null)
                }}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSetTpin}
                disabled={saving || newTpin.length !== 4 || newTpin !== confirmTpin}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    {tpinStatus?.tpin_enabled ? 'Change TPIN' : 'Set TPIN'}
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Info Text */}
        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <h4 className="font-medium text-blue-800 dark:text-blue-300 mb-2">Why use TPIN?</h4>
          <ul className="text-sm text-blue-700 dark:text-blue-400 space-y-1">
            <li>• Required for all settlement/payout transactions</li>
            <li>• Adds extra security layer to your transactions</li>
            <li>• Protects against unauthorized access</li>
            <li>• Account locks after 5 failed attempts for 15 minutes</li>
          </ul>
        </div>
      </motion.div>

      {/* Profile Settings Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6"
      >
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Profile Information</h3>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-400">Name</label>
              <p className="font-medium text-gray-900 dark:text-white">{user?.name || 'N/A'}</p>
            </div>
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-400">Partner ID</label>
              <p className="font-medium text-gray-900 dark:text-white">{user?.partner_id || 'N/A'}</p>
            </div>
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-400">Email</label>
              <p className="font-medium text-gray-900 dark:text-white">{user?.email || 'N/A'}</p>
            </div>
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-400">Role</label>
              <p className="font-medium text-gray-900 dark:text-white capitalize">{user?.role || 'N/A'}</p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
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
