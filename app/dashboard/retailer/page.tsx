'use client'

import { useState, useEffect, useMemo, useCallback, Suspense, lazy, useRef } from 'react'
import { useToast } from '@/components/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useGeolocation } from '@/hooks/useGeolocation'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import { apiFetch, apiFetchJson, newIdempotencyKey } from '@/lib/api-client'
import RetailerHeader from '@/components/RetailerHeader'
import { 
  TrendingUp, DollarSign, Users, Activity, 
  ShoppingCart, CreditCard, ArrowUpRight, Menu,
  RefreshCw, Settings, X, Check, AlertCircle, Eye, Receipt, Wallet, Download,
  Send, Banknote, Lock, EyeOff, Shield, Key, Percent, Smartphone, Globe, Info,
  Network, Link2, Building2, Phone, Mail, Calendar, Fingerprint
} from 'lucide-react'
import TransactionsTable from '@/components/TransactionsTable'
import BBPSTransactionsTable from '@/components/BBPSTransactionsTable'
import BBPSPayment from '@/components/BBPSPayment'
import Pay2NewServiceHub from '@/components/Pay2NewServiceHub'
import Pay2NewServiceFlow from '@/components/Pay2NewServiceFlow'
import { BBPS_CATEGORY_GROUPS } from '@/lib/bbps/category-groups'
import PayoutTransfer from '@/components/PayoutTransfer'
import ShadvalPayTransfer from '@/components/ShadvalPayTransfer'
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
import PosBridgePanel from '@/components/PosBridgePanel'
import ServiceTransactionReport from '@/components/ServiceTransactionReport'
import PartnerSubscriptionsTab from '@/components/PartnerSubscriptionsTab'
import AEPSDashboard from '@/components/AEPSDashboard'
import AEPSWalletLedger from '@/components/AEPSWalletLedger'
import AEPSTransactionHistory from '@/components/AEPSTransactionHistory'

type TabType = 'dashboard' | 'wallet' | 'services' | 'aeps' | 'bbps' | 'bbps-2' | 'credit-card' | 'payout' | 'settlement-2' | 'transactions' | 'ledger' | 'aeps-ledger' | 'mdr-schemes' | 'reports' | 'settings' | 'pos-machines' | 'subscriptions'

