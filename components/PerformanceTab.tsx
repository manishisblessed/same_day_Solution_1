'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'
import {
  Search, RefreshCw, ChevronLeft, ChevronRight, Filter,
  MapPin, Globe, Clock, User, Activity, Shield,
  CheckCircle2, XCircle, AlertTriangle, Eye,
  X, Smartphone, Zap
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface ActivityLog {
  id: string
  user_id: string
  user_role: string
  activity_type: string
  activity_category: string
  activity_description: string | null
  reference_id: string | null
  reference_table: string | null
  latitude: number | null
  longitude: number | null
  geo_accuracy: number | null
  geo_source: string | null
  ip_address: string | null
  user_agent: string | null
  device_info: Record<string, any> | null
  request_path: string | null
  request_method: string | null
  status: string
  error_message: string | null
  metadata: Record<string, any> | null
  created_at: string
}

const CATEGORIES = [
  { value: 'all', label: 'All Categories' },
  { value: 'auth', label: 'Auth' },
  { value: 'bbps', label: 'BBPS' },
  { value: 'payout', label: 'Payout' },
  { value: 'aeps', label: 'AEPS' },
  { value: 'pos', label: 'POS' },
  { value: 'wallet', label: 'Wallet' },
  { value: 'settlement', label: 'Settlement' },
  { value: 'admin', label: 'Admin' },
  { value: 'scheme', label: 'Scheme' },
  { value: 'report', label: 'Report' },
  { value: 'beneficiary', label: 'Beneficiary' },
  { value: 'distributor', label: 'Distributor' },
  { value: 'master_dist', label: 'Master Dist.' },
  { value: 'other', label: 'Other' },
]

const ROLES = [
  { value: 'all', label: 'All Roles' },
  { value: 'admin', label: 'Admin' },
  { value: 'retailer', label: 'Retailer' },
  { value: 'distributor', label: 'Distributor' },
  { value: 'master_distributor', label: 'Master Distributor' },
  { value: 'partner', label: 'Partner' },
]

const CATEGORY_COLORS: Record<string, string> = {
  auth: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  bbps: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  payout: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  aeps: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  pos: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  wallet: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  settlement: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
  admin: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  scheme: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  report: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  beneficiary: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  distributor: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  master_dist: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-400',
  other: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
}

const STATUS_CONFIG: Record<string, { color: string; icon: any }> = {
  success: { color: 'text-green-600 dark:text-green-400', icon: CheckCircle2 },
  failed: { color: 'text-red-600 dark:text-red-400', icon: XCircle },
  error: { color: 'text-red-600 dark:text-red-400', icon: XCircle },
  denied: { color: 'text-amber-600 dark:text-amber-400', icon: AlertTriangle },
}

export default function PerformanceTab() {
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  const [showFilters, setShowFilters] = useState(false)
  const [category, setCategory] = useState('all')
  const [userRole, setUserRole] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [selectedLog, setSelectedLog] = useState<ActivityLog | null>(null)

  const fetchLogs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.append('page', page.toString())
      params.append('limit', '50')
      if (category !== 'all') params.append('category', category)
      if (userRole !== 'all') params.append('user_role', userRole)
      if (statusFilter !== 'all') params.append('status', statusFilter)
      if (search) params.append('search', search)
      if (dateFrom) params.append('date_from', dateFrom)
      if (dateTo) params.append('date_to', dateTo)

      const res = await apiFetch(`/api/admin/activity-logs?${params.toString()}`)
      const data = await res.json()
      if (data.success) {
        setLogs(data.logs)
        setTotal(data.total)
        setTotalPages(data.totalPages)
      }
    } catch (err: any) {
      console.error('Failed to fetch activity logs:', err)
    } finally {
      setLoading(false)
    }
  }, [page, category, userRole, statusFilter, search, dateFrom, dateTo])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    })
  }

  const openGoogleMaps = (lat: number, lng: number) => {
    window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank')
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary-500" />
            Activity Performance Log
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            All actions across the platform with geolocation tracking. Total: {total.toLocaleString()} entries.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              showFilters ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
            }`}
          >
            <Filter className="w-3.5 h-3.5" /> Filters
          </button>
          <button onClick={fetchLogs} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <RefreshCw className={`w-4 h-4 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 p-4 overflow-hidden"
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
                <select value={category} onChange={e => { setCategory(e.target.value); setPage(1) }} className="w-full px-2 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700">
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
                <select value={userRole} onChange={e => { setUserRole(e.target.value); setPage(1) }} className="w-full px-2 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700">
                  {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
                <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }} className="w-full px-2 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700">
                  <option value="all">All</option>
                  <option value="success">Success</option>
                  <option value="failed">Failed</option>
                  <option value="error">Error</option>
                  <option value="denied">Denied</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
                <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }} className="w-full px-2 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
                <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1) }} className="w-full px-2 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input
                    type="text" placeholder="Type, user, description..."
                    value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
                    className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700"
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750">
                <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">User</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Action</th>
                <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-500 uppercase">Geo</th>
                <th className="px-3 py-2.5 text-center text-xs font-medium text-gray-500 uppercase w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <RefreshCw className="w-5 h-5 animate-spin text-primary-500 mx-auto mb-2" />
                    <p className="text-sm text-gray-400">Loading activity logs...</p>
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-400 text-sm">
                    No activity logs found.
                  </td>
                </tr>
              ) : (
                logs.map(log => {
                  const statusConf = STATUS_CONFIG[log.status] || STATUS_CONFIG.success
                  const StatusIcon = statusConf.icon
                  const hasGeo = log.latitude != null && log.longitude != null

                  return (
                    <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors">
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3 h-3 text-gray-400 flex-shrink-0" />
                          <span className="text-xs text-gray-600 dark:text-gray-400">{formatDate(log.created_at)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="text-xs font-medium text-gray-900 dark:text-white truncate max-w-[120px]">{log.user_id}</div>
                        <div className="text-[10px] text-gray-500">{log.user_role}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${CATEGORY_COLORS[log.activity_category] || CATEGORY_COLORS.other}`}>
                          {log.activity_category}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs font-mono text-gray-700 dark:text-gray-300 truncate block max-w-[140px]">{log.activity_type}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs text-gray-600 dark:text-gray-400 truncate block max-w-[200px]">
                          {log.activity_description || '-'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <StatusIcon className={`w-4 h-4 mx-auto ${statusConf.color}`} />
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {hasGeo ? (
                          <button
                            onClick={() => openGoogleMaps(log.latitude!, log.longitude!)}
                            className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                            title={`${log.latitude?.toFixed(4)}, ${log.longitude?.toFixed(4)} (${log.geo_source || 'unknown'})`}
                          >
                            <MapPin className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <Globe className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 mx-auto" />
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => setSelectedLog(log)}
                          className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5 text-gray-400" />
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
            <p className="text-xs text-gray-500">
              Page {page} of {totalPages} ({total.toLocaleString()} total)
            </p>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedLog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedLog(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 max-w-lg w-full max-h-[80vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Activity Detail</h3>
                <button onClick={() => setSelectedLog(null)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 space-y-3">
                <DetailRow label="Time" value={formatDate(selectedLog.created_at)} />
                <DetailRow label="User ID" value={selectedLog.user_id} />
                <DetailRow label="Role" value={selectedLog.user_role} />
                <DetailRow label="Category" value={selectedLog.activity_category} />
                <DetailRow label="Action" value={selectedLog.activity_type} />
                <DetailRow label="Description" value={selectedLog.activity_description} />
                <DetailRow label="Status" value={selectedLog.status} />
                {selectedLog.error_message && <DetailRow label="Error" value={selectedLog.error_message} />}
                <DetailRow label="API Path" value={selectedLog.request_path ? `${selectedLog.request_method} ${selectedLog.request_path}` : null} />
                <DetailRow label="IP Address" value={selectedLog.ip_address} />
                <DetailRow label="Reference" value={selectedLog.reference_id ? `${selectedLog.reference_table || ''} / ${selectedLog.reference_id}` : null} />

                {/* Geolocation */}
                <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> Geolocation
                  </h4>
                  {selectedLog.latitude != null && selectedLog.longitude != null ? (
                    <div className="space-y-1.5">
                      <DetailRow label="Coordinates" value={`${selectedLog.latitude.toFixed(6)}, ${selectedLog.longitude.toFixed(6)}`} />
                      <DetailRow label="Accuracy" value={selectedLog.geo_accuracy ? `${selectedLog.geo_accuracy}m` : null} />
                      <DetailRow label="Source" value={selectedLog.geo_source} />
                      <button
                        onClick={() => openGoogleMaps(selectedLog.latitude!, selectedLog.longitude!)}
                        className="mt-2 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-xs font-medium hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors flex items-center gap-1.5"
                      >
                        <MapPin className="w-3 h-3" /> Open in Google Maps
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">No geolocation data captured for this activity.</p>
                  )}
                </div>

                {/* Metadata */}
                {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Metadata</h4>
                    <pre className="text-[10px] bg-gray-50 dark:bg-gray-900 rounded-lg p-2 overflow-x-auto text-gray-600 dark:text-gray-400">
                      {JSON.stringify(selectedLog.metadata, null, 2)}
                    </pre>
                  </div>
                )}

                {/* User Agent */}
                {selectedLog.user_agent && (
                  <div className="border-t border-gray-200 dark:border-gray-700 pt-3">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1 flex items-center gap-1">
                      <Smartphone className="w-3 h-3" /> User Agent
                    </h4>
                    <p className="text-[10px] text-gray-500 break-all">{selectedLog.user_agent}</p>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-3">
      <span className="text-xs text-gray-500 dark:text-gray-400 w-24 flex-shrink-0 font-medium">{label}</span>
      <span className="text-xs text-gray-900 dark:text-white break-all">{value}</span>
    </div>
  )
}
