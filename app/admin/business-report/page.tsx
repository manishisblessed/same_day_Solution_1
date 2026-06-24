'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase/client'
import AdminSidebar from '@/components/AdminSidebar'
import {
  BarChart3, Search, Download, Filter, Users, TrendingUp,
  CreditCard, Banknote, Fingerprint, Loader2, ChevronDown, ChevronUp
} from 'lucide-react'

interface BusinessSummary {
  user_id: string
  user_role: string
  user_name: string
  service_type: string
  total_transactions: number
  total_volume: number
  total_commission: number
  total_charges: number
}

interface CommissionDetail {
  id: string
  user_id: string
  user_role: string
  service_type: string
  tx_type: string
  credit: number
  debit: number
  reference_id: string
  remarks: string
  created_at: string
}

export default function BusinessReportPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-gray-500">Loading...</div>}>
      <BusinessReportContent />
    </Suspense>
  )
}

function BusinessReportContent() {
  const { user } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [summaryData, setSummaryData] = useState<BusinessSummary[]>([])
  const [commissionDetails, setCommissionDetails] = useState<CommissionDetail[]>([])
  const [expandedUser, setExpandedUser] = useState<string | null>(null)
  const [expandLoading, setExpandLoading] = useState(false)

  // Filters
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0])
  const [filterRole, setFilterRole] = useState<string>('')
  const [filterService, setFilterService] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')

  // Name cache
  const [nameCache, setNameCache] = useState<Record<string, string>>({})

  const fetchNames = useCallback(async (userIds: string[]) => {
    const unknownIds = userIds.filter(id => !nameCache[id])
    if (unknownIds.length === 0) return

    const [ret, dist, md] = await Promise.all([
      supabase.from('retailers').select('partner_id, name, business_name').in('partner_id', unknownIds),
      supabase.from('distributors').select('partner_id, name, business_name').in('partner_id', unknownIds),
      supabase.from('master_distributors').select('partner_id, name, business_name').in('partner_id', unknownIds),
    ])

    const names: Record<string, string> = {}
    ret.data?.forEach((r: any) => { names[r.partner_id] = r.business_name || r.name })
    dist.data?.forEach((d: any) => { names[d.partner_id] = d.business_name || d.name })
    md.data?.forEach((m: any) => { names[m.partner_id] = m.business_name || m.name })

    setNameCache(prev => ({ ...prev, ...names }))
  }, [nameCache])

  const fetchBusinessReport = useCallback(async () => {
    setLoading(true)
    try {
      // Fetch commission entries from wallet_ledger
      let query = supabase
        .from('wallet_ledger')
        .select('user_id, user_role, service_type, tx_type, credit, debit, fund_category')
        .gte('created_at', `${dateFrom}T00:00:00`)
        .lte('created_at', `${dateTo}T23:59:59`)
        .eq('status', 'completed')

      if (filterRole) query = query.eq('user_role', filterRole)
      if (filterService) query = query.eq('service_type', filterService)

      const { data: ledgerData, error } = await query
      if (error) throw error

      // Aggregate by user + service
      const aggMap = new Map<string, BusinessSummary>()

      for (const row of (ledgerData || [])) {
        const key = `${row.user_id}_${row.service_type || 'other'}`
        if (!aggMap.has(key)) {
          aggMap.set(key, {
            user_id: row.user_id,
            user_role: row.user_role || 'unknown',
            user_name: '',
            service_type: row.service_type || 'other',
            total_transactions: 0,
            total_volume: 0,
            total_commission: 0,
            total_charges: 0,
          })
        }
        const entry = aggMap.get(key)!
        entry.total_transactions++

        if (row.fund_category === 'commission' || row.tx_type === 'COMMISSION_CREDIT') {
          entry.total_commission += parseFloat(row.credit) || 0
        } else if (row.tx_type === 'POS_CREDIT' || row.tx_type === 'SETTLEMENT_CREDIT') {
          entry.total_volume += parseFloat(row.credit) || 0
        } else {
          entry.total_volume += parseFloat(row.credit) || 0
          entry.total_charges += parseFloat(row.debit) || 0
        }
      }

      let summaries = Array.from(aggMap.values())

      // Search filter
      if (searchQuery) {
        summaries = summaries.filter(s =>
          s.user_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (nameCache[s.user_id] || '').toLowerCase().includes(searchQuery.toLowerCase())
        )
      }

      // Sort by total volume descending
      summaries.sort((a, b) => b.total_volume - a.total_volume)

      setSummaryData(summaries)

      // Fetch names for displayed users
      const userIds = [...new Set(summaries.map(s => s.user_id))]
      await fetchNames(userIds)
    } catch (err: any) {
      console.error('Business report error:', err)
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, filterRole, filterService, searchQuery, fetchNames, nameCache])

  useEffect(() => {
    fetchBusinessReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo, filterRole, filterService])

  const toggleUserExpand = async (userId: string) => {
    if (expandedUser === userId) {
      setExpandedUser(null)
      return
    }

    setExpandLoading(true)
    setExpandedUser(userId)

    try {
      const { data } = await supabase
        .from('wallet_ledger')
        .select('id, user_id, user_role, service_type, tx_type, credit, debit, reference_id, remarks, created_at')
        .eq('user_id', userId)
        .gte('created_at', `${dateFrom}T00:00:00`)
        .lte('created_at', `${dateTo}T23:59:59`)
        .eq('status', 'completed')
        .in('fund_category', ['commission', 'service', 'online'])
        .order('created_at', { ascending: false })
        .limit(100)

      setCommissionDetails(data || [])
    } catch (err) {
      console.error('Error fetching details:', err)
    } finally {
      setExpandLoading(false)
    }
  }

  // Aggregate totals
  const totalVolume = summaryData.reduce((s, d) => s + d.total_volume, 0)
  const totalCommission = summaryData.reduce((s, d) => s + d.total_commission, 0)
  const totalTransactions = summaryData.reduce((s, d) => s + d.total_transactions, 0)
  const uniqueUsers = new Set(summaryData.map(d => d.user_id)).size

  // Group by user for display
  const userGroups = new Map<string, BusinessSummary[]>()
  for (const row of summaryData) {
    if (!userGroups.has(row.user_id)) userGroups.set(row.user_id, [])
    userGroups.get(row.user_id)!.push(row)
  }

  const roleLabel = (role: string) => {
    switch (role) {
      case 'retailer': return 'Retailer'
      case 'distributor': return 'Distributor'
      case 'master_distributor': return 'Master Distributor'
      default: return role
    }
  }

  const roleColor = (role: string) => {
    switch (role) {
      case 'retailer': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
      case 'distributor': return 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400'
      case 'master_distributor': return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
      default: return 'bg-gray-100 text-gray-700'
    }
  }

  const serviceIcon = (service: string) => {
    switch (service) {
      case 'bbps': return <CreditCard className="w-3.5 h-3.5" />
      case 'payout': return <Banknote className="w-3.5 h-3.5" />
      case 'pos': return <CreditCard className="w-3.5 h-3.5" />
      case 'aeps': return <Fingerprint className="w-3.5 h-3.5" />
      default: return <TrendingUp className="w-3.5 h-3.5" />
    }
  }

  const serviceLabel = (service: string) => {
    switch (service) {
      case 'bbps': return 'BBPS'
      case 'payout': return 'Settlement-1'
      case 'pos': return 'POS'
      case 'aeps': return 'AEPS'
      case 'aeps_settlement': return 'AEPS Settlement'
      case 'shadval_settlement': return 'Settlement-2'
      default: return service || 'Other'
    }
  }

  const fmt = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const handleExportCSV = () => {
    const rows = [['User ID', 'User Name', 'Role', 'Service', 'Transactions', 'Volume', 'Commission', 'Charges']]
    for (const row of summaryData) {
      rows.push([
        row.user_id,
        nameCache[row.user_id] || '',
        row.user_role,
        serviceLabel(row.service_type),
        String(row.total_transactions),
        row.total_volume.toFixed(2),
        row.total_commission.toFixed(2),
        row.total_charges.toFixed(2),
      ])
    }
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `business-report-${dateFrom}-to-${dateTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-950">
      <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="flex-1 lg:ml-56 p-4 md:p-6 pt-20">
        {/* Header */}
        <div className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                <BarChart3 className="w-7 h-7 text-primary-600" />
                Business Report
              </h1>
              <p className="text-sm text-gray-500 mt-1">User business activity, volume &amp; commission breakdown by category</p>
            </div>
            <button onClick={handleExportCSV} disabled={summaryData.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium disabled:opacity-50">
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs font-medium mb-1 text-gray-600">From</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-gray-600">To</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-gray-600">Role</label>
              <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
                className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-sm">
                <option value="">All Roles</option>
                <option value="retailer">Retailer</option>
                <option value="distributor">Distributor</option>
                <option value="master_distributor">Master Distributor</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1 text-gray-600">Service</label>
              <select value={filterService} onChange={e => setFilterService(e.target.value)}
                className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-sm">
                <option value="">All Services</option>
                <option value="bbps">BBPS</option>
                <option value="payout">Settlement-1</option>
                <option value="pos">POS</option>
                <option value="aeps">AEPS</option>
                <option value="aeps_settlement">AEPS Settlement</option>
              </select>
            </div>
            <div className="relative flex-1 min-w-[180px]">
              <label className="block text-xs font-medium mb-1 text-gray-600">Search</label>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  placeholder="User ID or name..."
                  className="w-full pl-9 pr-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-sm" />
              </div>
            </div>
            <button onClick={fetchBusinessReport} disabled={loading}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium disabled:opacity-50">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Filter className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <div className="text-xs text-gray-500 mb-1">Total Users</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{uniqueUsers}</div>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <div className="text-xs text-gray-500 mb-1">Total Entries</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{totalTransactions.toLocaleString()}</div>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <div className="text-xs text-gray-500 mb-1">Total Volume</div>
            <div className="text-2xl font-bold text-green-600">{fmt(totalVolume)}</div>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <div className="text-xs text-gray-500 mb-1">Total Commission</div>
            <div className="text-2xl font-bold text-blue-600">{fmt(totalCommission)}</div>
          </div>
        </div>

        {/* Data Table */}
        {loading ? (
          <div className="text-center py-12 text-gray-500 flex items-center justify-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading business data...
          </div>
        ) : userGroups.size === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <BarChart3 className="w-12 h-12 mx-auto text-gray-300 mb-3" />
            <p>No business data found for the selected period.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {Array.from(userGroups.entries()).map(([userId, services]) => {
              const userTotal = services.reduce((s, d) => s + d.total_volume, 0)
              const userCommission = services.reduce((s, d) => s + d.total_commission, 0)
              const userTxns = services.reduce((s, d) => s + d.total_transactions, 0)
              const role = services[0]?.user_role || 'unknown'
              const isExpanded = expandedUser === userId

              return (
                <div key={userId} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                  {/* User Header */}
                  <div className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    onClick={() => toggleUserExpand(userId)}>
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-400 to-secondary-400 flex items-center justify-center text-white font-bold text-sm">
                        {(nameCache[userId] || userId).charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-gray-900 dark:text-white truncate">
                          {nameCache[userId] || userId}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-xs text-gray-500">{userId}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${roleColor(role)}`}>
                            {roleLabel(role)}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 text-right">
                      <div>
                        <div className="text-xs text-gray-500">Entries</div>
                        <div className="font-semibold text-gray-900 dark:text-white">{userTxns}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">Volume</div>
                        <div className="font-semibold text-green-600">{fmt(userTotal)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500">Commission</div>
                        <div className="font-semibold text-blue-600">{fmt(userCommission)}</div>
                      </div>
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                    </div>
                  </div>

                  {/* Service Breakdown */}
                  {isExpanded && (
                    <div className="border-t border-gray-200 dark:border-gray-800 p-4 bg-gray-50 dark:bg-gray-800/30">
                      {/* Per-service summary */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
                        {services.map((s, i) => (
                          <div key={i} className="flex items-center gap-3 p-3 bg-white dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-700">
                            <div className="text-gray-500">{serviceIcon(s.service_type)}</div>
                            <div className="flex-1">
                              <div className="text-sm font-medium text-gray-900 dark:text-white">{serviceLabel(s.service_type)}</div>
                              <div className="text-xs text-gray-500">{s.total_transactions} entries</div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-medium text-green-600">{fmt(s.total_volume)}</div>
                              {s.total_commission > 0 && (
                                <div className="text-xs text-blue-600">Comm: {fmt(s.total_commission)}</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Commission details table */}
                      {expandLoading ? (
                        <div className="text-center py-4 text-gray-500 text-sm flex items-center justify-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" /> Loading details...
                        </div>
                      ) : commissionDetails.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-gray-100 dark:bg-gray-700">
                                <th className="px-3 py-2 text-left">Date</th>
                                <th className="px-3 py-2 text-left">Service</th>
                                <th className="px-3 py-2 text-left">Type</th>
                                <th className="px-3 py-2 text-right">Credit</th>
                                <th className="px-3 py-2 text-right">Debit</th>
                                <th className="px-3 py-2 text-left">Ref</th>
                                <th className="px-3 py-2 text-left">Remarks</th>
                              </tr>
                            </thead>
                            <tbody>
                              {commissionDetails.slice(0, 50).map(d => (
                                <tr key={d.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                                  <td className="px-3 py-2 whitespace-nowrap">{new Date(d.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                                  <td className="px-3 py-2">{serviceLabel(d.service_type)}</td>
                                  <td className="px-3 py-2">
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                      d.tx_type?.includes('COMMISSION') ? 'bg-blue-100 text-blue-700' :
                                      d.tx_type?.includes('CREDIT') ? 'bg-green-100 text-green-700' :
                                      d.tx_type?.includes('DEBIT') ? 'bg-red-100 text-red-700' :
                                      'bg-gray-100 text-gray-700'
                                    }`}>{d.tx_type}</span>
                                  </td>
                                  <td className="px-3 py-2 text-right text-green-600 font-medium">{d.credit > 0 ? fmt(d.credit) : '-'}</td>
                                  <td className="px-3 py-2 text-right text-red-600 font-medium">{d.debit > 0 ? fmt(d.debit) : '-'}</td>
                                  <td className="px-3 py-2 text-gray-500 max-w-[120px] truncate" title={d.reference_id}>{d.reference_id || '-'}</td>
                                  <td className="px-3 py-2 text-gray-500 max-w-[200px] truncate" title={d.remarks}>{d.remarks || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {commissionDetails.length > 50 && (
                            <p className="text-xs text-gray-500 mt-2 text-center">Showing first 50 of {commissionDetails.length} entries</p>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 italic text-center py-2">No detailed entries found</p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
