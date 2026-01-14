'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import AdminSidebar from '@/components/AdminSidebar'
import {
  Wallet, ArrowUpCircle, ArrowDownCircle, Lock, Unlock,
  Snowflake, Sun, Search, Filter, Download, RefreshCw,
  Users, Building2, Crown, DollarSign, TrendingUp, Settings,
  AlertCircle, FileText, RotateCcw, Shield, BarChart3,
  ToggleLeft, ToggleRight, Sliders, XCircle, CheckCircle
} from 'lucide-react'
import { motion } from 'framer-motion'

type TabType = 'wallet' | 'commission' | 'mdr' | 'limits' | 'services' | 'reversals' | 'disputes' | 'reports' | 'slabs'

export default function AdminCapabilities() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabType>('wallet')
  const [loading, setLoading] = useState(false)
  const [users, setUsers] = useState<any[]>([])
  const [selectedUser, setSelectedUser] = useState<any>(null)
  const [showModal, setShowModal] = useState(false)
  const [modalData, setModalData] = useState<any>({})

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'admin')) {
      router.push('/admin/login')
    }
  }, [user, authLoading, router])

  useEffect(() => {
    if (user?.role === 'admin') {
      fetchUsers()
    }
  }, [user])

  const fetchUsers = async () => {
    setLoading(true)
    try {
      const [retailers, distributors, masterDistributors] = await Promise.all([
        supabase.from('retailers').select('id, partner_id, name, email, status, retailer_mdr_rate, aeps_enabled, bbps_enabled').order('created_at', { ascending: false }),
        supabase.from('distributors').select('id, partner_id, name, email, status, approved_mdr_rate, aeps_enabled, bbps_enabled').order('created_at', { ascending: false }),
        supabase.from('master_distributors').select('id, partner_id, name, email, status, approved_mdr_rate, aeps_enabled, bbps_enabled').order('created_at', { ascending: false })
      ])

      const allUsers = [
        ...(retailers.data || []).map(u => ({ ...u, user_type: 'retailer' })),
        ...(distributors.data || []).map(u => ({ ...u, user_type: 'distributor' })),
        ...(masterDistributors.data || []).map(u => ({ ...u, user_type: 'master_distributor' }))
      ]

      setUsers(allUsers)
    } catch (error) {
      console.error('Error fetching users:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleAction = async (action: string, data: any) => {
    try {
      let endpoint = ''
      let body: any = {}

      switch (action) {
        case 'commission_push':
          endpoint = '/api/admin/commission/push'
          body = {
            user_id: selectedUser.partner_id,
            user_role: selectedUser.user_type,
            amount: parseFloat(data.amount),
            remarks: data.remarks
          }
          break
        case 'commission_pull':
          endpoint = '/api/admin/commission/pull'
          body = {
            user_id: selectedUser.partner_id,
            user_role: selectedUser.user_type,
            amount: parseFloat(data.amount),
            remarks: data.remarks
          }
          break
        case 'mdr_adjust':
          endpoint = '/api/admin/mdr/adjust'
          body = {
            user_id: selectedUser.partner_id,
            user_role: selectedUser.user_type,
            new_mdr_rate: parseFloat(data.mdr_rate) / 100, // Convert percentage to decimal
            remarks: data.remarks
          }
          break
        case 'toggle_service':
          endpoint = '/api/admin/user/services/toggle'
          body = {
            user_id: selectedUser.partner_id,
            user_role: selectedUser.user_type,
            service_type: data.service_type,
            enabled: data.enabled
          }
          break
        case 'limit_override':
          endpoint = '/api/admin/limits/override'
          body = {
            user_id: selectedUser.partner_id,
            user_role: selectedUser.user_type,
            wallet_type: data.wallet_type || 'primary',
            limit_type: data.limit_type,
            override_all: data.override_all || false,
            override_reason: data.override_reason
          }
          break
        case 'bbps_reversal':
          endpoint = '/api/admin/reversal/bbps'
          body = {
            transaction_id: data.transaction_id,
            reason: data.reason,
            remarks: data.remarks
          }
          break
        case 'aeps_reversal':
          endpoint = '/api/admin/reversal/aeps'
          body = {
            transaction_id: data.transaction_id,
            reason: data.reason,
            remarks: data.remarks,
            reconciliation_date: data.reconciliation_date
          }
          break
        case 'settlement_reversal':
          endpoint = '/api/admin/reversal/settlement'
          body = {
            settlement_id: data.settlement_id,
            reason: data.reason,
            remarks: data.remarks
          }
          break
        case 'dispute_handle':
          endpoint = '/api/admin/dispute/handle'
          body = {
            dispute_id: data.dispute_id,
            action: data.action,
            resolution: data.resolution,
            remarks: data.remarks
          }
          break
        case 'settlement_slab_toggle':
          endpoint = '/api/admin/settlement-slabs/update'
          body = {
            slab_id: data.slab_id,
            is_enabled: data.is_enabled
          }
          break
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      const result = await response.json()
      if (result.success) {
        alert(result.message || 'Action completed successfully!')
        setShowModal(false)
        setSelectedUser(null)
        setModalData({})
        fetchUsers()
      } else {
        alert(result.error || 'Action failed')
      }
    } catch (error) {
      console.error('Action error:', error)
      alert('Failed to perform action')
    }
  }

  const downloadReport = async (type: string, format: string = 'csv') => {
    try {
      const startDate = modalData.start_date || ''
      const endDate = modalData.end_date || ''
      const userId = modalData.user_id || ''

      const url = `/api/admin/reports?type=${type}&format=${format}&start=${startDate}&end=${endDate}&user_id=${userId}`
      
      const response = await fetch(url)
      if (response.ok) {
        if (format === 'csv') {
          const blob = await response.blob()
          const downloadUrl = window.URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = downloadUrl
          a.download = `${type}_report_${Date.now()}.csv`
          document.body.appendChild(a)
          a.click()
          window.URL.revokeObjectURL(downloadUrl)
          document.body.removeChild(a)
        } else {
          const data = await response.json()
          console.log('Report data:', data)
          alert('Report generated. Check console for data.')
        }
        setShowModal(false)
        setModalData({})
      } else {
        alert('Failed to generate report')
      }
    } catch (error) {
      console.error('Report error:', error)
      alert('Failed to generate report')
    }
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  const tabs = [
    { id: 'wallet' as TabType, label: 'Wallet Operations', icon: Wallet },
    { id: 'commission' as TabType, label: 'Commission', icon: TrendingUp },
    { id: 'mdr' as TabType, label: 'MDR Adjustment', icon: DollarSign },
    { id: 'limits' as TabType, label: 'Limits & Overrides', icon: Sliders },
    { id: 'services' as TabType, label: 'Services Toggle', icon: ToggleRight },
    { id: 'slabs' as TabType, label: 'Slabs Management', icon: BarChart3 },
    { id: 'reversals' as TabType, label: 'Reversals', icon: RotateCcw },
    { id: 'disputes' as TabType, label: 'Disputes', icon: AlertCircle },
    { id: 'reports' as TabType, label: 'Reports', icon: FileText }
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminSidebar isOpen={true} onClose={() => {}} />
      <div className="ml-64 p-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Admin Capabilities</h1>
          <p className="text-gray-600">Comprehensive admin control panel</p>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow mb-6">
          <div className="flex space-x-1 border-b border-gray-200 p-1 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-all rounded-lg ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white'
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
        <div className="bg-white rounded-lg shadow p-6">
          {activeTab === 'wallet' && (
            <div className="space-y-4">
              <p className="text-gray-600">Wallet operations are available in the <a href="/admin/wallet-management" className="text-blue-600 underline">Wallet Management</a> page.</p>
            </div>
          )}

          {activeTab === 'commission' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Commission Management</h3>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => {
                    setShowModal(true)
                    setModalData({ action: 'commission_push' })
                  }}
                  className="p-4 border rounded-lg hover:bg-gray-50 flex items-center gap-3"
                >
                  <ArrowUpCircle className="w-6 h-6 text-green-600" />
                  <div>
                    <p className="font-medium">Push Commission</p>
                    <p className="text-sm text-gray-500">Add commission to user</p>
                  </div>
                </button>
                <button
                  onClick={() => {
                    setShowModal(true)
                    setModalData({ action: 'commission_pull' })
                  }}
                  className="p-4 border rounded-lg hover:bg-gray-50 flex items-center gap-3"
                >
                  <ArrowDownCircle className="w-6 h-6 text-red-600" />
                  <div>
                    <p className="font-medium">Pull Commission</p>
                    <p className="text-sm text-gray-500">Deduct commission from user</p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'mdr' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">MDR Adjustment</h3>
              <p className="text-gray-600">Adjust MDR rates within allowed caps</p>
              <div className="border rounded-lg p-4">
                <p className="text-sm text-gray-600 mb-2">MDR Caps:</p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>Retailer: 0.5% - 5%</li>
                  <li>Distributor: 0.3% - 3%</li>
                  <li>Master Distributor: 0.1% - 2%</li>
                </ul>
              </div>
              <button
                onClick={() => {
                  setShowModal(true)
                  setModalData({ action: 'mdr_adjust' })
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Adjust MDR Rate
              </button>
            </div>
          )}

          {activeTab === 'limits' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Limit Override</h3>
              <p className="text-gray-600">Override transaction limits for specific users</p>
              <button
                onClick={() => {
                  setShowModal(true)
                  setModalData({ action: 'limit_override' })
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Override Limits
              </button>
            </div>
          )}

          {activeTab === 'services' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Enable/Disable Services</h3>
              <p className="text-gray-600">Toggle AEPS and BBPS services per user</p>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => {
                    setShowModal(true)
                    setModalData({ action: 'toggle_service', service_type: 'aeps' })
                  }}
                  className="p-4 border rounded-lg hover:bg-gray-50"
                >
                  <p className="font-medium">Toggle AEPS</p>
                </button>
                <button
                  onClick={() => {
                    setShowModal(true)
                    setModalData({ action: 'toggle_service', service_type: 'bbps' })
                  }}
                  className="p-4 border rounded-lg hover:bg-gray-50"
                >
                  <p className="font-medium">Toggle BBPS</p>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'slabs' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Settlement Slabs</h3>
              <p className="text-gray-600">Activate/deactivate settlement charge slabs</p>
              <button
                onClick={() => {
                  setShowModal(true)
                  setModalData({ action: 'settlement_slab_toggle' })
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Manage Slabs
              </button>
            </div>
          )}

          {activeTab === 'reversals' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Transaction Reversals</h3>
              <div className="grid grid-cols-3 gap-4">
                <button
                  onClick={() => {
                    setShowModal(true)
                    setModalData({ action: 'bbps_reversal' })
                  }}
                  className="p-4 border rounded-lg hover:bg-gray-50"
                >
                  <p className="font-medium">BBPS Reversal</p>
                </button>
                <button
                  onClick={() => {
                    setShowModal(true)
                    setModalData({ action: 'aeps_reversal' })
                  }}
                  className="p-4 border rounded-lg hover:bg-gray-50"
                >
                  <p className="font-medium">AEPS Reversal</p>
                </button>
                <button
                  onClick={() => {
                    setShowModal(true)
                    setModalData({ action: 'settlement_reversal' })
                  }}
                  className="p-4 border rounded-lg hover:bg-gray-50"
                >
                  <p className="font-medium">Settlement Reversal</p>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'disputes' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Dispute Handling</h3>
              <p className="text-gray-600">Handle disputes with HOLD state</p>
              <button
                onClick={() => {
                  setShowModal(true)
                  setModalData({ action: 'dispute_handle' })
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Handle Dispute
              </button>
            </div>
          )}

          {activeTab === 'reports' && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Real-time Reports</h3>
              <p className="text-gray-600">View and download reports</p>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => downloadReport('transactions', 'csv')}
                  className="p-4 border rounded-lg hover:bg-gray-50 flex items-center gap-3"
                >
                  <Download className="w-5 h-5" />
                  <div>
                    <p className="font-medium">Transactions Report</p>
                    <p className="text-sm text-gray-500">CSV format</p>
                  </div>
                </button>
                <button
                  onClick={() => downloadReport('ledger', 'csv')}
                  className="p-4 border rounded-lg hover:bg-gray-50 flex items-center gap-3"
                >
                  <Download className="w-5 h-5" />
                  <div>
                    <p className="font-medium">Ledger Report</p>
                    <p className="text-sm text-gray-500">CSV format</p>
                  </div>
                </button>
                <button
                  onClick={() => downloadReport('commission', 'csv')}
                  className="p-4 border rounded-lg hover:bg-gray-50 flex items-center gap-3"
                >
                  <Download className="w-5 h-5" />
                  <div>
                    <p className="font-medium">Commission Report</p>
                    <p className="text-sm text-gray-500">CSV format</p>
                  </div>
                </button>
                <button
                  onClick={() => downloadReport('audit', 'csv')}
                  className="p-4 border rounded-lg hover:bg-gray-50 flex items-center gap-3"
                >
                  <Download className="w-5 h-5" />
                  <div>
                    <p className="font-medium">Audit Log Report</p>
                    <p className="text-sm text-gray-500">CSV format</p>
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold">Admin Action</h3>
                <button
                  onClick={() => {
                    setShowModal(false)
                    setModalData({})
                    setSelectedUser(null)
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircle className="w-6 h-6" />
                </button>
              </div>

              {/* User Selection */}
              {['commission_push', 'commission_pull', 'mdr_adjust', 'toggle_service', 'limit_override'].includes(modalData.action) && (
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-1">Select User</label>
                  <select
                    value={selectedUser?.partner_id || ''}
                    onChange={(e) => {
                      const user = users.find(u => u.partner_id === e.target.value)
                      setSelectedUser(user)
                    }}
                    className="w-full px-4 py-2 border rounded-lg"
                  >
                    <option value="">Select a user...</option>
                    {users.map(u => (
                      <option key={u.id} value={u.partner_id}>
                        {u.name} ({u.partner_id}) - {u.user_type}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Action-specific fields */}
              {modalData.action === 'commission_push' && selectedUser && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Amount (₹)</label>
                    <input
                      type="number"
                      value={modalData.amount || ''}
                      onChange={(e) => setModalData({ ...modalData, amount: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                      placeholder="Enter amount"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Remarks</label>
                    <textarea
                      value={modalData.remarks || ''}
                      onChange={(e) => setModalData({ ...modalData, remarks: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                      rows={3}
                    />
                  </div>
                  <button
                    onClick={() => handleAction('commission_push', modalData)}
                    className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700"
                  >
                    Push Commission
                  </button>
                </div>
              )}

              {modalData.action === 'commission_pull' && selectedUser && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Amount (₹)</label>
                    <input
                      type="number"
                      value={modalData.amount || ''}
                      onChange={(e) => setModalData({ ...modalData, amount: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                      placeholder="Enter amount"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Remarks</label>
                    <textarea
                      value={modalData.remarks || ''}
                      onChange={(e) => setModalData({ ...modalData, remarks: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                      rows={3}
                    />
                  </div>
                  <button
                    onClick={() => handleAction('commission_pull', modalData)}
                    className="w-full bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700"
                  >
                    Pull Commission
                  </button>
                </div>
              )}

              {modalData.action === 'mdr_adjust' && selectedUser && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">New MDR Rate (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={modalData.mdr_rate || ''}
                      onChange={(e) => setModalData({ ...modalData, mdr_rate: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                      placeholder="e.g., 1.5 for 1.5%"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Current: {selectedUser.user_type === 'retailer' 
                        ? (selectedUser.retailer_mdr_rate * 100).toFixed(2) + '%'
                        : (selectedUser.approved_mdr_rate * 100).toFixed(2) + '%'}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Remarks</label>
                    <textarea
                      value={modalData.remarks || ''}
                      onChange={(e) => setModalData({ ...modalData, remarks: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                      rows={3}
                    />
                  </div>
                  <button
                    onClick={() => handleAction('mdr_adjust', modalData)}
                    className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700"
                  >
                    Adjust MDR
                  </button>
                </div>
              )}

              {modalData.action === 'toggle_service' && selectedUser && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Service</label>
                    <select
                      value={modalData.service_type || ''}
                      onChange={(e) => setModalData({ ...modalData, service_type: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                    >
                      <option value="aeps">AEPS</option>
                      <option value="bbps">BBPS</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Status</label>
                    <select
                      value={modalData.enabled !== undefined ? modalData.enabled.toString() : ''}
                      onChange={(e) => setModalData({ ...modalData, enabled: e.target.value === 'true' })}
                      className="w-full px-4 py-2 border rounded-lg"
                    >
                      <option value="true">Enable</option>
                      <option value="false">Disable</option>
                    </select>
                  </div>
                  <button
                    onClick={() => handleAction('toggle_service', modalData)}
                    className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700"
                  >
                    Update Service
                  </button>
                </div>
              )}

              {modalData.action === 'limit_override' && selectedUser && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Limit Type</label>
                    <select
                      value={modalData.limit_type || ''}
                      onChange={(e) => setModalData({ ...modalData, limit_type: e.target.value, override_all: false })}
                      className="w-full px-4 py-2 border rounded-lg"
                    >
                      <option value="">Select limit type...</option>
                      <option value="per_transaction">Per Transaction</option>
                      <option value="daily_transaction">Daily Transaction</option>
                      <option value="daily_settlement">Daily Settlement</option>
                    </select>
                  </div>
                  <div>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={modalData.override_all || false}
                        onChange={(e) => setModalData({ ...modalData, override_all: e.target.checked, limit_type: '' })}
                      />
                      <span>Override All Limits</span>
                    </label>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Override Reason</label>
                    <textarea
                      value={modalData.override_reason || ''}
                      onChange={(e) => setModalData({ ...modalData, override_reason: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                      rows={3}
                      placeholder="Required: Explain why limits are being overridden"
                    />
                  </div>
                  <button
                    onClick={() => handleAction('limit_override', modalData)}
                    className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700"
                  >
                    Override Limits
                  </button>
                </div>
              )}

              {/* Reversal forms */}
              {modalData.action === 'bbps_reversal' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Transaction ID</label>
                    <input
                      type="text"
                      value={modalData.transaction_id || ''}
                      onChange={(e) => setModalData({ ...modalData, transaction_id: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                      placeholder="Enter BBPS transaction ID"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Reason</label>
                    <input
                      type="text"
                      value={modalData.reason || ''}
                      onChange={(e) => setModalData({ ...modalData, reason: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                      placeholder="Reason for reversal"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Remarks</label>
                    <textarea
                      value={modalData.remarks || ''}
                      onChange={(e) => setModalData({ ...modalData, remarks: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                      rows={3}
                    />
                  </div>
                  <button
                    onClick={() => handleAction('bbps_reversal', modalData)}
                    className="w-full bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700"
                  >
                    Reverse BBPS Transaction
                  </button>
                </div>
              )}

              {modalData.action === 'aeps_reversal' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Transaction ID</label>
                    <input
                      type="text"
                      value={modalData.transaction_id || ''}
                      onChange={(e) => setModalData({ ...modalData, transaction_id: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                      placeholder="Enter AEPS transaction ID"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Reason</label>
                    <input
                      type="text"
                      value={modalData.reason || ''}
                      onChange={(e) => setModalData({ ...modalData, reason: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                      placeholder="Reason for reversal"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Reconciliation Date</label>
                    <input
                      type="date"
                      value={modalData.reconciliation_date || ''}
                      onChange={(e) => setModalData({ ...modalData, reconciliation_date: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Remarks</label>
                    <textarea
                      value={modalData.remarks || ''}
                      onChange={(e) => setModalData({ ...modalData, remarks: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                      rows={3}
                    />
                  </div>
                  <button
                    onClick={() => handleAction('aeps_reversal', modalData)}
                    className="w-full bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700"
                  >
                    Reverse AEPS Transaction
                  </button>
                </div>
              )}

              {modalData.action === 'settlement_reversal' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Settlement ID</label>
                    <input
                      type="text"
                      value={modalData.settlement_id || ''}
                      onChange={(e) => setModalData({ ...modalData, settlement_id: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                      placeholder="Enter settlement ID"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Reason</label>
                    <input
                      type="text"
                      value={modalData.reason || ''}
                      onChange={(e) => setModalData({ ...modalData, reason: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                      placeholder="Reason for reversal"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Remarks</label>
                    <textarea
                      value={modalData.remarks || ''}
                      onChange={(e) => setModalData({ ...modalData, remarks: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                      rows={3}
                    />
                  </div>
                  <button
                    onClick={() => handleAction('settlement_reversal', modalData)}
                    className="w-full bg-red-600 text-white py-2 px-4 rounded-lg hover:bg-red-700"
                  >
                    Reverse Settlement
                  </button>
                </div>
              )}

              {modalData.action === 'dispute_handle' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Dispute ID</label>
                    <input
                      type="text"
                      value={modalData.dispute_id || ''}
                      onChange={(e) => setModalData({ ...modalData, dispute_id: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                      placeholder="Enter dispute ID"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Action</label>
                    <select
                      value={modalData.action_type || ''}
                      onChange={(e) => setModalData({ ...modalData, action: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                    >
                      <option value="hold">Hold</option>
                      <option value="resolve">Resolve</option>
                      <option value="reject">Reject</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Resolution</label>
                    <textarea
                      value={modalData.resolution || ''}
                      onChange={(e) => setModalData({ ...modalData, resolution: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                      rows={3}
                      placeholder="Resolution details"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Remarks</label>
                    <textarea
                      value={modalData.remarks || ''}
                      onChange={(e) => setModalData({ ...modalData, remarks: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                      rows={3}
                    />
                  </div>
                  <button
                    onClick={() => handleAction('dispute_handle', modalData)}
                    className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700"
                  >
                    Handle Dispute
                  </button>
                </div>
              )}

              {modalData.action === 'settlement_slab_toggle' && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Slab ID</label>
                    <input
                      type="text"
                      value={modalData.slab_id || ''}
                      onChange={(e) => setModalData({ ...modalData, slab_id: e.target.value })}
                      className="w-full px-4 py-2 border rounded-lg"
                      placeholder="Enter settlement slab ID"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Status</label>
                    <select
                      value={modalData.is_enabled !== undefined ? modalData.is_enabled.toString() : ''}
                      onChange={(e) => setModalData({ ...modalData, is_enabled: e.target.value === 'true' })}
                      className="w-full px-4 py-2 border rounded-lg"
                    >
                      <option value="true">Enable</option>
                      <option value="false">Disable</option>
                    </select>
                  </div>
                  <button
                    onClick={() => handleAction('settlement_slab_toggle', modalData)}
                    className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700"
                  >
                    Update Slab
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </div>
    </div>
  )
}

