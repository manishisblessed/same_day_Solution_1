'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  FileBarChart, Search, RefreshCw, ChevronLeft, ChevronRight,
  ArrowRight, Package, Loader2, Download, Calendar,
  AlertCircle, RotateCcw, Truck, UserCheck, History,
  Smartphone, Users, ArrowLeftRight, CheckCircle2, XCircle,
  Filter, ChevronDown
} from 'lucide-react'
import { apiFetch } from '@/lib/api-client'

type ViewMode = 'movement' | 'device' | 'merchant'

interface TrackingEntry {
  id: string
  pos_machine_id: string
  machine_id: string
  action: string
  assigned_by: string
  assigned_by_role: string
  assigned_to: string | null
  assigned_to_role: string | null
  previous_holder: string | null
  previous_holder_role: string | null
  status: 'active' | 'returned'
  returned_date: string | null
  return_reason: string | null
  notes: string | null
  created_at: string
}

interface Summary {
  totalAssignments: number
  totalReturns: number
  totalReassignments: number
  activeAssignments: number
}

const ACTION_CONFIG: Record<string, { label: string; color: string; icon: any; bgColor: string }> = {
  created: { label: 'Created / Received', color: 'text-blue-700 dark:text-blue-400', icon: Truck, bgColor: 'bg-blue-50 dark:bg-blue-900/30' },
  assigned_to_master_distributor: { label: 'Assigned → MD', color: 'text-purple-700 dark:text-purple-400', icon: ArrowRight, bgColor: 'bg-purple-50 dark:bg-purple-900/30' },
  assigned_to_distributor: { label: 'Assigned → Distributor', color: 'text-indigo-700 dark:text-indigo-400', icon: ArrowRight, bgColor: 'bg-indigo-50 dark:bg-indigo-900/30' },
  assigned_to_retailer: { label: 'Assigned → Retailer', color: 'text-green-700 dark:text-green-400', icon: UserCheck, bgColor: 'bg-green-50 dark:bg-green-900/30' },
  assigned_to_partner: { label: 'Assigned → Partner', color: 'text-teal-700 dark:text-teal-400', icon: ArrowRight, bgColor: 'bg-teal-50 dark:bg-teal-900/30' },
  unassigned_from_retailer: { label: 'Returned ← Retailer', color: 'text-orange-700 dark:text-orange-400', icon: RotateCcw, bgColor: 'bg-orange-50 dark:bg-orange-900/30' },
  unassigned_from_distributor: { label: 'Returned ← Distributor', color: 'text-orange-700 dark:text-orange-400', icon: RotateCcw, bgColor: 'bg-orange-50 dark:bg-orange-900/30' },
  unassigned_from_master_distributor: { label: 'Returned ← MD', color: 'text-orange-700 dark:text-orange-400', icon: RotateCcw, bgColor: 'bg-orange-50 dark:bg-orange-900/30' },
  unassigned_from_partner: { label: 'Returned ← Partner', color: 'text-orange-700 dark:text-orange-400', icon: RotateCcw, bgColor: 'bg-orange-50 dark:bg-orange-900/30' },
  reassigned: { label: 'Reassigned', color: 'text-amber-700 dark:text-amber-400', icon: ArrowLeftRight, bgColor: 'bg-amber-50 dark:bg-amber-900/30' },
}

const FALLBACK_ACTION = { label: 'Unknown', color: 'text-gray-700 dark:text-gray-400', icon: History, bgColor: 'bg-gray-50 dark:bg-gray-900/30' }

export default function POSTrackingReport() {
  const [viewMode, setViewMode] = useState<ViewMode>('movement')
  const [data, setData] = useState<TrackingEntry[]>([])
  const [nameMap, setNameMap] = useState<Record<string, string>>({})
  const [machineMap, setMachineMap] = useState<Record<string, any>>({})
  const [summary, setSummary] = useState<Summary>({ totalAssignments: 0, totalReturns: 0, totalReassignments: 0, activeAssignments: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [merchantId, setMerchantId] = useState('')
  const [machineCode, setMachineCode] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<10 | 25 | 50 | 100>(25)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [showFilters, setShowFilters] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      params.set('view', viewMode)
      params.set('page', String(page))
      params.set('limit', String(pageSize))
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      if (search) params.set('search', search)
      if (viewMode === 'merchant' && merchantId) params.set('merchant_id', merchantId)
      if (viewMode === 'device' && machineCode) params.set('machine_code', machineCode)

      const res = await apiFetch(`/api/admin/pos-tracking-report?${params.toString()}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to fetch')

      setData(json.data || [])
      setNameMap(json.nameMap || {})
      setMachineMap(json.machineMap || {})
      setSummary(json.summary || { totalAssignments: 0, totalReturns: 0, totalReassignments: 0, activeAssignments: 0 })
      setTotalPages(json.pagination?.totalPages || 1)
      setTotal(json.pagination?.total || 0)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [viewMode, page, pageSize, dateFrom, dateTo, search, merchantId, machineCode])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => { setPage(1) }, [viewMode, search, dateFrom, dateTo, merchantId, machineCode, pageSize])

  const handleExportCSV = async () => {
    setExporting(true)
    try {
      const params = new URLSearchParams()
      params.set('view', viewMode)
      params.set('format', 'csv')
      params.set('limit', '999999')
      params.set('page', '1')
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      if (search) params.set('search', search)
      if (viewMode === 'merchant' && merchantId) params.set('merchant_id', merchantId)
      if (viewMode === 'device' && machineCode) params.set('machine_code', machineCode)

      const res = await apiFetch(`/api/admin/pos-tracking-report?${params.toString()}`)
      if (!res.ok) throw new Error('Export failed')

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `pos_tracking_report_${viewMode}_${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setExporting(false)
    }
  }

  const resolveName = (id: string | null, role?: string | null) => {
    if (!id) return '-'
    const name = nameMap[id]
    if (name) return name
    if (id.includes('@')) return id
    return id.substring(0, 12) + '...'
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  }

  const roleLabel = (role: string | null) => {
    if (!role) return ''
    return role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  }

  const viewTabs: { id: ViewMode; label: string; icon: any; desc: string }[] = [
    { id: 'movement', label: 'Date-wise Movement', icon: Calendar, desc: 'All POS movements sorted by date' },
    { id: 'device', label: 'Device Lifecycle', icon: Smartphone, desc: 'Full history of a specific POS device' },
    { id: 'merchant', label: 'Merchant-wise', icon: Users, desc: 'All POS activity for a specific merchant' },
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <FileBarChart className="w-5 h-5 text-blue-600" /> POS Tracking History Report
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Complete lifecycle tracking, inventory accountability &amp; device movement history
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            disabled={exporting || loading || data.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export CSV
          </button>
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard icon={ArrowRight} label="Assignments" value={summary.totalAssignments} color="blue" />
        <SummaryCard icon={RotateCcw} label="Returns" value={summary.totalReturns} color="orange" />
        <SummaryCard icon={ArrowLeftRight} label="Reassignments" value={summary.totalReassignments} color="amber" />
        <SummaryCard icon={CheckCircle2} label="Active" value={summary.activeAssignments} color="green" />
      </div>

      {/* View Mode Tabs */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-1">
        <div className="flex gap-1">
          {viewTabs.map(tab => {
            const Icon = tab.icon
            const active = viewMode === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setViewMode(tab.id)}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  active
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300"
        >
          <span className="flex items-center gap-2"><Filter className="w-4 h-4" /> Filters</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
        </button>
        {showFilters && (
          <div className="px-4 pb-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search machine ID, partner, notes..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
                />
              </div>

              {/* Date From */}
              <div>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
                  placeholder="From date"
                />
              </div>

              {/* Date To */}
              <div>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
                  placeholder="To date"
                />
              </div>

              {/* Context-specific filter */}
              {viewMode === 'device' && (
                <div>
                  <input
                    type="text"
                    value={machineCode}
                    onChange={(e) => setMachineCode(e.target.value)}
                    placeholder="Machine ID (e.g. POS73021814)"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
                  />
                </div>
              )}
              {viewMode === 'merchant' && (
                <div>
                  <input
                    type="text"
                    value={merchantId}
                    onChange={(e) => setMerchantId(e.target.value)}
                    placeholder="Merchant / Partner ID"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
                  />
                </div>
              )}
            </div>

            {/* Clear filters */}
            {(search || dateFrom || dateTo || merchantId || machineCode) && (
              <button
                onClick={() => { setSearch(''); setDateFrom(''); setDateTo(''); setMerchantId(''); setMachineCode('') }}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
              >
                Clear all filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-red-800 dark:text-red-300 text-sm">{error}</p>
        </div>
      )}

      {/* Data Table */}
      {loading ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-12 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : data.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-12 text-center">
          <Package className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400 text-sm">No tracking records found for the selected filters.</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            {viewMode === 'device' ? 'Enter a Machine ID to view its lifecycle.' :
             viewMode === 'merchant' ? 'Enter a Merchant/Partner ID to view their POS history.' :
             'Try adjusting the date range or search criteria.'}
          </p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">DATE</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">MACHINE</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">ACTION</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">ASSIGNED BY</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">FROM (PREV HOLDER)</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">TO (MERCHANT)</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">STATUS</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">RETURN DATE</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">RETURN REASON</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">NOTES</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {data.map((h) => {
                  const cfg = ACTION_CONFIG[h.action] || FALLBACK_ACTION
                  const Icon = cfg.icon
                  const machine = machineMap[h.pos_machine_id]
                  return (
                    <tr key={h.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/30 transition-colors">
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap text-xs">
                        {formatDate(h.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-900 dark:text-white">{h.machine_id}</div>
                        {machine && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 space-x-1">
                            {machine.serial_number && <span>S/N: {machine.serial_number}</span>}
                            {machine.tid && <span>&middot; TID: {machine.tid}</span>}
                            {machine.mid && <span>&middot; MID: {machine.mid}</span>}
                            {machine.brand && <span>&middot; {machine.brand}</span>}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${cfg.bgColor} ${cfg.color}`}>
                          <Icon className="w-3 h-3" />
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div className="text-gray-700 dark:text-gray-300">{resolveName(h.assigned_by)}</div>
                        <div className="text-gray-400 capitalize">{roleLabel(h.assigned_by_role)}</div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {h.previous_holder ? (
                          <>
                            <div className="text-gray-700 dark:text-gray-300">{resolveName(h.previous_holder)}</div>
                            <div className="text-gray-400 capitalize">{roleLabel(h.previous_holder_role)}</div>
                          </>
                        ) : <span className="text-gray-400">-</span>}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {h.assigned_to ? (
                          <>
                            <div className="text-gray-700 dark:text-gray-300 font-medium">{resolveName(h.assigned_to)}</div>
                            <div className="text-gray-400 capitalize">{roleLabel(h.assigned_to_role)}</div>
                          </>
                        ) : (
                          <span className="text-gray-400">Stock / Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          h.status === 'active'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                        }`}>
                          {h.status === 'active' ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                          {h.status === 'active' ? 'Active' : 'Returned'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {h.returned_date ? formatDate(h.returned_date) : '-'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400 max-w-[160px] truncate" title={h.return_reason || ''}>
                        {h.return_reason || '-'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 max-w-[180px] truncate" title={h.notes || ''}>
                        {h.notes || '-'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
                <span>Rows per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value) as 10 | 25 | 50 | 100)}
                  className="px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <span>
                  {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
                </span>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Page {page} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SummaryCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400',
    orange: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800 text-orange-700 dark:text-orange-400',
    amber: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400',
    green: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-400',
  }

  return (
    <div className={`rounded-xl border p-3 ${colorClasses[color] || colorClasses.blue}`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4" />
        <span className="text-xs font-medium opacity-80">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  )
}
