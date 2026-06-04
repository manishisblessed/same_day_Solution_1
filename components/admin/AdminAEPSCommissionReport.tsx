'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'
import {
  RefreshCw, Download, Search, Filter,
  TrendingUp, Shield, DollarSign, Users, Percent,
  ChevronLeft, ChevronRight, AlertCircle, Building2,
  IndianRupee, FileBarChart
} from 'lucide-react'
import { motion } from 'framer-motion'

interface CommissionSummary {
  totalCommission: number
  totalRtAmount: number
  totalDtAmount: number
  totalMdAmount: number
  totalAdminAmount: number
  totalCompanyExtra: number
  totalTds: number
  distributedCount: number
  pendingCount: number
  totalEntries: number
}

interface PerUserBreakdown {
  userId: string
  userName: string
  grossCommission: number
  tdsDeducted: number
  netCredited: number
  txnCount: number
}

interface CommissionEntry {
  id: string
  transaction_id: string
  service_type: string
  total_commission: number
  admin_amount: number
  md_amount: number
  dt_amount: number
  rt_amount: number
  company_extra_amount: number
  tds_amount: number
  status: string
  distributed_at: string | null
  created_at: string
  rt_user_id: string
  rt_user_name: string
  dt_user_name: string | null
  md_user_name: string | null
}

