'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Wallet, IndianRupee, FileText, TrendingUp, TrendingDown,
  RefreshCw, Settings, AlertCircle, CheckCircle, Clock,
  Fingerprint, Building2, Activity, Smartphone, Shield, X,
  ChevronRight, Plus, History
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { apiFetchJson } from '@/lib/api-client';
import AEPSTransaction from './AEPSTransaction';
import AEPSTransactionHistory from './AEPSTransactionHistory';

type Tab = 'overview' | 'transaction' | 'history' | 'settings';

interface DashboardStats {
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  totalVolume: number;
  todayVolume: number;
  todayTransactions: number;
  walletBalance: number;
  commission: number;
}

interface MerchantInfo {
  merchantId: string;
  name: string;
  mobile: string;
  kycStatus: string;
  route?: string;
}

export default function AEPSDashboard() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<DashboardStats>({
    totalTransactions: 0,
    successfulTransactions: 0,
    failedTransactions: 0,
    totalVolume: 0,
    todayVolume: 0,
    todayTransactions: 0,
    walletBalance: 0,
    commission: 0,
  });
  const [merchant, setMerchant] = useState<MerchantInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showMerchantModal, setShowMerchantModal] = useState(false);
  const [isMockMode, setIsMockMode] = useState(false);

  const loadDashboardData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Load wallet balance
      const walletResponse = await apiFetchJson('/api/wallet/balance?wallet_type=aeps');
      
      // Load AEPS stats (if endpoint exists)
      let statsData: Partial<DashboardStats> = {};
      try {
        const statsResponse = await apiFetchJson('/api/aeps/stats');
        statsData = statsResponse.data || {};
      } catch {
        // Stats endpoint may not exist yet
      }

      // Load merchant info
      try {
        const loginStatus = await apiFetchJson('/api/aeps/login-status', {
          method: 'POST',
          body: JSON.stringify({ 
            merchantId: user?.partner_id || 'default',
            type: 'withdraw' 
          }),
        });
        setIsMockMode(loginStatus.isMockMode || false);
      } catch {
        // Login status check failed
      }

      setStats({
        ...stats,
        ...statsData,
        walletBalance: walletResponse.balance || 0,
      });
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user?.partner_id]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const quickActions = [
    {
      title: 'Balance Inquiry',
      description: 'Check customer balance',
      icon: Wallet,
      color: 'from-blue-500 to-blue-600',
      action: () => setActiveTab('transaction'),
    },
    {
      title: 'Cash Withdrawal',
      description: 'Withdraw cash for customer',
      icon: IndianRupee,
      color: 'from-green-500 to-green-600',
      action: () => setActiveTab('transaction'),
    },
    {
      title: 'Mini Statement',
      description: 'View recent transactions',
      icon: FileText,
      color: 'from-orange-500 to-orange-600',
      action: () => setActiveTab('transaction'),
    },
    {
      title: 'Transaction History',
      description: 'View all AEPS transactions',
      icon: History,
      color: 'from-purple-500 to-purple-600',
      action: () => setActiveTab('history'),
    },
  ];

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Mode Banner */}
      {isMockMode && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle className="w-6 h-6 text-amber-600 shrink-0" />
          <div>
            <p className="font-medium text-amber-800">Test Mode Active</p>
            <p className="text-sm text-amber-700">
              Using mock API for testing. No real device or biometrics needed.
            </p>
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Wallet Balance */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl p-5 text-white"
        >
          <div className="flex items-center justify-between mb-3">
            <Wallet className="w-8 h-8 opacity-80" />
            <span className="text-xs bg-white/20 px-2 py-1 rounded-full">AEPS Wallet</span>
          </div>
          <p className="text-3xl font-bold">{formatCurrency(stats.walletBalance)}</p>
          <p className="text-sm opacity-80 mt-1">Available Balance</p>
        </motion.div>

        {/* Today's Volume */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <TrendingUp className="w-5 h-5 text-green-600" />
            </div>
          </div>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(stats.todayVolume)}</p>
          <p className="text-sm text-gray-500 mt-1">Today's Volume</p>
          <p className="text-xs text-green-600 mt-2">
            {stats.todayTransactions} transactions
          </p>
        </motion.div>

        {/* Success Rate */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <CheckCircle className="w-5 h-5 text-blue-600" />
            </div>
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {stats.totalTransactions > 0 
              ? Math.round((stats.successfulTransactions / stats.totalTransactions) * 100)
              : 100}%
          </p>
          <p className="text-sm text-gray-500 mt-1">Success Rate</p>
          <p className="text-xs text-blue-600 mt-2">
            {stats.successfulTransactions} of {stats.totalTransactions}
          </p>
        </motion.div>

        {/* Commission Earned */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Activity className="w-5 h-5 text-purple-600" />
            </div>
          </div>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(stats.commission)}</p>
          <p className="text-sm text-gray-500 mt-1">Commission Earned</p>
          <p className="text-xs text-purple-600 mt-2">This month</p>
        </motion.div>
      </div>

      {/* Quick Actions */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {quickActions.map((action, index) => {
            const Icon = action.icon;
            return (
              <motion.button
                key={index}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 * index }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={action.action}
                className="relative overflow-hidden rounded-xl border-2 border-gray-200 bg-white p-5 text-left transition-all hover:border-primary-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br ${action.color} text-white mb-3`}>
                  <Icon className="w-6 h-6" />
                </div>
                <h4 className="font-semibold text-gray-900">{action.title}</h4>
                <p className="text-sm text-gray-500 mt-1">{action.description}</p>
                <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-300" />
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* How AEPS Works */}
      <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">How AEPS Works</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[
            { step: '1', title: 'Customer Auth', desc: 'Customer provides Aadhaar', icon: Fingerprint },
            { step: '2', title: 'Select Bank', desc: 'Choose linked bank account', icon: Building2 },
            { step: '3', title: 'Biometric Verify', desc: 'Fingerprint authentication', icon: Shield },
            { step: '4', title: 'Complete', desc: 'Transaction processed', icon: CheckCircle },
          ].map((item, index) => {
            const Icon = item.icon;
            return (
              <div key={index} className="text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary-100 text-primary-600 mb-3">
                  <Icon className="w-6 h-6" />
                </div>
                <h4 className="font-semibold text-gray-900">{item.title}</h4>
                <p className="text-sm text-gray-500 mt-1">{item.desc}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Transactions */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Recent Transactions</h3>
          <button
            onClick={() => setActiveTab('history')}
            className="text-sm text-primary-600 hover:text-primary-700 font-medium"
          >
            View All
          </button>
        </div>
        <AEPSTransactionHistory limit={5} showFilters={false} />
      </div>
    </div>
  );

  const renderTransaction = () => (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <button
          onClick={() => setActiveTab('overview')}
          className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
        >
          <ChevronRight className="w-4 h-4 rotate-180" />
          Back to Overview
        </button>
      </div>
      <AEPSTransaction
        merchantId={merchant?.merchantId || user?.partner_id}
        onTransactionComplete={(result) => {
          if (result.success) {
            loadDashboardData();
          }
        }}
      />
    </div>
  );

  const renderHistory = () => (
    <div>
      <div className="mb-6">
        <button
          onClick={() => setActiveTab('overview')}
          className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
        >
          <ChevronRight className="w-4 h-4 rotate-180" />
          Back to Overview
        </button>
      </div>
      <AEPSTransactionHistory />
    </div>
  );

  const renderSettings = () => (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="mb-6">
        <button
          onClick={() => setActiveTab('overview')}
          className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
        >
          <ChevronRight className="w-4 h-4 rotate-180" />
          Back to Overview
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <h3 className="text-lg font-semibold text-gray-900">AEPS Settings</h3>
        </div>
        <div className="p-6 space-y-6">
          {/* Merchant Info */}
          <div>
            <h4 className="font-medium text-gray-900 mb-3">Merchant Information</h4>
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              {merchant ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Merchant ID</span>
                    <span className="font-mono text-sm">{merchant.merchantId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Name</span>
                    <span className="font-medium">{merchant.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Mobile</span>
                    <span className="font-mono">{merchant.mobile}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">KYC Status</span>
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      merchant.kycStatus === 'validated' 
                        ? 'bg-green-100 text-green-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}>
                      {merchant.kycStatus}
                    </span>
                  </div>
                  {merchant.route && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Route</span>
                      <span className="font-medium">{merchant.route}</span>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-gray-500 text-center py-4">No merchant linked</p>
              )}
            </div>
          </div>

          {/* API Mode */}
          <div>
            <h4 className="font-medium text-gray-900 mb-3">API Mode</h4>
            <div className={`rounded-lg p-4 ${isMockMode ? 'bg-amber-50 border border-amber-200' : 'bg-green-50 border border-green-200'}`}>
              <div className="flex items-center gap-3">
                {isMockMode ? (
                  <AlertCircle className="w-6 h-6 text-amber-600" />
                ) : (
                  <CheckCircle className="w-6 h-6 text-green-600" />
                )}
                <div>
                  <p className={`font-medium ${isMockMode ? 'text-amber-800' : 'text-green-800'}`}>
                    {isMockMode ? 'Test Mode (Mock API)' : 'Production Mode (Live API)'}
                  </p>
                  <p className={`text-sm ${isMockMode ? 'text-amber-700' : 'text-green-700'}`}>
                    {isMockMode 
                      ? 'Using mock responses for testing without real device'
                      : 'Connected to live AEPS provider'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Device Info */}
          <div>
            <h4 className="font-medium text-gray-900 mb-3">Biometric Device</h4>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <Smartphone className="w-8 h-8 text-gray-400" />
                <div>
                  <p className="font-medium text-gray-900">
                    {isMockMode ? 'No device required in test mode' : 'Connect your biometric device'}
                  </p>
                  <p className="text-sm text-gray-500">
                    {isMockMode 
                      ? 'Mock mode simulates biometric authentication'
                      : 'RD Service compatible devices: Mantra, Morpho, Startek, etc.'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <div className="p-2 bg-primary-100 rounded-lg">
                <Fingerprint className="w-6 h-6 text-primary-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">AEPS Services</h1>
                <p className="text-sm text-gray-500">Aadhaar Enabled Payment System</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={loadDashboardData}
                disabled={isLoading}
                className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => setActiveTab('settings')}
                className={`p-2 rounded-lg ${activeTab === 'settings' ? 'bg-primary-100 text-primary-600' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                <Settings className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 -mb-px">
            {[
              { id: 'overview' as Tab, label: 'Overview', icon: Activity },
              { id: 'transaction' as Tab, label: 'New Transaction', icon: Plus },
              { id: 'history' as Tab, label: 'History', icon: History },
            ].map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? 'border-primary-600 text-primary-600'
                      : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'overview' && renderOverview()}
            {activeTab === 'transaction' && renderTransaction()}
            {activeTab === 'history' && renderHistory()}
            {activeTab === 'settings' && renderSettings()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
