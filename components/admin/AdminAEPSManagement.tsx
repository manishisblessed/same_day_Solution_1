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
  Trash2,
  Shield
} from 'lucide-react'
import AdminAEPSCommissionReport from './AdminAEPSCommissionReport'

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
  reversedCount: number
  totalVolume: number
  successRate: number
  merchantCount: number
  activeMerchants: number
}

type TabType = 'overview' | 'transactions' | 'merchants' | 'settlement-accounts' | 'bank-settlements' | 'commission-tds' | 'reconciliation' | 'settings'

interface SettlementAccountEntry {
  id: string
  user_id: string
  user_role: string
  account_number: string
  ifsc_code: string
  account_holder_name: string
  bank_name?: string
  verification_status: string
  verified_account_name?: string
  admin_status: string
  admin_remarks?: string
  created_at: string
  user_info?: { name?: string; business_name?: string; mobile?: string; email?: string; role?: string }
}

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
  const [error, setError] = useState<string | null>(null)
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [cleanupPreview, setCleanupPreview] = useState<any>(null)
  // Settlement accounts
  const [settleAccounts, setSettleAccounts] = useState<SettlementAccountEntry[]>([])
  const [settleAcctFilter, setSettleAcctFilter] = useState<string>('all')
  const [settleAcctProcessing, setSettleAcctProcessing] = useState<string | null>(null)
  // Reconciliation
  const [reconTransactions, setReconTransactions] = useState<AEPSTransaction[]>([])
  const [reconCounts, setReconCounts] = useState({ under_reconciliation: 0, pending: 0, reversed: 0, total: 0 })
  const [reconFilter, setReconFilter] = useState<string>('under_reconciliation')
  const [reconProcessing, setReconProcessing] = useState<string | null>(null)
  const [reconRemarks, setReconRemarks] = useState<string>('')
  // Bank settlements (AEPS settlement to bank)
  const [bankSettlements, setBankSettlements] = useState<any[]>([])
  const [bankSettleFilter, setBankSettleFilter] = useState<string>('pending')
  const [bankSettleProcessing, setBankSettleProcessing] = useState<string | null>(null)
  const [checkPendingLoading, setCheckPendingLoading] = useState(false)

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      setError(null)
      const response = await apiFetch('/api/admin/aeps/stats')
      if (!response.ok) throw new Error('Failed to fetch stats')
      const data = await response.json()
      setStats(data)
    } catch (err: any) {
      console.error('Error fetching AEPS stats:', err)
      setError(err.message || 'Failed to fetch stats')
    }
  }, [])

  // Fetch transactions
  const fetchTransactions = useCallback(async () => {
    try {
      setError(null)
      const params = new URLSearchParams()
      params.set('limit', '100')
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (dateRange.from) params.set('date_from', dateRange.from)
      if (dateRange.to) params.set('date_to', dateRange.to)

      const response = await apiFetch(`/api/admin/aeps/transactions?${params.toString()}`)
      if (!response.ok) throw new Error('Failed to fetch transactions')
      const data = await response.json()
      setTransactions(data.transactions || [])
    } catch (err: any) {
      console.error('Error fetching transactions:', err)
      setError(err.message || 'Failed to fetch transactions')
    }
  }, [statusFilter, dateRange])

  // Fetch merchants
  const fetchMerchants = useCallback(async () => {
    try {
      setError(null)
      const response = await apiFetch('/api/admin/aeps/merchants?limit=100')
      if (!response.ok) throw new Error('Failed to fetch merchants')
      const data = await response.json()
      setMerchants(data.merchants || [])
    } catch (err: any) {
      console.error('Error fetching merchants:', err)
      setError(err.message || 'Failed to fetch merchants')
    }
  }, [])

  const fetchSettleAccounts = useCallback(async () => {
    try {
      setError(null)
      const response = await apiFetch(`/api/admin/aeps/settlement-accounts?status=${settleAcctFilter}`)
      if (!response.ok) throw new Error('Failed to fetch settlement accounts')
      const data = await response.json()
      setSettleAccounts(data.accounts || [])
    } catch (err: any) {
      console.error('Error fetching settlement accounts:', err)
      setError(err.message || 'Failed to fetch settlement accounts')
    }
  }, [settleAcctFilter])

  // Fetch AEPS bank settlements
  const fetchBankSettlements = useCallback(async () => {
    try {
      setError(null)
      const params = new URLSearchParams()
      if (bankSettleFilter !== 'all') params.set('status', bankSettleFilter)
      params.set('limit', '100')
      const response = await apiFetch(`/api/admin/aeps/bank-settlements?${params.toString()}`)
      if (!response.ok) throw new Error('Failed to fetch AEPS bank settlements')
      const data = await response.json()
      setBankSettlements(data.settlements || [])
    } catch (err: any) {
      console.error('Error fetching bank settlements:', err)
      setError(err.message || 'Failed to fetch bank settlements')
    }
  }, [bankSettleFilter])

  // Check pending AEPS settlements
  const handleCheckPending = async () => {
    setCheckPendingLoading(true)
    try {
      const response = await apiFetch('/api/aeps/settlement/check-pending', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ include_details: true }),
      })
      const data = await response.json()
      if (data.success) {
        alert(`Check complete:\n- Checked: ${data.checked}\n- Resolved: ${data.resolved}\n- Refunded: ${data.refunded}\n- Still pending: ${data.still_pending}`)
        fetchBankSettlements()
      } else {
        alert(`Error: ${data.error}`)
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`)
    } finally {
      setCheckPendingLoading(false)
    }
  }

  // Reverse AEPS bank settlement
  const handleBankSettleReversal = async (settlement: any) => {
    const reason = prompt(`Reverse AEPS settlement ₹${settlement.amount} for ${settlement.bank_account_name}?\n\nEnter reason:`)
    if (!reason) return

    setBankSettleProcessing(settlement.id)
    try {
      const response = await apiFetch('/api/admin/reversal/aeps-settlement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settlement_id: settlement.id,
          reason,
        }),
      })
      const data = await response.json()
      if (data.success) {
        alert(`Reversed successfully.\nBefore: ₹${data.before_balance}\nAfter: ₹${data.after_balance}${data.margins_reversed?.length ? `\nMargins reversed: ${data.margins_reversed.join(', ')}` : ''}`)
        fetchBankSettlements()
      } else {
        alert(`Error: ${data.error}`)
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`)
    } finally {
      setBankSettleProcessing(null)
    }
  }

  // Fetch reconciliation data
  const fetchReconciliation = useCallback(async () => {
    try {
      setError(null)
      const response = await apiFetch(`/api/admin/aeps/reconciliation?status=${reconFilter}&limit=100`)
      if (!response.ok) throw new Error('Failed to fetch reconciliation data')
      const data = await response.json()
      setReconTransactions(data.transactions || [])
      setReconCounts(data.counts || { under_reconciliation: 0, pending: 0, reversed: 0, total: 0 })
    } catch (err: any) {
      console.error('Error fetching reconciliation:', err)
      setError(err.message || 'Failed to fetch reconciliation data')
    }
  }, [reconFilter])

  // Reconciliation actions
  const handleReconAction = async (txnId: string, action: string, actionLabel: string) => {
    const remarks = reconRemarks.trim()
    if (action === 'force_refund' && !confirm(`Are you sure you want to force refund this transaction? This will credit the user's AEPS wallet.`)) {
      return
    }

    setReconProcessing(txnId)
    try {
      const response = await apiFetch('/api/admin/aeps/reconciliation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction_id: txnId, action, remarks: remarks || undefined }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || `Failed to ${actionLabel}`)
      alert(data.message || `${actionLabel} successful`)
      setReconRemarks('')
      fetchReconciliation()
    } catch (err: any) {
      alert(`Error: ${err.message}`)
    } finally {
      setReconProcessing(null)
    }
  }

  const handleSettleAccountAction = async (accountId: string, action: 'approve' | 'reject') => {
    const remarks = action === 'reject' ? prompt('Rejection reason (optional):') : null
    setSettleAcctProcessing(accountId)
    try {
      const response = await apiFetch('/api/admin/aeps/settlement-accounts/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, action, remarks: remarks || undefined }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || `Failed to ${action}`)
      }
      alert(`Account ${action}d successfully`)
      fetchSettleAccounts()
    } catch (err: any) {
      alert(`Error: ${err.message}`)
    } finally {
      setSettleAcctProcessing(null)
    }
  }

  // Load data based on active tab
  useEffect(() => {
    const loadData = async () => {
      setLoading(true)
      try {
        if (activeTab === 'overview') {
          await fetchStats()
        } else if (activeTab === 'transactions') {
          await fetchTransactions()
        } else if (activeTab === 'reconciliation') {
          await fetchReconciliation()
        } else if (activeTab === 'merchants') {
          await fetchMerchants()
        } else if (activeTab === 'settlement-accounts') {
          await fetchSettleAccounts()
        } else if (activeTab === 'bank-settlements') {
          await fetchBankSettlements()
        }
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [activeTab, fetchStats, fetchTransactions, fetchMerchants, fetchSettleAccounts, fetchBankSettlements, fetchReconciliation])

  // Handle reversal
  const handleReversal = async (txn: AEPSTransaction) => {
    if (!confirm(`Reverse transaction ${txn.order_id || txn.id}?\n\nThis will refund ₹${txn.amount} to the user's wallet.`)) {
      return
    }

    try {
      const response = await apiFetch('/api/admin/reversal/aeps', {
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
            if (activeTab === 'overview') fetchStats()
            else if (activeTab === 'transactions') fetchTransactions()
            else if (activeTab === 'merchants') fetchMerchants()
            else if (activeTab === 'reconciliation') fetchReconciliation()
            else if (activeTab === 'settlement-accounts') fetchSettleAccounts()
            else if (activeTab === 'bank-settlements') fetchBankSettlements()
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
            { id: 'settlement-accounts', label: 'Settlement Accounts', icon: CheckCircle },
            { id: 'bank-settlements', label: 'Bank Settlements', icon: TrendingUp },
            { id: 'commission-tds', label: 'Commission & TDS', icon: Shield },
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

      {/* Error Banner */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
          <p className="text-sm text-red-800">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-red-600 hover:text-red-800">
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      )}

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
                      <p className="text-xl font-bold text-gray-600">{stats.reversedCount ?? 0}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Transactions Tab */}
          {activeTab === 'transactions' && (
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
                              <span className="text-sm text-gray-600">{txn.user_id}</span>
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
                  {transactions.length === 0 && (
                    <div className="text-center py-12 text-gray-500">
                      <Activity className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                      <p>No transactions found</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Reconciliation Tab */}
          {activeTab === 'reconciliation' && (
            <div className="space-y-4">
              {/* Status Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 flex items-center gap-3">
                  <Clock className="w-8 h-8 text-orange-600" />
                  <div>
                    <p className="text-sm text-orange-700">Under Reconciliation</p>
                    <p className="text-2xl font-bold text-orange-900">{reconCounts.under_reconciliation}</p>
                  </div>
                </div>
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-center gap-3">
                  <Clock className="w-8 h-8 text-yellow-600" />
                  <div>
                    <p className="text-sm text-yellow-700">Stuck Pending</p>
                    <p className="text-2xl font-bold text-yellow-900">{reconCounts.pending}</p>
                  </div>
                </div>
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 flex items-center gap-3">
                  <RotateCcw className="w-8 h-8 text-purple-600" />
                  <div>
                    <p className="text-sm text-purple-700">Reversed</p>
                    <p className="text-2xl font-bold text-purple-900">{reconCounts.reversed}</p>
                  </div>
                </div>
              </div>

              {/* Filters */}
              <div className="flex items-center gap-3 bg-white p-4 rounded-lg border">
                <select
                  value={reconFilter}
                  onChange={(e) => setReconFilter(e.target.value)}
                  className="px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="under_reconciliation">Under Reconciliation</option>
                  <option value="pending">Stuck Pending</option>
                  <option value="reversed">Reversed</option>
                  <option value="all">All Flagged</option>
                </select>
                <button
                  onClick={fetchReconciliation}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh
                </button>
                <div className="flex-1" />
                <input
                  type="text"
                  placeholder="Remarks for action..."
                  value={reconRemarks}
                  onChange={(e) => setReconRemarks(e.target.value)}
                  className="px-4 py-2 border rounded-lg w-64 focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Reconciliation Table */}
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
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Error</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {reconTransactions.map(txn => (
                        <tr key={txn.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <span className="font-mono text-sm">{txn.order_id || txn.id.slice(0, 8)}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="capitalize text-sm">{txn.transaction_type.replace('_', ' ')}</span>
                          </td>
                          <td className="px-4 py-3 font-medium">
                            {txn.amount ? formatCurrency(txn.amount) : '-'}
                          </td>
                          <td className="px-4 py-3">
                            {getStatusBadge(txn.status)}
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm text-gray-600">{txn.user_id}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs text-red-600 max-w-[200px] truncate block">
                              {txn.error_message || '-'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {formatDate(txn.created_at)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              <button
                                onClick={() => setSelectedTransaction(txn)}
                                className="p-1 hover:bg-gray-100 rounded"
                                title="View Details"
                              >
                                <Eye className="w-4 h-4 text-gray-600" />
                              </button>
                              {txn.status === 'under_reconciliation' && (
                                <>
                                  <button
                                    onClick={() => handleReconAction(txn.id, 'retry_check', 'Retry Check')}
                                    disabled={reconProcessing === txn.id}
                                    className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 disabled:opacity-50"
                                    title="Check status with payment provider"
                                  >
                                    {reconProcessing === txn.id ? '...' : 'Retry'}
                                  </button>
                                  <button
                                    onClick={() => handleReconAction(txn.id, 'mark_success', 'Mark Success')}
                                    disabled={reconProcessing === txn.id}
                                    className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 disabled:opacity-50"
                                    title="Mark as successful"
                                  >
                                    Success
                                  </button>
                                  <button
                                    onClick={() => handleReconAction(txn.id, 'mark_failed', 'Mark Failed')}
                                    disabled={reconProcessing === txn.id}
                                    className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50"
                                    title="Mark as failed + auto-refund if applicable"
                                  >
                                    Failed
                                  </button>
                                </>
                              )}
                              {(txn.status === 'under_reconciliation' || txn.status === 'failed') && txn.is_financial && txn.amount && (
                                <button
                                  onClick={() => handleReconAction(txn.id, 'force_refund', 'Force Refund')}
                                  disabled={reconProcessing === txn.id}
                                  className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200 disabled:opacity-50"
                                  title="Force refund to user wallet"
                                >
                                  Refund
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {reconTransactions.length === 0 && (
                    <div className="text-center py-12 text-gray-500">
                      <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-300" />
                      <p>No transactions need reconciliation</p>
                      <p className="text-sm mt-1">All transactions are settled</p>
                    </div>
                  )}
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

          {/* Settlement Accounts Tab */}
          {activeTab === 'settlement-accounts' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">AEPS Settlement Account Approvals</h2>
                <div className="flex items-center gap-2">
                  <select value={settleAcctFilter}
                    onChange={(e) => setSettleAcctFilter(e.target.value)}
                    className="px-3 py-1.5 border rounded-lg text-sm">
                    <option value="pending_approval">Pending Approval</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                    <option value="all">All</option>
                  </select>
                  <button onClick={fetchSettleAccounts}
                    className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                    <RefreshCw className="w-3.5 h-3.5" /> Refresh
                  </button>
                </div>
              </div>

              {settleAccounts.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <CheckCircle className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No settlement accounts with status: {settleAcctFilter.replace('_', ' ')}</p>
                </div>
              ) : (
                <div className="bg-white rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">User</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Bank Account</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Verification</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Submitted</th>
                        <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {settleAccounts.map((acct) => (
                        <tr key={acct.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <p className="font-medium">{acct.user_info?.business_name || acct.user_info?.name || acct.user_id}</p>
                            <p className="text-xs text-gray-500">{acct.user_info?.mobile || ''} {acct.user_info?.email ? `· ${acct.user_info.email}` : ''}</p>
                            <p className="text-xs text-gray-400 capitalize">{acct.user_role?.replace('_', ' ')}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-mono text-sm">{acct.account_number}</p>
                            <p className="text-xs text-gray-500">{acct.ifsc_code} · {acct.bank_name || ''}</p>
                            <p className="text-xs font-medium">{acct.account_holder_name}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              acct.verification_status === 'verified' ? 'bg-green-100 text-green-800' :
                              acct.verification_status === 'failed' ? 'bg-red-100 text-red-800' :
                              'bg-yellow-100 text-yellow-800'
                            }`}>
                              {acct.verification_status}
                            </span>
                            {acct.verified_account_name && (
                              <p className="text-xs text-blue-600 mt-1">Bank name: {acct.verified_account_name}</p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              acct.admin_status === 'approved' ? 'bg-green-100 text-green-800' :
                              acct.admin_status === 'rejected' ? 'bg-red-100 text-red-800' :
                              'bg-yellow-100 text-yellow-800'
                            }`}>
                              {acct.admin_status.replace('_', ' ').toUpperCase()}
                            </span>
                            {acct.admin_remarks && (
                              <p className="text-xs text-gray-500 mt-1">{acct.admin_remarks}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">{formatDate(acct.created_at)}</td>
                          <td className="px-4 py-3 text-right">
                            {acct.admin_status === 'pending_approval' && (
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => handleSettleAccountAction(acct.id, 'approve')}
                                  disabled={settleAcctProcessing === acct.id}
                                  className="px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:opacity-50">
                                  {settleAcctProcessing === acct.id ? '...' : 'Approve'}
                                </button>
                                <button
                                  onClick={() => handleSettleAccountAction(acct.id, 'reject')}
                                  disabled={settleAcctProcessing === acct.id}
                                  className="px-3 py-1.5 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700 disabled:opacity-50">
                                  Reject
                                </button>
                              </div>
                            )}
                            {acct.admin_status === 'approved' && (
                              <span className="text-green-600 text-xs">Active</span>
                            )}
                            {acct.admin_status === 'rejected' && (
                              <span className="text-red-500 text-xs">Rejected</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Bank Settlements Tab */}
          {activeTab === 'bank-settlements' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">AEPS Bank Settlements</h2>
                <div className="flex items-center gap-2">
                  <select value={bankSettleFilter}
                    onChange={(e) => setBankSettleFilter(e.target.value)}
                    className="px-3 py-1.5 border rounded-lg text-sm">
                    <option value="pending">Pending</option>
                    <option value="processing">Processing</option>
                    <option value="success">Success</option>
                    <option value="failed">Failed</option>
                    <option value="reversed">Reversed</option>
                    <option value="all">All</option>
                  </select>
                  <button onClick={handleCheckPending}
                    disabled={checkPendingLoading}
                    className="flex items-center gap-1 px-3 py-1.5 bg-orange-600 text-white rounded-lg text-sm hover:bg-orange-700 disabled:opacity-50">
                    <RotateCcw className={`w-3.5 h-3.5 ${checkPendingLoading ? 'animate-spin' : ''}`} />
                    {checkPendingLoading ? 'Checking...' : 'Check Pending'}
                  </button>
                  <button onClick={fetchBankSettlements}
                    className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
                    <RefreshCw className="w-3.5 h-3.5" /> Refresh
                  </button>
                </div>
              </div>

              {bankSettlements.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <DollarSign className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>No AEPS bank settlements with status: {bankSettleFilter}</p>
                </div>
              ) : (
                <div className="bg-white rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">User</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Bank Account</th>
                        <th className="text-right px-4 py-3 font-medium text-gray-600">Amount</th>
                        <th className="text-right px-4 py-3 font-medium text-gray-600">Charge</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Ref ID</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                        <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {bankSettlements.map((s) => (
                        <tr key={s.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{formatDate(s.created_at)}</td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-sm">{s.user_info?.business_name || s.user_info?.name || s.user_id?.slice(0, 8)}</p>
                            <p className="text-xs text-gray-400 capitalize">{s.user_role?.replace('_', ' ')}</p>
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-mono text-xs">{s.bank_account_number}</p>
                            <p className="text-xs text-gray-500">{s.bank_ifsc} · {s.bank_account_name}</p>
                          </td>
                          <td className="px-4 py-3 text-right font-medium">{formatCurrency(s.amount)}</td>
                          <td className="px-4 py-3 text-right text-gray-500">{formatCurrency(s.charge || 0)}</td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-500">{s.payout_reference_id || '-'}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              s.status === 'success' ? 'bg-green-100 text-green-800' :
                              s.status === 'failed' ? 'bg-red-100 text-red-800' :
                              s.status === 'reversed' ? 'bg-purple-100 text-purple-800' :
                              s.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                              'bg-yellow-100 text-yellow-800'
                            }`}>
                              {s.status}
                            </span>
                            {s.failure_reason && (
                              <p className="text-xs text-red-500 mt-1 max-w-[200px] truncate" title={s.failure_reason}>{s.failure_reason}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {['pending', 'processing'].includes(s.status) && (
                              <button
                                onClick={() => handleBankSettleReversal(s)}
                                disabled={bankSettleProcessing === s.id}
                                className="flex items-center gap-1 px-2 py-1 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100 disabled:opacity-50 ml-auto"
                              >
                                <RotateCcw className="w-3 h-3" />
                                {bankSettleProcessing === s.id ? 'Reversing...' : 'Reverse'}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Commission & TDS Tab */}
          {activeTab === 'commission-tds' && (
            <AdminAEPSCommissionReport />
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
                      Set NEXT_PUBLIC_AEPS_USE_MOCK and AEPS_USE_MOCK environment variables to switch modes
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">Worker Status</label>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 bg-gray-400 rounded-full"></span>
                      <span className="text-sm text-gray-600">aeps-worker (check PM2 on server)</span>
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