function RetailerDashboardContent() {
  const { user, loading: authLoading } = useAuth()
  const { showToast } = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  
  const getInitialTab = (): TabType => {
    const tab = searchParams?.get('tab')
    if (tab && ['dashboard', 'wallet', 'services', 'aeps', 'bbps', 'bbps-2', 'credit-card', 'payout', 'settlement-2', 'transactions', 'ledger', 'aeps-ledger', 'mdr-schemes', 'reports', 'settings', 'pos-machines', 'subscriptions'].includes(tab)) {
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
    aepsWalletBalance: 0,
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
    const tab = searchParams?.get('tab')
    if (tab && ['dashboard', 'wallet', 'services', 'aeps', 'bbps', 'bbps-2', 'credit-card', 'payout', 'settlement-2', 'transactions', 'ledger', 'aeps-ledger', 'mdr-schemes', 'reports', 'settings', 'pos-machines', 'subscriptions'].includes(tab)) {
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

      // Fetch wallet balances (non-blocking with timeout - don't fail if function doesn't exist yet)
      let walletBalance = 0
      let aepsWalletBalance = 0
      if (user.partner_id) {
        const walletTimeout = new Promise((resolve) => 
          setTimeout(() => resolve({ data: null, error: { message: 'Timeout' } }), 3000)
        )

        try {
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
          }
        } catch {
          if (user.role === 'retailer') {
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
          }
        }

        try {
          const aepsBalanceResult = await Promise.race([
            supabase.rpc('get_wallet_balance_v2', {
              p_user_id: user.partner_id,
              p_wallet_type: 'aeps'
            }),
            walletTimeout
          ]) as any
          aepsWalletBalance = aepsBalanceResult?.data || 0
        } catch {
          aepsWalletBalance = 0
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

      // POS transactions: same source as /api/razorpay/transactions (mapping + pos_machines, RLS-safe)
      let posTransactions: any[] = []
      try {
        if (user.partner_id) {
          const res = await apiFetch('/api/razorpay/transactions?page=1&limit=1000')
          if (res.ok) {
            const json = await res.json()
            posTransactions = Array.isArray(json.data) ? json.data : []
          }
        }
      } catch (posError) {
        console.error('Error fetching POS transactions:', posError)
      }

      const posAmountRupees = (tx: any) => {
        const n = parseFloat(String(tx?.amount ?? 0))
        return Number.isFinite(n) ? n : 0
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
        .reduce((sum, tx) => sum + posAmountRupees(tx), 0)
      const totalRevenue = ledgerRevenue + posRevenue
      
      // Fetch commission data
      const { data: commissionData } = await supabase
        .from('commission_ledger')
        .select('rt_amount')
        .eq('rt_user_id', user.partner_id)

      const commissionEarned = commissionData?.reduce((sum, entry) => sum + (entry.rt_amount || 0), 0) || 0

      setStats({
        totalTransactions,
        totalRevenue,
        commissionEarned,
        walletBalance,
        aepsWalletBalance,
      })

      // Combine recent transactions from both ledger and POS
      const recentLedgerEntries = (ledgerData || []).slice(0, 5).map(entry => ({
        id: entry.id,
        type: entry.service_type || entry.transaction_type || 'Transaction',
        amount: entry.credit || entry.debit || 0,
        status: entry.status || 'completed',
        date: new Date(entry.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
        customer: 'Customer',
        source: 'ledger',
        timestamp: new Date(entry.created_at).getTime(),
      }))

      const recentPOSEntries = posTransactions.slice(0, 5).map(tx => ({
        id: tx.txn_id || tx.id,
        type: 'POS Transaction',
        amount: posAmountRupees(tx),
        status: (tx.display_status || tx.status || 'PENDING').toLowerCase(),
        date: tx.transaction_time ? new Date(tx.transaction_time).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }),
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
          dayMap[dayName].revenue += posAmountRupees(tx)
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
        aepsWalletBalance: 0,
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
      setLoading(false)
    }
  }, [user, authLoading, fetchDashboardData])

  // Re-fetch wallet balances when returning to dashboard tab
  useEffect(() => {
    if (activeTab === 'dashboard' && user?.partner_id) {
      const refreshBalances = async () => {
        const walletTimeout = new Promise((resolve) =>
          setTimeout(() => resolve({ data: null, error: { message: 'Timeout' } }), 3000)
        )
        try {
          const [primaryRes, aepsRes] = await Promise.all([
            Promise.race([
              supabase.rpc('get_wallet_balance_v2', { p_user_id: user.partner_id, p_wallet_type: 'primary' }),
              walletTimeout,
            ]),
            Promise.race([
              supabase.rpc('get_wallet_balance_v2', { p_user_id: user.partner_id, p_wallet_type: 'aeps' }),
              walletTimeout,
            ]),
          ]) as any[]
          setStats(prev => ({
            ...prev,
            walletBalance: primaryRes?.data ?? prev.walletBalance,
            aepsWalletBalance: aepsRes?.data ?? prev.aepsWalletBalance,
          }))
        } catch {
          showToast('Failed to refresh wallet balances', 'error')
        }

        try {
          const { data: aepsCommData } = await supabase
            .from('commission_ledger')
            .select('rt_amount')
            .eq('rt_user_id', user.partner_id)
          const totalCommission = aepsCommData?.reduce((sum: number, e: any) => sum + (e.rt_amount || 0), 0) || 0
          setStats(prev => ({ ...prev, commissionEarned: totalCommission }))
        } catch { /* non-blocking */ }
      }
      refreshBalances()
    }
  }, [activeTab, user?.partner_id])

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
                  onClick={async () => {
                    setRefreshing(true)
                    try {
                      await fetchDashboardData()
                    } finally {
                      setRefreshing(false)
                    }
                  }}
                  disabled={refreshing}
                  className="p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                  title="Refresh"
                >
                  <RefreshCw className={`w-4 h-4 text-gray-600 dark:text-gray-300 ${refreshing ? 'animate-spin' : ''}`} />
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
          {activeTab === 'dashboard' && (
            <DashboardTab
              user={user}
              stats={stats}
              chartData={chartData}
              recentTransactions={recentTransactions}
              onTabChange={setActiveTab}
              router={router}
            />
          )}
          {activeTab === 'wallet' && <WalletTab user={user} />}
          {activeTab === 'services' && <ServicesTab />}
          {activeTab === 'aeps' && <AEPSDashboard />}
          {activeTab === 'bbps' && <BBPSTab />}
          {activeTab === 'bbps-2' && <Pay2NewBBPSTab />}
          {activeTab === 'credit-card' && <CreditCardTab />}
          {activeTab === 'payout' && <PayoutTransfer title="Settlement-1 - Bank Transfer" />}
          {activeTab === 'settlement-2' && <ShadvalPayTransfer title="Settlement-2 - Bank Transfer" />}
          {activeTab === 'transactions' && (
            <>
              <PosBridgePanel variant="retailer" />
              <POSTransactionsTable autoPoll={true} pollInterval={15000} />
            </>
          )}
          {activeTab === 'ledger' && <LedgerTab user={user} />}
          {activeTab === 'aeps-ledger' && (
            <div className="space-y-6">
              <AEPSWalletLedger user={user} />
              <AEPSTransactionHistory limit={25} showFilters={true} />
            </div>
          )}
          {activeTab === 'mdr-schemes' && <MDRSchemesTab user={user} />}
          {activeTab === 'pos-machines' && <POSMachinesTab user={user} accentColor="blue" />}
          {activeTab === 'subscriptions' && <PartnerSubscriptionsTab />}
          {activeTab === 'reports' && <ReportsTab chartData={chartData} stats={stats} />}
          {activeTab === 'settings' && <SettingsTab user={user} />}
        </div>
      </div>
    </div>
  )
}

// Distributor Connection Card Component
function DistributorConnectionCard({ user }: { user: any }) {
  const { showToast } = useToast()
  const [distributorInfo, setDistributorInfo] = useState<any>(null)
  const [schemesCount, setSchemesCount] = useState(0)
  const [activeSchemeNames, setActiveSchemeNames] = useState<string[]>([])
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

      // Fetch active schemes mapped to this retailer (with scheme name)
      const { data: schemesData } = await supabase
        .from('scheme_mappings')
        .select('id, scheme:schemes(name)')
        .eq('entity_id', user.partner_id)
        .eq('entity_role', 'retailer')
        .eq('status', 'active')
        .order('priority', { ascending: true })

      setSchemesCount(schemesData?.length || 0)
      setActiveSchemeNames(
        (schemesData || [])
          .map((m: any) => m.scheme?.name)
          .filter(Boolean)
      )
    } catch (error) {
      console.error('Error fetching distributor info:', error)
      showToast('Failed to load distributor info', 'error')
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
          {activeSchemeNames.length > 0 ? (
            <p className="text-xs text-purple-600 dark:text-purple-400 font-medium mt-1">
              {activeSchemeNames.join(', ')}
            </p>
          ) : (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Assigned by distributor
            </p>
          )}
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
function DashboardTab({ user, stats, chartData, recentTransactions, onTabChange, router }: {
  user: any
  stats: any
  chartData: any[]
  recentTransactions: any[]
  onTabChange: (tab: TabType) => void
  router: ReturnType<typeof useRouter>
}) {
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
          onClick={() => {
            onTabChange('wallet')
            router.push('/dashboard/retailer?tab=wallet', { scroll: false })
          }}
        />
        <StatCard
          label="AEPS Wallet Balance"
          value={`₹${stats.aepsWalletBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          icon={Fingerprint}
          gradient="from-teal-500 to-teal-600"
          delay={0.5}
          onClick={() => {
            onTabChange('aeps')
            router.push('/dashboard/retailer?tab=aeps', { scroll: false })
          }}
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
  const [activeGroupId, setActiveGroupId] = useState(BBPS_CATEGORY_GROUPS[0].id)

  const activeGroup = BBPS_CATEGORY_GROUPS.find((g) => g.id === activeGroupId) || BBPS_CATEGORY_GROUPS[0]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-2">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {BBPS_CATEGORY_GROUPS.map((group) => (
            <button
              key={group.id}
              onClick={() => setActiveGroupId(group.id)}
              className={`p-3 rounded-lg text-left transition-all ${
                activeGroupId === group.id
                  ? `bg-gradient-to-r ${group.color} text-white shadow-md`
                  : 'bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
              }`}
            >
              <div className="font-semibold text-sm">{group.label}</div>
              <div className={`text-xs mt-0.5 ${activeGroupId === group.id ? 'text-white/80' : 'text-gray-500 dark:text-gray-400'}`}>
                {group.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      <BBPSPayment 
        categoryFilter={activeGroup.categories}
        title={activeGroup.label}
      />
    </motion.div>
  )
}

function Pay2NewBBPSTab() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <Pay2NewServiceHub />
    </motion.div>
  )
}

function CreditCardTab() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <Pay2NewServiceFlow
        serviceId={34}
        title="Credit Card"
        subtitle="Pay any credit card bill"
        icon={<CreditCard className="w-6 h-6" />}
        mode="bill"
        numberLabel="Last 4 Digits of Credit Card"
        numberPlaceholder="e.g. 1266"
        numberMaxLength={4}
        showOptional1={true}
        optional1Label="Registered Mobile Number (Optional)"
        optional1Placeholder="e.g. 9876543210"
        accent="purple"
      />
    </motion.div>
  )
}

// Services Tab Component
function ServicesTab() {
  const { user } = useAuth()
  const { showToast } = useToast()
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
      showToast('Failed to load service data', 'error')
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
  const { showToast } = useToast()
  const [walletBalance, setWalletBalance] = useState<number | null>(null)
  const [aepsBalance, setAepsBalance] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [ledgerEntries, setLedgerEntries] = useState<any[]>([])
  const [showSettlement, setShowSettlement] = useState(false)
  const [settlementAmount, setSettlementAmount] = useState('')
  const [settlementLimitTier, setSettlementLimitTier] = useState<number>(100000)
  const [settlementAmountError, setSettlementAmountError] = useState<string | null>(null)
  const [settlementCharge, setSettlementCharge] = useState<number | null>(null)
  const [settlementChargeLoading, setSettlementChargeLoading] = useState(false)
  const [settlementSchemeName, setSettlementSchemeName] = useState<string | null>(null)
  const [settlementProcessing, setSettlementProcessing] = useState(false)
  const [bankDetails, setBankDetails] = useState({
    account_number: '',
    ifsc: '',
    account_name: ''
  })
  const [showAepsSettlement, setShowAepsSettlement] = useState(false)
  const [aepsSettlementAmount, setAepsSettlementAmount] = useState('')
  const [aepsSettlementProcessing, setAepsSettlementProcessing] = useState(false)
  const [aepsSettleCharge, setAepsSettleCharge] = useState<number | null>(null)
  const [aepsSettleChargeLoading, setAepsSettleChargeLoading] = useState(false)
  const [aepsSettleSchemeName, setAepsSettleSchemeName] = useState<string | null>(null)
  const [aepsSettleConfirmed, setAepsSettleConfirmed] = useState(false)
  const [showAepsTransfer, setShowAepsTransfer] = useState(false)
  const [aepsTransferAmount, setAepsTransferAmount] = useState('')
  const [aepsTransferProcessing, setAepsTransferProcessing] = useState(false)
  const [aepsTransferConfirmed, setAepsTransferConfirmed] = useState(false)
  // Stable idempotency key for the in-progress AEPS→Primary transfer (cleared on success)
  const aepsTransferIdemRef = useRef<string | null>(null)
  const [aepsSettleAccounts, setAepsSettleAccounts] = useState<any[]>([])
  const [selectedSettleAccountId, setSelectedSettleAccountId] = useState<string>('')
  const [showAddSettleAccount, setShowAddSettleAccount] = useState(false)
  const [newSettleAccount, setNewSettleAccount] = useState({ account_number: '', ifsc_code: '', bank_name: '' })
  const [addingSettleAccount, setAddingSettleAccount] = useState(false)
  const [settleAccountsLoading, setSettleAccountsLoading] = useState(false)
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null)

  useEffect(() => {
    fetchWalletData()
    fetchSettlementLimit()
    fetchAepsSettleAccounts()
  }, [user])

  useEffect(() => {
    if (showAepsSettlement) {
      const amt = parseFloat(aepsSettlementAmount)
      if (amt > 0) {
        fetchAepsSettleCharge(amt)
      }
    }
  }, [showAepsSettlement])

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
      showToast('Failed to load settlement limit', 'error')
    }
  }

  const fetchAepsSettleAccounts = async () => {
    if (!user?.partner_id) return
    setSettleAccountsLoading(true)
    try {
      const res = await apiFetchJson<{ success: boolean; accounts: any[] }>('/api/aeps/settlement-account')
      setAepsSettleAccounts(res.accounts || [])
      const approved = (res.accounts || []).filter((a: any) => a.admin_status === 'approved')
      if (approved.length > 0 && !selectedSettleAccountId) {
        const def = approved.find((a: any) => a.is_default) || approved[0]
        setSelectedSettleAccountId(def.id)
      }
    } catch {
      showToast('Failed to load settlement accounts', 'error')
      setAepsSettleAccounts([])
    } finally {
      setSettleAccountsLoading(false)
    }
  }

  const handleAddSettleAccount = async () => {
    if (!newSettleAccount.account_number || !newSettleAccount.ifsc_code) {
      showToast('Account number and IFSC code are required', 'error')
      return
    }
    setAddingSettleAccount(true)
    try {
      const res = await apiFetchJson<{ success: boolean; error?: string; message?: string }>('/api/aeps/settlement-account', {
        method: 'POST',
        body: JSON.stringify(newSettleAccount),
      })
      if (res.success) {
        showToast(res.message || 'Account added and submitted for admin approval!', 'success')
        setShowAddSettleAccount(false)
        setNewSettleAccount({ account_number: '', ifsc_code: '', bank_name: '' })
        fetchAepsSettleAccounts()
      } else {
        showToast(res.error || 'Failed to add account', 'error')
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to add settlement account', 'error')
    } finally {
      setAddingSettleAccount(false)
    }
  }

  const handleDeleteSettleAccount = async (id: string) => {
    if (!confirm('Delete this settlement account?')) return
    setDeletingAccountId(id)
    try {
      const res = await apiFetchJson<{ success: boolean; error?: string }>(`/api/aeps/settlement-account?id=${id}`, { method: 'DELETE' })
      if (res.success) {
        showToast('Settlement account deleted', 'success')
        fetchAepsSettleAccounts()
        if (selectedSettleAccountId === id) setSelectedSettleAccountId('')
      } else {
        showToast(res.error || 'Failed to delete', 'error')
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to delete', 'error')
    } finally {
      setDeletingAccountId(null)
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
      showToast('Failed to load wallet data', 'error')
    } finally {
      setLoading(false)
    }
  }

  const fetchSettlementCharge = async (amt: number) => {
    if (amt <= 0 || !user?.partner_id) { setSettlementCharge(null); setSettlementSchemeName(null); return }
    setSettlementChargeLoading(true)
    try {
      const res = await apiFetchJson<{ resolved: boolean; charges?: { retailer_charge: number }; scheme?: { name: string } }>(`/api/schemes/resolve-charges?service_type=payout&amount=${amt}&transfer_mode=IMPS&user_id=${user.partner_id}`)
      setSettlementCharge(res.resolved && res.charges ? res.charges.retailer_charge : 0)
      setSettlementSchemeName(res.resolved && res.scheme ? res.scheme.name : null)
    } catch {
      showToast('Could not fetch settlement charge', 'warning')
      setSettlementCharge(0)
      setSettlementSchemeName(null)
    } finally {
      setSettlementChargeLoading(false)
    }
  }

  const handleSettlement = async () => {
    if (!settlementAmount || parseFloat(settlementAmount) <= 0) {
      showToast('Please enter a valid settlement amount', 'error')
      return
    }

    const amount = parseFloat(settlementAmount)
    
    if (amount > settlementLimitTier) {
      showToast(`Amount exceeds your settlement limit of ₹${settlementLimitTier.toLocaleString('en-IN')}`, 'error')
      setSettlementAmountError(`Amount exceeds your settlement limit of ₹${settlementLimitTier.toLocaleString('en-IN')}`)
      return
    }

    if (!bankDetails.account_number || !bankDetails.ifsc || !bankDetails.account_name) {
      showToast('Please fill all bank details', 'error')
      return
    }

    setSettlementProcessing(true)
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
        showToast('Settlement request created successfully!', 'success')
        setShowSettlement(false)
        setSettlementAmount('')
        setSettlementCharge(null)
        setSettlementSchemeName(null)
        setBankDetails({ account_number: '', ifsc: '', account_name: '' })
        fetchWalletData()
      } else {
        showToast(data.error || 'Settlement failed', 'error')
      }
    } catch (error: any) {
      console.error('Settlement error:', error)
      showToast(error.message || 'Failed to create settlement request', 'error')
    } finally {
      setSettlementProcessing(false)
    }
  }

  const fetchAepsSettleCharge = async (amt: number) => {
    if (amt <= 0 || !user?.partner_id) { setAepsSettleCharge(null); setAepsSettleSchemeName(null); return }
    setAepsSettleChargeLoading(true)
    try {
      const res = await apiFetchJson<{ resolved: boolean; charges?: { retailer_charge: number }; scheme?: { name: string } }>(`/api/schemes/resolve-charges?service_type=aeps_settlement&amount=${amt}&user_id=${user.partner_id}`)
      setAepsSettleCharge(res.resolved && res.charges ? res.charges.retailer_charge : 0)
      setAepsSettleSchemeName(res.resolved && res.scheme ? res.scheme.name : null)
    } catch {
      showToast('Could not fetch AEPS settlement charge', 'warning')
      setAepsSettleCharge(0)
      setAepsSettleSchemeName(null)
    } finally {
      setAepsSettleChargeLoading(false)
    }
  }

  const handleAepsSettlement = async () => {
    if (!aepsSettlementAmount || parseFloat(aepsSettlementAmount) <= 0) {
      showToast('Please enter a valid amount', 'error')
      return
    }
    if (parseFloat(aepsSettlementAmount) < 1001) {
      showToast('Minimum settlement amount is ₹1,001', 'error')
      return
    }
    if (!selectedSettleAccountId) {
      showToast('Please select an approved settlement account', 'error')
      return
    }
    const amt = parseFloat(aepsSettlementAmount)
    const charge = aepsSettleCharge ?? 0
    const total = amt + charge
    if (total > (aepsBalance || 0)) {
      showToast(`Insufficient AEPS balance. Need ₹${total.toLocaleString('en-IN')} but only ₹${(aepsBalance || 0).toLocaleString('en-IN')} available.`, 'error')
      return
    }
    if (!aepsSettleConfirmed) {
      setAepsSettleConfirmed(true)
      return
    }
    setAepsSettlementProcessing(true)
    try {
      const data = await apiFetchJson<{ success: boolean; error?: string; charge?: number; message?: string }>('/api/aeps/settlement', {
        method: 'POST',
        body: JSON.stringify({
          amount: amt,
          settlement_account_id: selectedSettleAccountId,
        })
      })
      if (data.success) {
        showToast(data.message || 'AEPS settlement processed successfully!', 'success')
        setShowAepsSettlement(false)
        setAepsSettlementAmount('')
        setAepsSettleCharge(null)
        setAepsSettleConfirmed(false)
        fetchWalletData()
      } else {
        showToast(data.error || 'AEPS settlement failed', 'error')
        setAepsSettleConfirmed(false)
      }
    } catch (error: any) {
      showToast(error.message || 'Failed to process AEPS settlement', 'error')
      setAepsSettleConfirmed(false)
    } finally {
      setAepsSettlementProcessing(false)
    }
  }

  const handleAepsTransfer = async () => {
    if (!aepsTransferAmount || parseFloat(aepsTransferAmount) <= 0) {
      showToast('Please enter a valid amount', 'error')
      return
    }
    const amt = parseFloat(aepsTransferAmount)
    if (amt > (aepsBalance || 0)) {
      showToast('Amount exceeds AEPS wallet balance', 'error')
      return
    }
    if (!aepsTransferConfirmed) {
      setAepsTransferConfirmed(true)
      return
    }
    setAepsTransferProcessing(true)
    if (!aepsTransferIdemRef.current) aepsTransferIdemRef.current = newIdempotencyKey()
    try {
      const data = await apiFetchJson<{ success: boolean; error?: string; message?: string }>('/api/wallet/transfer', {
        method: 'POST',
        idempotencyKey: aepsTransferIdemRef.current,
        body: JSON.stringify({
          amount: amt,
          source_wallet: 'aeps',
          target_wallet: 'primary',
        })
      })
      if (data.success) {
        aepsTransferIdemRef.current = null
        showToast(data.message || 'Transfer successful!', 'success')
        setShowAepsTransfer(false)
        setAepsTransferAmount('')
        setAepsTransferConfirmed(false)
        fetchWalletData()
      } else {
        showToast(data.error || 'Transfer failed', 'error')
        setAepsTransferConfirmed(false)
      }
    } catch (error: any) {
      showToast(error.message || 'Failed to transfer funds', 'error')
      setAepsTransferConfirmed(false)
    } finally {
      setAepsTransferProcessing(false)
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
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-purple-100 text-sm font-medium mb-1">AEPS Wallet</p>
              <p className="text-3xl font-bold">
                ₹{aepsBalance?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
              </p>
            </div>
            <Wallet className="w-12 h-12 text-purple-200" />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowAepsSettlement(true)}
              className="flex-1 bg-white/20 hover:bg-white/30 text-white font-medium py-2 px-3 rounded-lg transition-colors text-sm flex items-center justify-center gap-1"
            >
              <Banknote className="w-4 h-4" /> Settle to Bank
            </button>
            <button
              onClick={() => setShowAepsTransfer(true)}
              className="flex-1 bg-white/20 hover:bg-white/30 text-white font-medium py-2 px-3 rounded-lg transition-colors text-sm flex items-center justify-center gap-1"
            >
              <Send className="w-4 h-4" /> To Primary
            </button>
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
                      const numVal = parseFloat(value)
                      if (!isNaN(numVal) && numVal > 0) {
                        fetchSettlementCharge(numVal)
                      } else {
                        setSettlementCharge(null)
                        setSettlementSchemeName(null)
                      }
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

              {/* Charge breakdown */}
              {settlementAmount && parseFloat(settlementAmount) > 0 && (
                <div className="p-3 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg text-sm space-y-1.5">
                  {settlementChargeLoading ? (
                    <p className="text-gray-500 text-center">Calculating charge...</p>
                  ) : (
                    <>
                      {settlementSchemeName && (
                        <div className="flex items-center gap-1.5 mb-1 text-xs text-purple-600 dark:text-purple-400">
                          <span className="inline-block w-1.5 h-1.5 bg-purple-500 rounded-full"></span>
                          Scheme: {settlementSchemeName}
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Transfer Amount</span>
                        <span className="font-semibold text-gray-900 dark:text-white">₹{parseFloat(settlementAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </div>
                      {(settlementCharge ?? 0) > 0 && (
                        <div className="flex justify-between">
                          <span className="text-gray-600 dark:text-gray-400">
                            Settlement charge
                            {settlementSchemeName && (
                              <span className="ml-1 text-[10px] text-purple-600 dark:text-purple-400">(from scheme)</span>
                            )}
                          </span>
                          <span className="font-medium text-orange-600 dark:text-orange-400">₹{(settlementCharge ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                        </div>
                      )}
                      <div className="border-t border-gray-200 dark:border-gray-600 pt-1.5 flex justify-between">
                        <span className="font-semibold text-gray-900 dark:text-white">Total deduction</span>
                        <span className="font-bold text-gray-900 dark:text-white">₹{(parseFloat(settlementAmount) + (settlementCharge ?? 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </div>
                    </>
                  )}
                </div>
              )}

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
                  disabled={settlementProcessing}
                  className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {settlementProcessing ? 'Processing...' : 'Submit'}
                </button>
                <button
                  onClick={() => setShowSettlement(false)}
                  disabled={settlementProcessing}
                  className="flex-1 bg-gray-200 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-300 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* AEPS Settlement Accounts Management */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="bg-white dark:bg-gray-800 rounded-xl shadow p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold flex items-center gap-2"><Shield className="w-5 h-5 text-purple-600" /> AEPS Settlement Accounts</h3>
          <button onClick={() => setShowAddSettleAccount(true)}
            className="bg-purple-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-1">
            + Add Account
          </button>
        </div>

        {settleAccountsLoading ? (
          <p className="text-sm text-gray-500 text-center py-4">Loading accounts...</p>
        ) : aepsSettleAccounts.length === 0 ? (
          <div className="text-center py-6 text-gray-500">
            <Building2 className="w-10 h-10 mx-auto mb-2 text-gray-300" />
            <p className="text-sm">No settlement accounts added yet.</p>
            <p className="text-xs mt-1">Add a bank account to start AEPS settlements.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {aepsSettleAccounts.map((acct: any) => (
              <div key={acct.id} className={`border rounded-lg p-3 flex items-center justify-between ${
                acct.admin_status === 'approved' ? 'border-green-300 bg-green-50 dark:bg-green-900/10 dark:border-green-800' :
                acct.admin_status === 'rejected' ? 'border-red-300 bg-red-50 dark:bg-red-900/10 dark:border-red-800' :
                'border-yellow-300 bg-yellow-50 dark:bg-yellow-900/10 dark:border-yellow-800'
              }`}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{acct.account_holder_name}</p>
                  <p className="text-xs text-gray-500">A/C: ***{acct.account_number?.slice(-4)} | {acct.ifsc_code} | {acct.bank_name || ''}</p>
                  {acct.verified_account_name && acct.verified_account_name !== acct.account_holder_name && (
                    <p className="text-xs text-blue-600">Verified as: {acct.verified_account_name}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-3 shrink-0">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    acct.admin_status === 'approved' ? 'bg-green-200 text-green-800' :
                    acct.admin_status === 'rejected' ? 'bg-red-200 text-red-800' :
                    'bg-yellow-200 text-yellow-800'
                  }`}>
                    {acct.admin_status === 'pending_approval' ? 'Pending Approval' : acct.admin_status === 'approved' ? 'Approved' : 'Rejected'}
                  </span>
                  <button onClick={() => handleDeleteSettleAccount(acct.id)}
                    disabled={deletingAccountId === acct.id}
                    className="text-gray-400 hover:text-red-500 p-1 disabled:opacity-50 disabled:cursor-not-allowed" title="Delete">
                    {deletingAccountId === acct.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Add Settlement Account Modal */}
      {showAddSettleAccount && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold mb-1">Add Settlement Account</h3>
            <p className="text-sm text-gray-500 mb-4">Account will be verified via penny-drop and then sent for admin approval</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Bank Account Number</label>
                <input type="text" value={newSettleAccount.account_number}
                  onChange={(e) => setNewSettleAccount({ ...newSettleAccount, account_number: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg" placeholder="Enter 9-18 digit account number" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">IFSC Code</label>
                <input type="text" value={newSettleAccount.ifsc_code}
                  onChange={(e) => setNewSettleAccount({ ...newSettleAccount, ifsc_code: e.target.value.toUpperCase() })}
                  className="w-full px-4 py-2 border rounded-lg" placeholder="e.g. SBIN0001234" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Bank Name (optional)</label>
                <input type="text" value={newSettleAccount.bank_name}
                  onChange={(e) => setNewSettleAccount({ ...newSettleAccount, bank_name: e.target.value })}
                  className="w-full px-4 py-2 border rounded-lg" placeholder="e.g. State Bank of India" />
              </div>
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  <Info className="w-3.5 h-3.5 inline mr-1" />
                  Your account will be verified instantly via penny-drop. After verification, admin will review and approve it. Only approved accounts can be used for AEPS settlement.
                </p>
              </div>
              <div className="flex gap-3">
                <button onClick={handleAddSettleAccount} disabled={addingSettleAccount}
                  className="flex-1 bg-purple-600 text-white py-2 px-4 rounded-lg hover:bg-purple-700 disabled:opacity-50">
                  {addingSettleAccount ? 'Verifying & Submitting...' : 'Verify & Submit'}
                </button>
                <button onClick={() => setShowAddSettleAccount(false)}
                  className="flex-1 bg-gray-200 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-300">Cancel</button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* AEPS Settlement Modal */}
      {showAepsSettlement && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6 max-h-[90vh] flex flex-col"
          >
            <h3 className="text-xl font-bold mb-1">AEPS Settlement to Bank</h3>
            <p className="text-sm text-gray-500 mb-4">Transfer AEPS wallet balance to your approved bank account</p>
            <div className="mb-3 p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg flex-shrink-0">
              <p className="text-sm text-purple-700 dark:text-purple-300">
                Available AEPS Balance: <span className="font-bold">₹{aepsBalance?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || '0.00'}</span>
              </p>
            </div>
            <div className="space-y-4 overflow-y-auto flex-1 min-h-0">
              <div>
                <label className="block text-sm font-medium mb-1">Amount (₹)</label>
                <input type="number" value={aepsSettlementAmount}
                  onChange={(e) => {
                    setAepsSettlementAmount(e.target.value)
                    setAepsSettleConfirmed(false)
                    const v = parseFloat(e.target.value)
                    if (v > 0) fetchAepsSettleCharge(v)
                    else setAepsSettleCharge(null)
                  }}
                  className="w-full px-4 py-2 border rounded-lg" placeholder="Min ₹1,001" min="1001" />
                <p className="text-xs text-gray-500 mt-1">Minimum settlement amount: ₹1,001</p>
              </div>

              {/* Charge breakdown preview */}
              {aepsSettlementAmount && parseFloat(aepsSettlementAmount) > 0 && (
                <div className="p-3 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg text-sm space-y-1.5">
                  {aepsSettleChargeLoading ? (
                    <p className="text-gray-500 text-center">Calculating charge...</p>
                  ) : (
                    <>
                      {aepsSettleSchemeName && (
                        <div className="flex items-center gap-1.5 mb-1 text-xs text-purple-600 dark:text-purple-400">
                          <span className="inline-block w-1.5 h-1.5 bg-purple-500 rounded-full"></span>
                          Scheme: {aepsSettleSchemeName}
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">You will receive in bank</span>
                        <span className="font-semibold text-green-700 dark:text-green-400">₹{parseFloat(aepsSettlementAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">
                          Settlement charge
                          {aepsSettleSchemeName && (
                            <span className="ml-1 text-[10px] text-purple-600 dark:text-purple-400">(from scheme)</span>
                          )}
                        </span>
                        <span className="font-medium text-orange-600 dark:text-orange-400">₹{(aepsSettleCharge ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div className="border-t border-gray-200 dark:border-gray-600 pt-1.5 flex justify-between">
                        <span className="font-semibold text-gray-900 dark:text-white">Total deducted from AEPS Wallet</span>
                        <span className="font-bold text-gray-900 dark:text-white">₹{(parseFloat(aepsSettlementAmount) + (aepsSettleCharge ?? 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                      </div>
                      {(aepsSettleCharge ?? 0) > 0 && (
                        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                          Settlement charges are applied per your scheme tier. Check MDR Schemes tab for full rate card.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Approved Account Selector */}
              <div>
                <label className="block text-sm font-medium mb-1">Settlement Account</label>
                {(() => {
                  const approved = aepsSettleAccounts.filter((a: any) => a.admin_status === 'approved')
                  if (approved.length === 0) {
                    return (
                      <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg">
                        <p className="text-sm text-yellow-800 dark:text-yellow-300">No approved settlement accounts.</p>
                        <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-1">Add a bank account from the Settlement Accounts section below and wait for admin approval.</p>
                      </div>
                    )
                  }
                  return (
                    <select value={selectedSettleAccountId}
                      onChange={(e) => { setSelectedSettleAccountId(e.target.value); setAepsSettleConfirmed(false) }}
                      className="w-full px-4 py-2 border rounded-lg bg-white dark:bg-gray-700">
                      <option value="">-- Select Account --</option>
                      {approved.map((a: any) => (
                        <option key={a.id} value={a.id}>
                          {a.account_holder_name} — ***{a.account_number?.slice(-4)} ({a.ifsc_code})
                        </option>
                      ))}
                    </select>
                  )
                })()}
              </div>

              {/* Confirmation banner */}
              {aepsSettleConfirmed && selectedSettleAccountId && (
                <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg">
                  <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-300 mb-1">Please confirm</p>
                  <p className="text-xs text-yellow-700 dark:text-yellow-400">
                    ₹{parseFloat(aepsSettlementAmount).toLocaleString('en-IN')} will be sent to the selected account.
                    ₹{(parseFloat(aepsSettlementAmount) + (aepsSettleCharge ?? 0)).toLocaleString('en-IN')} will be deducted from your AEPS wallet (includes ₹{(aepsSettleCharge ?? 0).toLocaleString('en-IN')} charge).
                  </p>
                </div>
              )}

            </div>
            <div className="flex gap-3 pt-4 flex-shrink-0">
              <button onClick={handleAepsSettlement} disabled={aepsSettlementProcessing || aepsSettleChargeLoading || !selectedSettleAccountId}
                className={`flex-1 text-white py-2 px-4 rounded-lg disabled:opacity-50 ${aepsSettleConfirmed ? 'bg-green-600 hover:bg-green-700' : 'bg-purple-600 hover:bg-purple-700'}`}>
                {aepsSettlementProcessing ? 'Processing...' : aepsSettleConfirmed ? 'Confirm & Settle' : 'Settle to Bank'}
              </button>
              <button onClick={() => { setShowAepsSettlement(false); setAepsSettleConfirmed(false); setAepsSettleCharge(null); setAepsSettleSchemeName(null) }}
                className="flex-1 bg-gray-200 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-300">
                Cancel
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* AEPS → Primary Transfer Modal */}
      {showAepsTransfer && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full p-6"
          >
            <h3 className="text-xl font-bold mb-1">Transfer to Primary Wallet</h3>
            <p className="text-sm text-gray-500 mb-4">Move AEPS wallet balance to Primary wallet for other services</p>
            <div className="mb-3 p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
              <p className="text-sm text-purple-700 dark:text-purple-300">
                Available AEPS Balance: <span className="font-bold">₹{aepsBalance?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || '0.00'}</span>
              </p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Amount (₹)</label>
                <input type="number" value={aepsTransferAmount}
                  onChange={(e) => { setAepsTransferAmount(e.target.value); setAepsTransferConfirmed(false) }}
                  className="w-full px-4 py-2 border rounded-lg" placeholder="Enter amount" min="1" />
              </div>

              {/* Transfer preview */}
              {aepsTransferAmount && parseFloat(aepsTransferAmount) > 0 && (
                <div className="p-3 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg text-sm space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Deducted from AEPS Wallet</span>
                    <span className="font-medium text-red-600 dark:text-red-400">- ₹{parseFloat(aepsTransferAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Credited to Primary Wallet</span>
                    <span className="font-semibold text-green-700 dark:text-green-400">+ ₹{parseFloat(aepsTransferAmount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 pt-1">No charges apply. Transfer is instant.</p>
                </div>
              )}

              {/* Confirmation banner */}
              {aepsTransferConfirmed && (
                <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg">
                  <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-300 mb-1">⚠ Please confirm</p>
                  <p className="text-xs text-yellow-700 dark:text-yellow-400">
                    ₹{parseFloat(aepsTransferAmount).toLocaleString('en-IN')} will be moved from AEPS Wallet to Primary Wallet. This action cannot be undone.
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={handleAepsTransfer} disabled={aepsTransferProcessing}
                  className={`flex-1 text-white py-2 px-4 rounded-lg disabled:opacity-50 ${aepsTransferConfirmed ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
                  {aepsTransferProcessing ? 'Transferring...' : aepsTransferConfirmed ? 'Confirm Transfer' : 'Transfer to Primary'}
                </button>
                <button onClick={() => { setShowAepsTransfer(false); setAepsTransferConfirmed(false) }}
                  className="flex-1 bg-gray-200 text-gray-700 py-2 px-4 rounded-lg hover:bg-gray-300">
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
                      {new Date(entry.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}
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
function StatCard({ label, value, icon: Icon, gradient, delay, onClick }: { 
  label: string
  value: string | number
  icon: any
  gradient: string
  delay: number
  onClick?: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay }}
      onClick={onClick}
      className={`relative overflow-hidden rounded-lg bg-gradient-to-br ${gradient} text-white p-4 shadow-md hover:shadow-lg transition-shadow${onClick ? ' cursor-pointer' : ''}`}
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
            mdr_rates:scheme_mdr_rates (*),
            aeps_commissions:scheme_aeps_commissions (*),
            aeps_settlement_charges:scheme_aeps_settlement_charges (*),
            shadval_settlement_charges:scheme_shadval_settlement_charges (*)
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
              Your charges and rates (MDR, BBPS, Settlement) are determined by schemes assigned to you by your distributor. 
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

      {/* Settlement Charges Section */}
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
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Settlement Charges</h3>
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

      {/* AEPS Commissions Section */}
      {(() => {
        const allAepsComm: any[] = []
        const allSchemes = [...customSchemes, ...globalSchemes]
        allSchemes.forEach((scheme: any) => {
          if (scheme.aeps_commissions && Array.isArray(scheme.aeps_commissions) && scheme.aeps_commissions.length > 0) {
            scheme.aeps_commissions.forEach((comm: any) => {
              if (comm && comm.status === 'active') {
                allAepsComm.push({
                  ...comm,
                  scheme_name: scheme.name,
                  scheme_type: scheme.scheme_type,
                })
              }
            })
          }
        })

        if (allAepsComm.length === 0) return null

        allAepsComm.sort((a, b) => {
          if (a.transaction_type !== b.transaction_type) return a.transaction_type < b.transaction_type ? -1 : 1
          return (a.min_amount || 0) - (b.min_amount || 0)
        })

        return (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.32 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
          >
            <div className="flex items-center gap-2 mb-4">
              <Fingerprint className="w-5 h-5 text-teal-600 dark:text-teal-400" />
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">AEPS Commissions</h3>
              <span className="text-xs bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300 px-2 py-0.5 rounded-full">From Scheme</span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Commission rates for AEPS cash withdrawal &amp; deposit transactions</p>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Txn Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Amount Range</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Your Commission</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">TDS</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Scheme</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {allAepsComm.map((c, index) => (
                    <tr key={c.id || index} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-4 py-3 text-sm">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          c.transaction_type?.includes('withdrawal')
                            ? 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'
                            : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                        }`}>
                          {c.transaction_type?.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                        ₹{Number(c.min_amount).toLocaleString('en-IN')} – {c.max_amount >= 100000 ? '∞' : `₹${Number(c.max_amount).toLocaleString('en-IN')}`}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-green-600 dark:text-green-400">
                        {c.retailer_commission_type === 'percentage' 
                          ? `${c.retailer_commission}%` 
                          : `₹${Number(c.retailer_commission).toLocaleString('en-IN')}`}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{c.tds_percentage}%</td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{c.scheme_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )
      })()}

      {/* AEPS Settlement Charges Section */}
      {(() => {
        const allAepsSettle: any[] = []
        const allSchemes = [...customSchemes, ...globalSchemes]
        allSchemes.forEach((scheme: any) => {
          if (scheme.aeps_settlement_charges && Array.isArray(scheme.aeps_settlement_charges) && scheme.aeps_settlement_charges.length > 0) {
            scheme.aeps_settlement_charges.forEach((charge: any) => {
              if (charge && charge.status === 'active') {
                allAepsSettle.push({
                  ...charge,
                  scheme_name: scheme.name,
                  scheme_type: scheme.scheme_type,
                })
              }
            })
          }
        })

        if (allAepsSettle.length === 0) return null

        allAepsSettle.sort((a, b) => (a.min_amount || 0) - (b.min_amount || 0))

        return (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.34 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
          >
            <div className="flex items-center gap-2 mb-4">
              <DollarSign className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">AEPS Settlement Charges</h3>
              <span className="text-xs bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 px-2 py-0.5 rounded-full">From Scheme</span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Charges for settling AEPS wallet balance to your bank account</p>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Amount Range</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Your Charge</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Scheme</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {allAepsSettle.map((c, index) => (
                    <tr key={c.id || index} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                        ₹{Number(c.min_amount).toLocaleString('en-IN')} – {c.max_amount >= 100000 ? '∞' : `₹${Number(c.max_amount).toLocaleString('en-IN')}`}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-red-600 dark:text-red-400">
                        {c.retailer_charge_type === 'percentage' 
                          ? `${c.retailer_charge}%` 
                          : `₹${Number(c.retailer_charge).toLocaleString('en-IN')}`}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{c.scheme_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )
      })()}

      {/* Settlement-2 Charges Section */}
      {(() => {
        const allShadvalSettle: any[] = []
        const allSchemes = [...customSchemes, ...globalSchemes]
        allSchemes.forEach((scheme: any) => {
          if (scheme.shadval_settlement_charges && Array.isArray(scheme.shadval_settlement_charges) && scheme.shadval_settlement_charges.length > 0) {
            scheme.shadval_settlement_charges.forEach((charge: any) => {
              if (charge && charge.status === 'active') {
                allShadvalSettle.push({
                  ...charge,
                  scheme_name: scheme.name,
                  scheme_type: scheme.scheme_type,
                })
              }
            })
          }
        })

        if (allShadvalSettle.length === 0) return null

        allShadvalSettle.sort((a, b) => (a.transfer_mode || '').localeCompare(b.transfer_mode || '') || (a.min_amount || 0) - (b.min_amount || 0))

        return (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.345 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
          >
            <div className="flex items-center gap-2 mb-4">
              <Banknote className="w-5 h-5 text-rose-600 dark:text-rose-400" />
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">Settlement-2 Charges</h3>
              <span className="text-xs bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300 px-2 py-0.5 rounded-full">From Scheme</span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Charges for Settlement-2 (ShadvalPay) transfers to your bank account</p>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Mode</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Amount Range</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Your Charge</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase">Scheme</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {allShadvalSettle.map((c, index) => (
                    <tr key={c.id || index} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300">{c.transfer_mode}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                        ₹{Number(c.min_amount).toLocaleString('en-IN')} – {c.max_amount >= 999999 ? '∞' : `₹${Number(c.max_amount).toLocaleString('en-IN')}`}
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-red-600 dark:text-red-400">
                        {c.retailer_charge_type === 'percentage' 
                          ? `${c.retailer_charge}%` 
                          : `₹${Number(c.retailer_charge).toLocaleString('en-IN')}`}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{c.scheme_name}</td>
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

function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPasswords, setShowPasswords] = useState({ current: false, new: false, confirm: false })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'New passwords do not match' })
      return
    }
    if (newPassword.length < 8) {
      setMessage({ type: 'error', text: 'Password must be at least 8 characters' })
      return
    }
    setLoading(true)
    setMessage(null)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to change password')
      setMessage({ type: 'success', text: 'Password changed successfully!' })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to change password' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6"
    >
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
          <Lock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Change Password</h3>
      </div>
      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
          {message.text}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Current Password</label>
          <div className="relative">
            <input type={showPasswords.current ? 'text' : 'password'} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white pr-10" />
            <button type="button" onClick={() => setShowPasswords(p => ({ ...p, current: !p.current }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              {showPasswords.current ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">New Password</label>
          <div className="relative">
            <input type={showPasswords.new ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={8} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white pr-10" />
            <button type="button" onClick={() => setShowPasswords(p => ({ ...p, new: !p.new }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              {showPasswords.new ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirm New Password</label>
          <div className="relative">
            <input type={showPasswords.confirm ? 'text' : 'password'} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required minLength={8} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white pr-10" />
            <button type="button" onClick={() => setShowPasswords(p => ({ ...p, confirm: !p.confirm }))} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
              {showPasswords.confirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <button type="submit" disabled={loading} className="w-full py-2 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium">
          {loading ? 'Changing...' : 'Change Password'}
        </button>
      </form>
    </motion.div>
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
  const [showConfirmTpin, setShowConfirmTpin] = useState(false)
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
              <div className="relative">
                <input
                  type={showConfirmTpin ? 'text' : 'password'}
                  value={confirmTpin}
                  onChange={(e) => setConfirmTpin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="Re-enter new TPIN"
                  className="w-full px-4 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  maxLength={4}
                />
                <button type="button" onClick={() => setShowConfirmTpin(!showConfirmTpin)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                  {showConfirmTpin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
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

      {/* Change Password Card */}
      <ChangePasswordCard />

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
