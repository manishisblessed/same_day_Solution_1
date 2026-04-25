'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { apiFetch } from '@/lib/api-client'
import { 
  Search, 
  RefreshCw, 
  AlertCircle, 
  CheckCircle, 
  XCircle, 
  Clock, 
  DollarSign,
  Users,
  Activity,
  TrendingUp,
  Filter,
  Download,
  Eye,
  RotateCcw,
  Building2,
  Trash2
} from 'lucide-react'

interface AEPSTransaction {
  id: string
  user_id: string
  user_role: string
  merchant_id?: string
  transaction_type: string
  is_financial: boolean
  amount?: number
  aadhaar_number_masked?: string
  bank_iin?: string
  bank_name?: string
  account_number_masked?: string
  rrn?: string
  utr?: string
  order_id?: string
  status: string
  error_message?: string
  balance_after?: number
  wallet_debited?: boolean
  created_at: string
  completed_at?: string
  retailers?: { business_name?: string; mobile?: string }
  distributors?: { business_name?: string; mobile?: string }
}

interface AEPSMerchant {
  id: string
  user_id: string
  merchant_id: string
  name: string
  mobile: string
  email: string
  pan_number: string
  kyc_status: string
  bank_pipe?: string
  route?: string
  created_at: string
}

interface AEPSStats {
  totalTransactions: number
  successCount: number
  failedCount: number
  pendingCount: number
  totalVolume: number
  successRate: number
  merchantCount: number
  activeMerchants: number
}

type TabType = 'overview' | 'transactions' | 'merchants' | 'reconciliation' | 'settings'

