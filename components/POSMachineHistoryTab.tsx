'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  History, Search, RefreshCw, ChevronLeft, ChevronRight,
  ArrowRight, ArrowDown, ArrowUp, Package, Loader2,
  Filter, AlertCircle, CreditCard, RotateCcw, Truck, UserCheck, Download,
  Pencil, Check, X
} from 'lucide-react'
import { apiFetch } from '@/lib/api-client'

interface HistoryEntry {
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
  assigned_date: string | null
  transit_date: string | null
  delivered_date: string | null
  returned_date: string | null
  notes: string | null
  created_at: string
}

const ACTION_CONFIG: Record<string, { label: string; color: string; icon: any; bgColor: string }> = {
  created: { label: 'Created / Received', color: 'text-blue-700', icon: Truck, bgColor: 'bg-blue-100 dark:bg-blue-900/30' },
  assigned_to_master_distributor: { label: 'Assigned to Master Distributor', color: 'text-purple-700', icon: ArrowRight, bgColor: 'bg-purple-100 dark:bg-purple-900/30' },
  assigned_to_distributor: { label: 'Assigned to Distributor', color: 'text-indigo-700', icon: ArrowRight, bgColor: 'bg-indigo-100 dark:bg-indigo-900/30' },
  assigned_to_retailer: { label: 'Assigned to Retailer', color: 'text-green-700', icon: UserCheck, bgColor: 'bg-green-100 dark:bg-green-900/30' },
  assigned_to_partner: { label: 'Assigned to Partner', color: 'text-teal-700', icon: ArrowRight, bgColor: 'bg-teal-100 dark:bg-teal-900/30' },
  unassigned_from_retailer: { label: 'Returned from Retailer', color: 'text-orange-700', icon: RotateCcw, bgColor: 'bg-orange-100 dark:bg-orange-900/30' },
  unassigned_from_distributor: { label: 'Returned from Distributor', color: 'text-orange-700', icon: RotateCcw, bgColor: 'bg-orange-100 dark:bg-orange-900/30' },
  unassigned_from_master_distributor: { label: 'Returned from Master Distributor', color: 'text-orange-700', icon: RotateCcw, bgColor: 'bg-orange-100 dark:bg-orange-900/30' },
  unassigned_from_partner: { label: 'Returned from Partner', color: 'text-orange-700', icon: RotateCcw, bgColor: 'bg-orange-100 dark:bg-orange-900/30' },
  reassigned: { label: 'Reassigned', color: 'text-amber-700', icon: ArrowRight, bgColor: 'bg-amber-100 dark:bg-amber-900/30' },
  recalled_to_master_distributor: { label: 'Recalled to MD', color: 'text-violet-700', icon: RotateCcw, bgColor: 'bg-violet-100 dark:bg-violet-900/30' },
  recalled_to_distributor: { label: 'Recalled to Distributor', color: 'text-violet-700', icon: RotateCcw, bgColor: 'bg-violet-100 dark:bg-violet-900/30' },
}

const FALLBACK_ACTION = { label: 'Unknown', color: 'text-gray-700', icon: History, bgColor: 'bg-gray-100 dark:bg-gray-900/30' }

export default function POSMachineHistoryTab() {
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [nameMap, setNameMap] = useState<Record<string, string>>({})
  const [machineMap, setMachineMap] = useState<Record<string, any>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<10 | 25 | 100>(25)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [backfilling, setBackfilling] = useState(false)
  const [backfillDone, setBackfillDone] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTransit, setEditTransit] = useState('')
  const [editDelivered, setEditDelivered] = useState('')
  const [saving, setSaving] = useState(false)

  const [statusFilter, setStatusFilter] = useState('all')

  const fetchHistory = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let url = `/api/admin/pos-machines/history?page=${page}&limit=${pageSize}`
      if (actionFilter !== 'all') url += `&action=${actionFilter}`
      if (statusFilter !== 'all') url += `&assignment_status=${statusFilter}`
      if (search) url += `&search=${encodeURIComponent(search)}`

      const res = await apiFetch(url)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to fetch')

      setHistory(data.data || [])
      setNameMap(data.nameMap || {})
      setMachineMap(data.machineMap || {})
      setTotalPages(data.pagination?.totalPages || 1)
      setTotal(data.pagination?.total || 0)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, actionFilter, statusFilter, search])

  useEffect(() => { fetchHistory() }, [fetchHistory])

  useEffect(() => { setPage(1) }, [search, actionFilter, statusFilter, pageSize])

  const handleBackfill = async () => {
    setBackfilling(true)
    try {
      const res = await apiFetch('/api/admin/pos-machines/history', {
        method: 'POST',
        body: JSON.stringify({ backfill: true }),
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setBackfillDone(true)
        fetchHistory()
      } else {
        setError(data.error || 'Backfill failed')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBackfilling(false)
    }
  }

  const handleExportCSV = async () => {
    setExporting(true)
    try {
      let url = `/api/admin/pos-machines/history?format=csv&limit=999999&page=1`
      if (actionFilter !== 'all') url += `&action=${actionFilter}`
      if (statusFilter !== 'all') url += `&assignment_status=${statusFilter}`
      if (search) url += `&search=${encodeURIComponent(search)}`

      const res = await apiFetch(url)
      if (!res.ok) throw new Error('Export failed')

      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = `pos_history_${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(blobUrl)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setExporting(false)
    }
  }

  const startEditing = (h: HistoryEntry) => {
    setEditingId(h.id)
    setEditTransit(h.transit_date ? new Date(h.transit_date).toISOString().slice(0, 10) : '')
    setEditDelivered(h.delivered_date ? new Date(h.delivered_date).toISOString().slice(0, 10) : '')
  }

  const handleSaveDates = async () => {
    if (!editingId) return
    setSaving(true)
    try {
      const res = await apiFetch('/api/admin/pos-machines/history/update-dates', {
        method: 'PATCH',
        body: JSON.stringify({
          history_id: editingId,
          transit_date: editTransit ? new Date(editTransit + 'T00:00:00').toISOString() : null,
          delivered_date: editDelivered ? new Date(editDelivered + 'T00:00:00').toISOString() : null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to update'); return }
      setEditingId(null)
      fetchHistory()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const resolveName = (id: string | null, role: string | null) => {
    if (!id) return '-'
    const name = nameMap[id]
    if (name) return name
    if (id.includes('@')) return id
    return `Unknown/Deleted`
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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <History className="w-5 h-5" /> POS Machine History
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Full lifecycle &amp; assignment trail for every POS machine ({total} events)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            disabled={exporting || loading || total === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export CSV
          </button>
          <button
            onClick={fetchHistory}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search machine ID, partner ID, notes..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
            />
          </div>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
          >
            <option value="all">All Actions</option>
            <option value="created">Created / Received</option>
            <option value="assigned_to_master_distributor">Assigned to MD</option>
            <option value="assigned_to_distributor">Assigned to Distributor</option>
            <option value="assigned_to_retailer">Assigned to Retailer</option>
            <option value="assigned_to_partner">Assigned to Partner</option>
            <option value="unassigned_from_retailer">Returned from Retailer</option>
            <option value="unassigned_from_distributor">Returned from Distributor</option>
            <option value="unassigned_from_master_distributor">Returned from MD</option>
            <option value="unassigned_from_partner">Returned from Partner</option>
            <option value="reassigned">Reassigned</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="returned">Returned</option>
          </select>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-red-800 dark:text-red-300 text-sm">{error}</p>
        </div>
      )}

      {/* History List */}
      {loading ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-12 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      ) : history.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-12 text-center">
          <History className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400 text-sm">No history records found.</p>
          {!backfillDone && !search && actionFilter === 'all' && (
            <div className="mt-4">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
                POS machines assigned before history tracking may not have records.
              </p>
              <button
                onClick={handleBackfill}
                disabled={backfilling}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {backfilling ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
                ) : (
                  <><RotateCcw className="w-4 h-4" /> Generate History from Existing Assignments</>
                )}
              </button>
            </div>
          )}
          {backfillDone && (
            <p className="mt-3 text-sm text-green-600 dark:text-green-400">History backfill complete. Refreshing...</p>
          )}
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700">
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">MACHINE</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">ACTION</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">BY</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">FROM</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">WAS ASSIGNED TO</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">ASSIGNED DATE</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">TRANSIT DATE</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">DELIVERED DATE</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">RETURN DATE</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">STATUS</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">CURRENT HOLDER</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300">NOTES</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700 dark:text-gray-300"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {history.map((h) => {
                  const cfg = ACTION_CONFIG[h.action] || FALLBACK_ACTION
                  const Icon = cfg.icon
                  const machine = machineMap[h.pos_machine_id]
                  return (
                    <tr key={h.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-900 dark:text-white">{h.machine_id}</div>
                        {machine && (
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            S/N: {machine.serial_number || '-'} &middot; TID: {machine.tid || '-'}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${cfg.bgColor} ${cfg.color}`}>
                          <Icon className="w-3 h-3" />
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 text-xs">
                        <div>{resolveName(h.assigned_by, h.assigned_by_role)}</div>
                        <div className="text-gray-400 capitalize">{roleLabel(h.assigned_by_role)}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 text-xs">
                        {h.previous_holder ? (
                          <>
                            <div>{resolveName(h.previous_holder, h.previous_holder_role)}</div>
                            <div className="text-gray-400 capitalize">{roleLabel(h.previous_holder_role)}</div>
                          </>
                        ) : '-'}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 text-xs">
                        {h.assigned_to ? (
                          <>
                            <div>{resolveName(h.assigned_to, h.assigned_to_role)}</div>
                            <div className="text-gray-400 capitalize">{roleLabel(h.assigned_to_role)}</div>
                          </>
                        ) : (
                          <div>
                            <div className="text-orange-600 dark:text-orange-400 font-medium">Admin Stock</div>
                            <div className="text-gray-400">Returned</div>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {h.assigned_date ? formatDate(h.assigned_date) : formatDate(h.created_at)}
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        {editingId === h.id ? (
                          <input type="date" value={editTransit} onChange={(e) => setEditTransit(e.target.value)} className="px-1.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-white w-[130px]" />
                        ) : (
                          <span className={h.transit_date ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}>{h.transit_date ? formatDate(h.transit_date) : '-'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        {editingId === h.id ? (
                          <input type="date" value={editDelivered} onChange={(e) => setEditDelivered(e.target.value)} className="px-1.5 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-white w-[130px]" />
                        ) : (
                          <span className={h.delivered_date ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}>{h.delivered_date ? formatDate(h.delivered_date) : '-'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {h.returned_date ? formatDate(h.returned_date) : '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          h.status === 'active'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                        }`}>
                          {h.status === 'active' ? 'Active' : 'Returned'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {(() => {
                          if (!machine) return <span className="text-gray-400">-</span>
                          const inv = machine.inventory_status
                          if (inv === 'in_stock' || inv === 'received_from_bank') {
                            return <span className="text-orange-600 dark:text-orange-400 font-medium">In Stock</span>
                          }
                          const holderId = machine.partner_id || machine.master_distributor_id || machine.distributor_id || machine.retailer_id
                          const holderName = holderId ? resolveName(holderId, null) : '-'
                          const holderRole = machine.partner_id ? 'Partner' : machine.master_distributor_id ? 'MD' : machine.distributor_id ? 'Distributor' : machine.retailer_id ? 'Retailer' : ''
                          return (
                            <div>
                              <div className="text-gray-800 dark:text-gray-200">{holderName}</div>
                              <div className="text-gray-400">{holderRole}</div>
                            </div>
                          )
                        })()}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 max-w-[200px] truncate" title={h.notes || ''}>
                        {h.notes || '-'}
                      </td>
                      <td className="px-4 py-3">
                        {editingId === h.id ? (
                          <div className="flex items-center gap-1">
                            <button onClick={handleSaveDates} disabled={saving} className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600" title="Save">
                              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                            </button>
                            <button onClick={() => setEditingId(null)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500" title="Cancel">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => startEditing(h)} className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 text-blue-500" title="Update Transit/Delivered Dates">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
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
                  onChange={(e) => setPageSize(Number(e.target.value) as 10 | 25 | 100)}
                  className="px-2 py-1 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
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
                    className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    Page {page} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="p-1.5 rounded-lg border border-gray-300 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700"
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