export default function AdminAEPSCommissionReport() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<CommissionSummary | null>(null)
  const [perUserBreakdown, setPerUserBreakdown] = useState<PerUserBreakdown[]>([])
  const [entries, setEntries] = useState<CommissionEntry[]>([])
  const [page, setPage] = useState(1)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [searchUserId, setSearchUserId] = useState('')

  const fetchReport = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (dateFrom) params.set('from', dateFrom)
      if (dateTo) params.set('to', dateTo)
      if (searchUserId) params.set('user_id', searchUserId)
      params.set('page', String(page))
      params.set('limit', '50')

      const res = await fetch(`/api/admin/aeps/commission-report?${params}`, { credentials: 'include' })
      const data = await res.json()

      if (!data.success) throw new Error(data.error || 'Failed to load report')

      setSummary(data.summary)
      setPerUserBreakdown(data.perUserBreakdown || [])
      setEntries(data.entries || [])
    } catch (err: any) {
      setError(err.message || 'Failed to load commission report')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, searchUserId, page])

  useEffect(() => {
    fetchReport()
  }, [fetchReport])

  const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const formatDate = (d: string) => {
    const dt = new Date(d)
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  const exportCSV = () => {
    const headers = ['Date', 'Transaction ID', 'Service', 'Retailer', 'Gross Commission', 'RT Amount', 'DT Amount', 'MD Amount', 'Admin Amount', 'TDS Amount', 'Status']
    const rows = entries.map(e => [
      formatDate(e.created_at),
      e.transaction_id,
      e.service_type,
      e.rt_user_name,
      e.total_commission.toFixed(2),
      e.rt_amount.toFixed(2),
      (e.dt_amount || 0).toFixed(2),
      (e.md_amount || 0).toFixed(2),
      e.admin_amount.toFixed(2),
      e.tds_amount.toFixed(2),
      e.status,
    ])
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aeps-commission-tds-report-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  const exportTdsCSV = () => {
    const headers = ['Retailer ID', 'Retailer Name', 'Gross Commission (₹)', 'TDS Deducted (₹)', 'Net Credited (₹)', 'Transaction Count', 'Effective TDS %']
    const rows = perUserBreakdown.map(u => [
      u.userId,
      u.userName,
      u.grossCommission.toFixed(2),
      u.tdsDeducted.toFixed(2),
      u.netCredited.toFixed(2),
      u.txnCount,
      u.grossCommission > 0 ? ((u.tdsDeducted / u.grossCommission) * 100).toFixed(2) : '0.00',
    ])
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aeps-tds-per-retailer-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-lg border p-4">
        <div className="flex flex-col md:flex-row gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
            <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }}
              className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
            <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1) }}
              className="px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">Retailer ID (optional)</label>
            <input type="text" placeholder="Filter by retailer user ID..." value={searchUserId}
              onChange={e => { setSearchUserId(e.target.value); setPage(1) }}
              className="w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
          </div>
          <button onClick={fetchReport} disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2 text-sm whitespace-nowrap">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {summary && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {[
              { label: 'Total Commission', value: summary.totalCommission, icon: DollarSign, color: 'text-blue-600', bg: 'bg-blue-50' },
              { label: 'RT Distributed', value: summary.totalRtAmount, icon: Users, color: 'text-emerald-600', bg: 'bg-emerald-50' },
              { label: 'DT Distributed', value: summary.totalDtAmount, icon: Building2, color: 'text-purple-600', bg: 'bg-purple-50' },
              { label: 'MD Distributed', value: summary.totalMdAmount, icon: TrendingUp, color: 'text-indigo-600', bg: 'bg-indigo-50' },
              { label: 'Company Earning', value: summary.totalAdminAmount + summary.totalCompanyExtra, icon: IndianRupee, color: 'text-green-600', bg: 'bg-green-50' },
              { label: 'Total TDS Collected', value: summary.totalTds, icon: Shield, color: 'text-amber-600', bg: 'bg-amber-50' },
              { label: 'Transactions', value: summary.totalEntries, icon: FileBarChart, color: 'text-gray-600', bg: 'bg-gray-50', isCurrency: false },
            ].map((card, i) => (
              <motion.div key={card.label} initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                className={`${card.bg} rounded-lg border p-3`}>
                <div className="flex items-center justify-between mb-1">
                  <card.icon className={`w-4 h-4 ${card.color}`} />
                </div>
                <p className="text-xs text-gray-500 truncate">{card.label}</p>
                <p className={`text-lg font-bold ${card.color}`}>
                  {card.isCurrency === false ? card.value : `₹${fmt(card.value as number)}`}
                </p>
              </motion.div>
            ))}
          </div>

          {/* Per-Retailer TDS Breakdown */}
          {perUserBreakdown.length > 0 && (
            <div className="bg-white rounded-lg border overflow-hidden">
              <div className="px-4 py-3 border-b flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-amber-600" />
                  TDS Collected Per Retailer
                </h3>
                <button onClick={exportTdsCSV}
                  className="px-3 py-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 flex items-center gap-1.5 text-xs">
                  <Download className="w-3.5 h-3.5" /> Export TDS Report
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Retailer</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Gross Commission</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">TDS Deducted</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Net Credited</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Txns</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Eff. TDS %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {perUserBreakdown.map(u => (
                      <tr key={u.userId} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm font-medium text-gray-900">{u.userName}
                          <div className="text-xs text-gray-400 font-mono">{u.userId.slice(0, 12)}...</div>
                        </td>
                        <td className="px-4 py-2 text-right text-sm text-emerald-600 font-medium">₹{fmt(u.grossCommission)}</td>
                        <td className="px-4 py-2 text-right text-sm text-red-600 font-medium">-₹{fmt(u.tdsDeducted)}</td>
                        <td className="px-4 py-2 text-right text-sm text-green-600 font-medium">₹{fmt(u.netCredited)}</td>
                        <td className="px-4 py-2 text-right text-sm text-gray-600">{u.txnCount}</td>
                        <td className="px-4 py-2 text-right text-sm text-amber-600 font-medium">
                          {u.grossCommission > 0 ? ((u.tdsDeducted / u.grossCommission) * 100).toFixed(2) : '0.00'}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Commission Ledger Entries */}
          <div className="bg-white rounded-lg border overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-blue-600" />
                Commission Distribution Log ({summary.totalEntries} entries)
              </h3>
              <button onClick={exportCSV}
                className="px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-1.5 text-xs">
                <Download className="w-3.5 h-3.5" /> Export All
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Service</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Retailer</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">RT</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">DT</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">MD</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Admin</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">TDS</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loading ? (
                    <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-500">
                      <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" /> Loading...
                    </td></tr>
                  ) : entries.length === 0 ? (
                    <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-500">No commission entries found</td></tr>
                  ) : entries.map(e => (
                    <tr key={e.id} className="hover:bg-gray-50 text-sm">
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatDate(e.created_at)}</td>
                      <td className="px-3 py-2">
                        <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded">{e.service_type}</span>
                      </td>
                      <td className="px-3 py-2 text-gray-900 font-medium max-w-[140px] truncate" title={e.rt_user_name}>{e.rt_user_name}</td>
                      <td className="px-3 py-2 text-right font-medium text-gray-900">₹{fmt(e.total_commission)}</td>
                      <td className="px-3 py-2 text-right text-emerald-600">₹{fmt(e.rt_amount)}</td>
                      <td className="px-3 py-2 text-right text-purple-600">₹{fmt(e.dt_amount || 0)}</td>
                      <td className="px-3 py-2 text-right text-indigo-600">₹{fmt(e.md_amount || 0)}</td>
                      <td className="px-3 py-2 text-right text-green-600">₹{fmt(e.admin_amount)}</td>
                      <td className="px-3 py-2 text-right text-red-600 font-medium">₹{fmt(e.tds_amount)}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-flex px-2 py-0.5 text-xs rounded-full ${
                          e.status === 'distributed'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}>{e.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="px-4 py-3 border-t flex items-center justify-between">
              <span className="text-sm text-gray-500">Page {page}</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                  className="px-3 py-1 border rounded-lg disabled:opacity-50 hover:bg-gray-50 text-sm">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button onClick={() => setPage(p => p + 1)} disabled={entries.length < 50}
                  className="px-3 py-1 border rounded-lg disabled:opacity-50 hover:bg-gray-50 text-sm">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