export function AdminAEPSManagement() {
  const { user, loading: authLoading } = useAuth()
  const [activeTab, setActiveTab] = useState<TabType>('overview')
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<AEPSStats | null>(null)
  const [transactions, setTransactions] = useState<AEPSTransaction[]>([])
  const [merchants, setMerchants] = useState<AEPSMerchant[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [dateRange, setDateRange] = useState({ from: '', to: '' })
  const [selectedTransaction, setSelectedTransaction] = useState<AEPSTransaction | null>(null)
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [cleanupPreview, setCleanupPreview] = useState<any>(null)

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const response = await apiFetch('/api/admin/aeps/stats')
      if (!response.ok) throw new Error('Failed to fetch stats')
      const data = await response.json()
      setStats(data)
    } catch (err) {
      console.error('Error fetching AEPS stats:', err)
    }
  }, [])

  // Fetch transactions
  const fetchTransactions = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      params.set('limit', '100')
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (dateRange.from) params.set('from', dateRange.from)
      if (dateRange.to) params.set('to', dateRange.to)

      const response = await apiFetch(`/api/admin/aeps/transactions?${params.toString()}`)
      if (!response.ok) throw new Error('Failed to fetch transactions')
      const data = await response.json()
      setTransactions(data.transactions || [])
    } catch (err) {
      console.error('Error fetching transactions:', err)
    }
  }, [statusFilter, dateRange])

  // Fetch merchants
  const fetchMerchants = useCallback(async () => {
    try {
      const response = await apiFetch('/api/admin/aeps/merchants?limit=100')
      if (!response.ok) throw new Error('Failed to fetch merchants')
      const data = await response.json()
      setMerchants(data.merchants || [])
    } catch (err) {
      console.error('Error fetching merchants:', err)
    }
  }, [])

  // Load data based on active tab
  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      try {
        if (activeTab === 'overview') {
          await fetchStats()
        } else if (activeTab === 'transactions' || activeTab === 'reconciliation') {
          await fetchTransactions()
        } else if (activeTab === 'merchants') {
          await fetchMerchants()
        }
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [activeTab, fetchStats, fetchTransactions, fetchMerchants])

  // Handle reversal
  const handleReversal = async (txn: AEPSTransaction) => {
    if (!confirm(`Reverse transaction ${txn.order_id || txn.id}?\n\nThis will refund ₹${txn.amount} to the user's wallet.`)) {
      return
    }

    try {
      const response = await fetch('/api/admin/reversal/aeps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction_id: txn.id,
          reason: 'Admin reversal',
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Reversal failed')
      }

      alert('Reversal successful')
      fetchTransactions()
    } catch (err: any) {
      alert(`Error: ${err.message}`)
    }
  }

  // Preview cleanup
  const handleCleanupPreview = async () => {
    try {
      setCleanupLoading(true)
      const response = await apiFetch('/api/admin/aeps/cleanup')
      if (!response.ok) throw new Error('Failed to fetch cleanup preview')
      const data = await response.json()
      setCleanupPreview(data.summary)
    } catch (err: any) {
      alert(`Error: ${err.message}`)
    } finally {
      setCleanupLoading(false)
    }
  }

  // Execute cleanup
  const handleCleanup = async () => {
    if (!confirm(
      `⚠️ WARNING: This will permanently delete ALL AEPS data!\n\n` +
      `Transactions to delete: ${cleanupPreview?.transactions?.total || 0}\n` +
      `Merchants to delete: ${cleanupPreview?.merchants?.total || 0}\n\n` +
      `This action CANNOT be undone!\n\n` +
      `Type "DELETE" in the next prompt to confirm.`
    )) {
      return
    }

    const confirmation = prompt('Type DELETE to confirm:')
    if (confirmation !== 'DELETE') {
      alert('Cleanup cancelled - confirmation did not match')
      return
    }

    try {
      setCleanupLoading(true)
      const response = await apiFetch('/api/admin/aeps/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmDelete: true })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Cleanup failed')
      }

      const result = await response.json()
      alert(
        `✅ Cleanup completed successfully!\n\n` +
        `Deleted:\n` +
        `- Transactions: ${result.deleted.transactions}\n` +
        `- Merchants: ${result.deleted.merchants}\n\n` +
        `Remaining:\n` +
        `- Transactions: ${result.remaining.transactions}\n` +
        `- Merchants: ${result.remaining.merchants}`
      )
      
      setCleanupPreview(null)
      fetchStats()
      fetchTransactions()
      fetchMerchants()
    } catch (err: any) {
      alert(`Error: ${err.message}`)
    } finally {
      setCleanupLoading(false)
    }
  }

  // Export transactions
  const handleExport = () => {
    const csv = [
      ['ID', 'Order ID', 'Type', 'Amount', 'Status', 'User ID', 'Created At'].join(','),
      ...transactions.map(t => [
        t.id,
        t.order_id || '',
        t.transaction_type,
        t.amount || 0,
        t.status,
        t.user_id,
        t.created_at,
      ].join(','))
    ].join('\n')

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aeps-transactions-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      success: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
      pending: 'bg-yellow-100 text-yellow-800',
      under_reconciliation: 'bg-orange-100 text-orange-800',
      reversed: 'bg-purple-100 text-purple-800',
    }
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-800'}`}>
        {status.replace('_', ' ').toUpperCase()}
      </span>
    )
  }

  const formatCurrency = (amount: number) => 
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount)

  const formatDate = (date: string) => 
    new Date(date).toLocaleString('en-IN', { 
      dateStyle: 'short', 
      timeStyle: 'short' 
    })

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AEPS Management</h1>
          <p className="text-gray-600">Manage AEPS transactions, merchants, and reconciliation</p>
        </div>
        <button
          onClick={() => {
            fetchStats()
            fetchTransactions()
            fetchMerchants()
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8">
          {[
            { id: 'overview', label: 'Overview', icon: Activity },
            { id: 'transactions', label: 'Transactions', icon: DollarSign },
            { id: 'merchants', label: 'Merchants', icon: Building2 },
            { id: 'reconciliation', label: 'Reconciliation', icon: RotateCcw },
            { id: 'settings', label: 'Settings', icon: Filter },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`flex items-center gap-2 py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      ) : (
        <>
          {/* Overview Tab */}
          {activeTab === 'overview' && stats && (
            <div className="space-y-6">
              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white rounded-xl shadow-sm p-6 border">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">Today's Transactions</p>
                      <p className="text-3xl font-bold text-gray-900">{stats.totalTransactions}</p>
                    </div>
                    <div className="p-3 bg-blue-100 rounded-full">
                      <Activity className="w-6 h-6 text-blue-600" />
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm p-6 border">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">Today's Volume</p>
                      <p className="text-3xl font-bold text-gray-900">{formatCurrency(stats.totalVolume)}</p>
                    </div>
                    <div className="p-3 bg-green-100 rounded-full">
                      <DollarSign className="w-6 h-6 text-green-600" />
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm p-6 border">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">Success Rate</p>
                      <p className="text-3xl font-bold text-gray-900">{stats.successRate}%</p>
                    </div>
                    <div className="p-3 bg-purple-100 rounded-full">
                      <TrendingUp className="w-6 h-6 text-purple-600" />
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm p-6 border">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-gray-500">Active Merchants</p>
                      <p className="text-3xl font-bold text-gray-900">{stats.activeMerchants}/{stats.merchantCount}</p>
                    </div>
                    <div className="p-3 bg-orange-100 rounded-full">
                      <Users className="w-6 h-6 text-orange-600" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Status Breakdown */}
              <div className="bg-white rounded-xl shadow-sm p-6 border">
                <h3 className="text-lg font-semibold mb-4">Transaction Status Breakdown</h3>
                <div className="grid grid-cols-4 gap-4">
                  <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg">
                    <CheckCircle className="w-6 h-6 text-green-600" />
                    <div>
                      <p className="text-sm text-gray-500">Success</p>
                      <p className="text-xl font-bold text-green-600">{stats.successCount}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-4 bg-red-50 rounded-lg">
                    <XCircle className="w-6 h-6 text-red-600" />
                    <div>
                      <p className="text-sm text-gray-500">Failed</p>
                      <p className="text-xl font-bold text-red-600">{stats.failedCount}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-4 bg-yellow-50 rounded-lg">
                    <Clock className="w-6 h-6 text-yellow-600" />
                    <div>
                      <p className="text-sm text-gray-500">Pending</p>
                      <p className="text-xl font-bold text-yellow-600">{stats.pendingCount}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg">
                    <AlertCircle className="w-6 h-6 text-gray-600" />
                    <div>
                      <p className="text-sm text-gray-500">Reversed</p>
                      <p className="text-xl font-bold text-gray-600">0</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Transactions Tab */}
          {(activeTab === 'transactions' || activeTab === 'reconciliation') && (
            <div className="space-y-4">
              {/* Filters */}
              <div className="flex flex-wrap gap-4 items-center bg-white p-4 rounded-lg border">
                <div className="flex-1 min-w-[200px]">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search by Order ID, User ID..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="all">All Status</option>
                  <option value="success">Success</option>
                  <option value="failed">Failed</option>
                  <option value="pending">Pending</option>
                  <option value="under_reconciliation">Under Reconciliation</option>
                  <option value="reversed">Reversed</option>
                </select>
                <button
                  onClick={handleExport}
                  className="flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-gray-50"
                >
                  <Download className="w-4 h-4" />
                  Export CSV
                </button>
              </div>

              {/* Transactions Table */}
              <div className="bg-white rounded-lg border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Order ID</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {transactions
                        .filter(t => 
                          !searchTerm || 
                          t.order_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          t.user_id?.toLowerCase().includes(searchTerm.toLowerCase())
                        )
                        .filter(t => activeTab !== 'reconciliation' || t.status === 'under_reconciliation')
                        .map(txn => (
                          <tr key={txn.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3">
                              <span className="font-mono text-sm">{txn.order_id || txn.id.slice(0, 8)}</span>
                            </td>
                            <td className="px-4 py-3">
                              <span className="capitalize">{txn.transaction_type.replace('_', ' ')}</span>
                            </td>
                            <td className="px-4 py-3">
                              {txn.amount ? formatCurrency(txn.amount) : '-'}
                            </td>
                            <td className="px-4 py-3">
                              {getStatusBadge(txn.status)}
                            </td>
                            <td className="px-4 py-3">
                              <span className="text-sm text-gray-600">{txn.user_id.slice(0, 12)}...</span>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-500">
                              {formatDate(txn.created_at)}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex gap-2">
                                <button
                                  onClick={() => setSelectedTransaction(txn)}
                                  className="p-1 hover:bg-gray-100 rounded"
                                  title="View Details"
                                >
                                  <Eye className="w-4 h-4 text-gray-600" />
                                </button>
                                {txn.status === 'success' && txn.is_financial && (
                                  <button
                                    onClick={() => handleReversal(txn)}
                                    className="p-1 hover:bg-red-100 rounded"
                                    title="Reverse Transaction"
                                  >
                                    <RotateCcw className="w-4 h-4 text-red-600" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Merchants Tab */}
          {activeTab === 'merchants' && (
            <div className="bg-white rounded-lg border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Merchant ID</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Mobile</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">KYC Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Route</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {merchants.map(merchant => (
                      <tr key={merchant.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <span className="font-mono text-sm">{merchant.merchant_id}</span>
                        </td>
                        <td className="px-4 py-3 font-medium">{merchant.name}</td>
                        <td className="px-4 py-3">{merchant.mobile}</td>
                        <td className="px-4 py-3">
                          {getStatusBadge(merchant.kyc_status === 'validated' ? 'success' : merchant.kyc_status)}
                        </td>
                        <td className="px-4 py-3">{merchant.route || merchant.bank_pipe || '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">
                          {formatDate(merchant.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Settings Tab */}
          {activeTab === 'settings' && (
            <div className="space-y-6">
              <div className="bg-white rounded-lg border p-6 space-y-6">
                <h3 className="text-lg font-semibold">AEPS Configuration</h3>
                
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">API Mode</label>
                    <div className="flex items-center gap-4">
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                        process.env.NEXT_PUBLIC_AEPS_USE_MOCK === 'true' 
                          ? 'bg-yellow-100 text-yellow-800' 
                          : 'bg-green-100 text-green-800'
                      }`}>
                        {process.env.NEXT_PUBLIC_AEPS_USE_MOCK === 'true' ? 'MOCK MODE' : 'PRODUCTION'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500">
                      Set AEPS_USE_MOCK environment variable to switch modes
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">Worker Status</label>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                      <span className="text-sm text-gray-600">Running (aeps-worker)</span>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-6 space-y-4">
                  <h4 className="font-medium">Transaction Limits</h4>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <p className="text-sm text-gray-500">Min Withdrawal</p>
                      <p className="text-lg font-bold">₹100</p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <p className="text-sm text-gray-500">Max Withdrawal</p>
                      <p className="text-lg font-bold">₹10,000</p>
                    </div>
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <p className="text-sm text-gray-500">Daily Limit</p>
                      <p className="text-lg font-bold">₹50,000</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Data Cleanup Section */}
              <div className="bg-white rounded-lg border border-red-200 p-6 space-y-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-red-900">Danger Zone</h3>
                    <p className="text-sm text-red-700 mt-1">
                      Clean up test/dummy AEPS data. This action is permanent and cannot be undone.
                    </p>
                  </div>
                </div>

                {!cleanupPreview ? (
                  <button
                    onClick={handleCleanupPreview}
                    disabled={cleanupLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
                  >
                    {cleanupLoading ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                    Preview Data Cleanup
                  </button>
                ) : (
                  <div className="space-y-4">
                    <div className="bg-red-50 rounded-lg p-4 space-y-3">
                      <h4 className="font-medium text-red-900">Data to be deleted:</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm text-red-700">Transactions</p>
                          <p className="text-2xl font-bold text-red-900">{cleanupPreview.transactions.total}</p>
                          <div className="text-xs text-red-600 mt-1">
                            Success: {cleanupPreview.transactions.byStatus.success} | 
                            Failed: {cleanupPreview.transactions.byStatus.failed} | 
                            Pending: {cleanupPreview.transactions.byStatus.pending}
                          </div>
                        </div>
                        <div>
                          <p className="text-sm text-red-700">Merchants</p>
                          <p className="text-2xl font-bold text-red-900">{cleanupPreview.merchants.total}</p>
                        </div>
                      </div>
                      {cleanupPreview.transactions.oldestDate && (
                        <p className="text-xs text-red-600">
                          Date range: {new Date(cleanupPreview.transactions.oldestDate).toLocaleDateString()} to{' '}
                          {new Date(cleanupPreview.transactions.newestDate).toLocaleDateString()}
                        </p>
                      )}
                    </div>

                    <div className="flex gap-3">
                      <button
                        onClick={handleCleanup}
                        disabled={cleanupLoading}
                        className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                      >
                        {cleanupLoading ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                        Delete All AEPS Data
                      </button>
                      <button
                        onClick={() => setCleanupPreview(null)}
                        className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Transaction Detail Modal */}
      {selectedTransaction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full m-4 max-h-[80vh] overflow-y-auto">
            <div className="p-6 border-b">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold">Transaction Details</h2>
                <button
                  onClick={() => setSelectedTransaction(null)}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Order ID</p>
                  <p className="font-mono">{selectedTransaction.order_id || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Status</p>
                  {getStatusBadge(selectedTransaction.status)}
                </div>
                <div>
                  <p className="text-sm text-gray-500">Type</p>
                  <p className="capitalize">{selectedTransaction.transaction_type.replace('_', ' ')}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Amount</p>
                  <p className="font-bold">{selectedTransaction.amount ? formatCurrency(selectedTransaction.amount) : '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">UTR/RRN</p>
                  <p className="font-mono">{selectedTransaction.utr || selectedTransaction.rrn || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Bank</p>
                  <p>{selectedTransaction.bank_name || selectedTransaction.bank_iin || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Aadhaar</p>
                  <p>{selectedTransaction.aadhaar_number_masked || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Account</p>
                  <p>{selectedTransaction.account_number_masked || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">User ID</p>
                  <p className="font-mono text-sm">{selectedTransaction.user_id}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">User Role</p>
                  <p className="capitalize">{selectedTransaction.user_role}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Created At</p>
                  <p>{formatDate(selectedTransaction.created_at)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Completed At</p>
                  <p>{selectedTransaction.completed_at ? formatDate(selectedTransaction.completed_at) : '-'}</p>
                </div>
              </div>
              {selectedTransaction.error_message && (
                <div className="p-4 bg-red-50 rounded-lg">
                  <p className="text-sm font-medium text-red-800">Error Message</p>
                  <p className="text-red-600">{selectedTransaction.error_message}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminAEPSManagement
