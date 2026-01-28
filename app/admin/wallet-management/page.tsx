'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'
import {
  Wallet, ArrowUpCircle, ArrowDownCircle, Lock, Unlock,
  Snowflake, Sun, Search, Filter, Download, RefreshCw,
  Users, Building2, Crown, DollarSign, TrendingUp
} from 'lucide-react'
import { motion } from 'framer-motion'
import { apiFetch } from '@/lib/api-client'

type UserType = 'retailer' | 'distributor' | 'master_distributor'
type FundCategory = 'cash' | 'online' | 'commission' | 'settlement' | 'adjustment'
type ActionType = 'push' | 'pull' | 'freeze' | 'unfreeze' | 'hold_settlement' | 'release_settlement' | 'lock_commission' | 'unlock_commission'

export default function AdminWalletManagement() {
  const { user } = useAuth()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<any[]>([])
  const [filteredUsers, setFilteredUsers] = useState<any[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [userTypeFilter, setUserTypeFilter] = useState<UserType | 'all'>('all')
  const [selectedUser, setSelectedUser] = useState<any>(null)
  const [showActionModal, setShowActionModal] = useState(false)
  const [actionType, setActionType] = useState<ActionType>('push')
  const [actionData, setActionData] = useState({
    amount: '',
    fund_category: 'cash' as FundCategory,
    remarks: '',
    wallet_type: 'primary' as 'primary' | 'aeps'
  })

  useEffect(() => {
    if (!user || user.role !== 'admin') {
      router.push('/admin/login')
      return
    }
    fetchUsers()
  }, [user, router])

  useEffect(() => {
    filterUsers()
  }, [searchTerm, userTypeFilter, users])

  const fetchUsers = async () => {
    setLoading(true)
    try {
      const [retailers, distributors, masterDistributors] = await Promise.all([
        supabase.from('retailers').select('id, partner_id, name, email, status').order('created_at', { ascending: false }),
        supabase.from('distributors').select('id, partner_id, name, email, status').order('created_at', { ascending: false }),
        supabase.from('master_distributors').select('id, partner_id, name, email, status').order('created_at', { ascending: false })
      ])

      const allUsers = [
        ...(retailers.data || []).map(u => ({ ...u, user_type: 'retailer' as UserType })),
        ...(distributors.data || []).map(u => ({ ...u, user_type: 'distributor' as UserType })),
        ...(masterDistributors.data || []).map(u => ({ ...u, user_type: 'master_distributor' as UserType }))
      ]

      // Fetch wallet balances for all users
      const usersWithBalances = await Promise.all(
        allUsers.map(async (u) => {
          try {
            let balance = 0
            try {
              const { data: balanceData } = await supabase.rpc('get_wallet_balance_v2', {
                p_user_id: u.partner_id,
                p_wallet_type: 'primary'
              })
              balance = balanceData || 0
            } catch {
              balance = 0
            }

            let wallet = null
            try {
              const { data: walletData } = await supabase
                .from('wallets')
                .select('is_frozen, is_settlement_held')
                .eq('user_id', u.partner_id)
                .eq('wallet_type', 'primary')
                .single()
              wallet = walletData
            } catch {
              wallet = null
            }

            return {
              ...u,
              wallet_balance: balance,
              is_frozen: wallet?.is_frozen || false,
              is_settlement_held: wallet?.is_settlement_held || false
            }
          } catch {
            return { ...u, wallet_balance: 0, is_frozen: false, is_settlement_held: false }
          }
        })
      )

      setUsers(usersWithBalances)
      setFilteredUsers(usersWithBalances)
    } catch (error) {
      console.error('Error fetching users:', error)
    } finally {
      setLoading(false)
    }
  }

  const filterUsers = () => {
    let filtered = [...users]

    if (userTypeFilter !== 'all') {
      filtered = filtered.filter(u => u.user_type === userTypeFilter)
    }

    if (searchTerm) {
      filtered = filtered.filter(u =>
        u.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.partner_id?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    setFilteredUsers(filtered)
  }

  const handleAction = async () => {
    if (!selectedUser) return

    try {
      let endpoint = ''
      let body: any = {}

      switch (actionType) {
        case 'push':
          endpoint = '/api/admin/wallet/push'
          body = {
            user_id: selectedUser.partner_id,
            user_role: selectedUser.user_type,
            wallet_type: actionData.wallet_type,
            fund_category: actionData.fund_category,
            amount: parseFloat(actionData.amount),
            remarks: actionData.remarks
          }
          break
        case 'pull':
          endpoint = '/api/admin/wallet/pull'
          body = {
            user_id: selectedUser.partner_id,
            user_role: selectedUser.user_type,
            wallet_type: actionData.wallet_type,
            fund_category: actionData.fund_category,
            amount: parseFloat(actionData.amount),
            remarks: actionData.remarks
          }
          break
        case 'freeze':
        case 'unfreeze':
          endpoint = '/api/admin/wallet/freeze'
          body = {
            user_id: selectedUser.partner_id,
            wallet_type: actionData.wallet_type,
            freeze: actionType === 'freeze',
            remarks: actionData.remarks
          }
          break
        case 'hold_settlement':
        case 'release_settlement':
          endpoint = '/api/admin/wallet/settlement-hold'
          body = {
            user_id: selectedUser.partner_id,
            hold: actionType === 'hold_settlement',
            remarks: actionData.remarks
          }
          break
      }

      const response = await apiFetch(endpoint, {
        method: 'POST',
        body: JSON.stringify(body)
      })

      const data = await response.json()
      if (data.success) {
        alert('Action completed successfully!')
        setShowActionModal(false)
        setSelectedUser(null)
        setActionData({ amount: '', fund_category: 'cash', remarks: '', wallet_type: 'primary' })
        fetchUsers()
      } else {
        alert(data.error || 'Action failed')
      }
    } catch (error) {
      console.error('Action error:', error)
      alert('Failed to perform action')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Wallet Management</h1>
          <p className="text-gray-600">Manage wallet balances, freezes, and settlements for all users</p>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  placeholder="Search by name, email, or partner ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border rounded-lg"
                />
              </div>
            </div>
            <select
              value={userTypeFilter}
              onChange={(e) => setUserTypeFilter(e.target.value as UserType | 'all')}
              className="px-4 py-2 border rounded-lg"
            >
              <option value="all">All Users</option>
              <option value="retailer">Retailers</option>
              <option value="distributor">Distributors</option>
              <option value="master_distributor">Master Distributors</option>
            </select>
            <button
              onClick={fetchUsers}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>

        {/* Users Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Partner ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Wallet Balance</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-medium text-gray-900">{u.name}</p>
                        <p className="text-sm text-gray-500">{u.email}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">{u.partner_id}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 text-xs rounded-full ${
                        u.user_type === 'retailer' ? 'bg-blue-100 text-blue-800' :
                        u.user_type === 'distributor' ? 'bg-purple-100 text-purple-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {u.user_type.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <p className="font-semibold text-gray-900">
                        ₹{u.wallet_balance?.toLocaleString('en-IN', { minimumFractionDigits: 2 }) || '0.00'}
                      </p>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        {u.is_frozen && (
                          <span className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded">Frozen</span>
                        )}
                        {u.is_settlement_held && (
                          <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded">Settlement Held</span>
                        )}
                        {!u.is_frozen && !u.is_settlement_held && (
                          <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded">Active</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setSelectedUser(u)
                            setActionType('push')
                            setShowActionModal(true)
                          }}
                          className="p-2 text-green-600 hover:bg-green-50 rounded"
                          title="Push Funds"
                        >
                          <ArrowUpCircle className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => {
                            setSelectedUser(u)
                            setActionType('pull')
                            setShowActionModal(true)
                          }}
                          className="p-2 text-red-600 hover:bg-red-50 rounded"
                          title="Pull Funds"
                        >
                          <ArrowDownCircle className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => {
                            setSelectedUser(u)
                            setActionType(u.is_frozen ? 'unfreeze' : 'freeze')
                            setShowActionModal(true)
                          }}
                          className="p-2 text-orange-600 hover:bg-orange-50 rounded"
                          title={u.is_frozen ? 'Unfreeze' : 'Freeze'}
                        >
                          {u.is_frozen ? <Sun className="w-5 h-5" /> : <Snowflake className="w-5 h-5" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Action Modal */}
        {showActionModal && selectedUser && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
            >
              <h3 className="text-xl font-bold mb-4">
                {actionType === 'push' && 'Push Funds'}
                {actionType === 'pull' && 'Pull Funds'}
                {actionType === 'freeze' && 'Freeze Wallet'}
                {actionType === 'unfreeze' && 'Unfreeze Wallet'}
                {actionType === 'hold_settlement' && 'Hold Settlement'}
                {actionType === 'release_settlement' && 'Release Settlement'}
              </h3>
              <div className="mb-4">
                <p className="text-sm text-gray-600">User: {selectedUser.name}</p>
                <p className="text-sm text-gray-600">Partner ID: {selectedUser.partner_id}</p>
              </div>
              <div className="space-y-4">
                {(actionType === 'push' || actionType === 'pull') && (
                  <>
                    <div>
                      <label className="block text-sm font-medium mb-1">Amount (₹)</label>
                      <input
                        type="number"
                        value={actionData.amount}
                        onChange={(e) => setActionData({ ...actionData, amount: e.target.value })}
                        className="w-full px-4 py-2 border rounded-lg"
                        placeholder="Enter amount"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Fund Category</label>
                      <select
                        value={actionData.fund_category}
                        onChange={(e) => setActionData({ ...actionData, fund_category: e.target.value as FundCategory })}
                        className="w-full px-4 py-2 border rounded-lg"
                      >
                        <option value="cash">Cash</option>
                        <option value="online">Online</option>
                        <option value="commission">Commission</option>
                        <option value="settlement">Settlement</option>
                        <option value="adjustment">Adjustment</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Wallet Type</label>
                      <select
                        value={actionData.wallet_type}
                        onChange={(e) => setActionData({ ...actionData, wallet_type: e.target.value as 'primary' | 'aeps' })}
                        className="w-full px-4 py-2 border rounded-lg"
                      >
                        <option value="primary">Primary</option>
                        <option value="aeps">AEPS</option>
                      </select>
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1">Remarks</label>
                  <textarea
                    value={actionData.remarks}
                    onChange={(e) => setActionData({ ...actionData, remarks: e.target.value })}
                    className="w-full px-4 py-2 border rounded-lg"
                    rows={3}
                    placeholder="Enter remarks..."
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleAction}
                    className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => {
                      setShowActionModal(false)
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
      </div>
    </div>
  )
}

