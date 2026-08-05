'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetchJson } from '@/lib/api-client'
import { RefreshCw, Check, X, Loader2, Clock, AlertCircle } from 'lucide-react'

interface Settlement2Tx {
  id: string
  retailer_id: string
  user_role: string
  account_number: string
  ifsc_code: string
  account_holder_name: string
  amount: number
  charges: number
  total_debit: number
  mode: string
  reference_id: string
  status: string
  status_message?: string
  utr?: string
  created_at: string
  user_name?: string
  user_phone?: string
  user_email?: string
}

export default function AdminSettlement2Approvals() {
  const [transactions, setTransactions] = useState<Settlement2Tx[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('AWAITING_APPROVAL')

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetchJson<{ success: boolean; transactions: Settlement2Tx[] }>(
        `/api/admin/settlement-2/approve?status=${statusFilter}`
      )
      if (res.success) setTransactions(res.transactions || [])
    } catch (err) {
      console.error('Failed to fetch:', err)
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => { fetchTransactions() }, [fetchTransactions])

  const handleAction = async (txId: string, action: 'approve' | 'reject') => {
    if (!confirm(`Are you sure you want to ${action} this settlement?`)) return
    setActionLoading(txId)
    try {
      const res = await apiFetchJson<{ success: boolean; message?: string; error?: string }>(
        '/api/admin/settlement-2/approve',
        { method: 'POST', body: JSON.stringify({ transaction_id: txId, action }) }
      )
      if (res.success) {
        fetchTransactions()
      } else {
        alert(res.error || 'Action failed')
      }
    } catch (err: any) {
      alert(err.message || 'Action failed')
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Settlement-2 Approvals</h2>
        <div className="flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 border rounded-lg text-sm"
          >
            <option value="AWAITING_APPROVAL">Awaiting Approval</option>
            <option value="all">All</option>
            <option value="SUCCESS">Success</option>
            <option value="FAILED">Failed</option>
            <option value="REJECTED">Rejected</option>
            <option value="PENDING">Pending</option>
          </select>
          <button onClick={fetchTransactions} className="p-2 rounded-lg hover:bg-gray-100" title="Refresh">
            <RefreshCw className={`w-4 h-4 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">User</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Role</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Account</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Amount</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Charges</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Total Debit</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Mode</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Status</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-500"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
              ) : transactions.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-500">No transactions found</td></tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-900 whitespace-nowrap">
                      {new Date(tx.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{tx.user_name || tx.retailer_id}</div>
                      {tx.user_phone && <div className="text-xs text-gray-500">{tx.user_phone}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-700 capitalize">{tx.user_role}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-900">{tx.account_holder_name}</div>
                      <div className="text-xs text-gray-500">****{tx.account_number.slice(-4)} | {tx.ifsc_code}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-medium">₹{parseFloat(String(tx.amount)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td className="px-4 py-3 text-right text-red-600">₹{parseFloat(String(tx.charges)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td className="px-4 py-3 text-right font-semibold">₹{parseFloat(String(tx.total_debit)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td className="px-4 py-3 uppercase text-gray-700">{tx.mode}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        tx.status === 'SUCCESS' ? 'bg-green-100 text-green-800' :
                        tx.status === 'AWAITING_APPROVAL' ? 'bg-blue-100 text-blue-800' :
                        tx.status === 'REJECTED' || tx.status === 'FAILED' ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {tx.status === 'AWAITING_APPROVAL' ? 'Awaiting' : tx.status.toLowerCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {tx.status === 'AWAITING_APPROVAL' ? (
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleAction(tx.id, 'approve')}
                            disabled={actionLoading === tx.id}
                            className="p-1.5 rounded-lg bg-green-50 hover:bg-green-100 text-green-700 disabled:opacity-50"
                            title="Approve"
                          >
                            {actionLoading === tx.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => handleAction(tx.id, 'reject')}
                            disabled={actionLoading === tx.id}
                            className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 disabled:opacity-50"
                            title="Reject"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">{tx.utr || '—'}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
