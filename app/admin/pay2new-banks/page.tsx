'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import AdminSidebar from '@/components/AdminSidebar'
import {
  CreditCard, RefreshCw, Search, Menu, Loader2,
  CheckCircle2, XCircle, Building2, ToggleLeft, ToggleRight, Info,
} from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useToast } from '@/components/Toast'
import { motion, AnimatePresence } from 'framer-motion'

interface Biller {
  product_code: string
  product_name: string
  service_id: string
  enabled: boolean
  updated_by: string | null
  updated_at: string | null
}

interface Stats { total: number; enabled: number; disabled: number }

function fmtDate(s?: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function Pay2NewBanksPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const { showToast } = useToast()

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [billers, setBillers] = useState<Biller[]>([])
  const [stats, setStats] = useState<Stats>({ total: 0, enabled: 0, disabled: 0 })
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'enabled' | 'disabled'>('all')

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'admin')) {
      router.push('/admin/login')
    }
  }, [user, authLoading, router])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/admin/pay2new-banks')
      const data = await res.json()
      if (data.success) {
        setBillers(data.billers || [])
        setStats(data.stats || { total: 0, enabled: 0, disabled: 0 })
      } else {
        showToast(data.error || 'Failed to load banks', 'error')
      }
    } catch (e: any) {
      showToast(e?.message || 'Failed to load', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => { if (!authLoading && user?.role === 'admin') load() }, [load, authLoading, user])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      const res = await apiFetch('/api/admin/pay2new-banks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh' }),
      })
      const data = await res.json()
      if (data.success) {
        setBillers(data.billers || [])
        setStats(data.stats || { total: 0, enabled: 0, disabled: 0 })
        showToast(`Synced ${data.synced} banks from Pay2New`, 'success')
      } else {
        showToast(data.error || 'Refresh failed', 'error')
      }
    } catch (e: any) {
      showToast(e?.message || 'Refresh failed', 'error')
    } finally {
      setRefreshing(false)
    }
  }

  const handleToggle = async (biller: Biller) => {
    const newEnabled = !biller.enabled
    setToggling(biller.product_code)
    // Optimistic update
    setBillers((prev) =>
      prev.map((b) => b.product_code === biller.product_code ? { ...b, enabled: newEnabled } : b)
    )
    setStats((prev) => ({
      ...prev,
      enabled: prev.enabled + (newEnabled ? 1 : -1),
      disabled: prev.disabled + (newEnabled ? -1 : 1),
    }))
    try {
      const res = await apiFetch('/api/admin/pay2new-banks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', product_code: biller.product_code, enabled: newEnabled }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Toggle failed')
      showToast(`${biller.product_name} ${newEnabled ? 'enabled' : 'disabled'}`, 'success')
      // Refresh updated_at / updated_by from server
      await load()
    } catch (e: any) {
      // Revert optimistic update
      setBillers((prev) =>
        prev.map((b) => b.product_code === biller.product_code ? { ...b, enabled: biller.enabled } : b)
      )
      setStats((prev) => ({
        ...prev,
        enabled: prev.enabled + (newEnabled ? -1 : 1),
        disabled: prev.disabled + (newEnabled ? 1 : -1),
      }))
      showToast(e?.message || 'Toggle failed', 'error')
    } finally {
      setToggling(null)
    }
  }

  const filtered = useMemo(() => {
    let list = billers
    if (filterStatus === 'enabled') list = list.filter((b) => b.enabled)
    if (filterStatus === 'disabled') list = list.filter((b) => !b.enabled)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (b) => b.product_name.toLowerCase().includes(q) || b.product_code.toLowerCase().includes(q)
      )
    }
    return list
  }, [billers, search, filterStatus])

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="lg:ml-64 p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3">
              <div className="p-3 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl shadow-lg">
                <CreditCard className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Pay2New Banks</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                  Enable / disable CC banks shown to users on the Credit Card payment tab
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={load}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Reload
            </button>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 shadow"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Syncing…' : 'Refresh from Pay2New'}
            </button>
          </div>
        </div>

        {/* Info banner when empty */}
        {!loading && billers.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4"
          >
            <Info className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800 dark:text-amber-300">
              <strong>No banks loaded yet.</strong> Click <strong>&ldquo;Refresh from Pay2New&rdquo;</strong> to sync all
              credit-card banks from the Pay2New API. All banks will initially be <strong>disabled</strong>; enable
              only the ones that are working (e.g. Kotak).
            </div>
          </motion.div>
        )}

        {/* Summary cards */}
        {billers.length > 0 && (
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total Banks', value: stats.total, color: 'from-slate-600 to-slate-700', icon: Building2 },
              { label: 'Enabled', value: stats.enabled, color: 'from-emerald-500 to-teal-600', icon: CheckCircle2 },
              { label: 'Disabled', value: stats.disabled, color: 'from-red-500 to-rose-600', icon: XCircle },
            ].map((card) => (
              <div key={card.label} className={`bg-gradient-to-br ${card.color} rounded-xl p-4 text-white shadow-lg`}>
                <card.icon className="w-5 h-5 opacity-80 mb-2" />
                <p className="text-2xl font-bold">{card.value}</p>
                <p className="text-xs opacity-80 mt-0.5">{card.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        {billers.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search bank name or code…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <div className="flex gap-1.5">
              {(['all', 'enabled', 'disabled'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilterStatus(f)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors capitalize ${
                    filterStatus === f
                      ? 'bg-violet-600 text-white border-violet-600'
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-violet-400'
                  }`}
                >
                  {f === 'all' ? `All (${stats.total})` : f === 'enabled' ? `Enabled (${stats.enabled})` : `Disabled (${stats.disabled})`}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Table */}
        {(loading || billers.length > 0) && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    {['Bank Name', 'Product Code', 'Status', 'Last Changed By', 'Last Updated', 'Action'].map((col) => (
                      <th
                        key={col}
                        className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase whitespace-nowrap"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-16 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
                          <span className="text-sm text-gray-500">Loading banks…</span>
                        </div>
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-400 dark:text-gray-500 text-sm">
                        No banks match your filter.
                      </td>
                    </tr>
                  ) : (
                    <AnimatePresence initial={false}>
                      {filtered.map((biller) => (
                        <motion.tr
                          key={biller.product_code}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                        >
                          {/* Bank name */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span
                                className={`inline-flex w-2 h-2 rounded-full shrink-0 ${
                                  biller.enabled ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'
                                }`}
                              />
                              <span className="text-sm font-medium text-gray-900 dark:text-white">
                                {biller.product_name}
                              </span>
                            </div>
                          </td>

                          {/* Product code */}
                          <td className="px-4 py-3">
                            <span className="text-xs font-mono text-gray-500 dark:text-gray-400">
                              {biller.product_code}
                            </span>
                          </td>

                          {/* Status badge */}
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                                biller.enabled
                                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                  : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
                              }`}
                            >
                              {biller.enabled ? (
                                <CheckCircle2 className="w-3 h-3" />
                              ) : (
                                <XCircle className="w-3 h-3" />
                              )}
                              {biller.enabled ? 'Enabled' : 'Disabled'}
                            </span>
                          </td>

                          {/* Updated by */}
                          <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                            {biller.updated_by || '—'}
                          </td>

                          {/* Updated at */}
                          <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                            {fmtDate(biller.updated_at)}
                          </td>

                          {/* Toggle button */}
                          <td className="px-4 py-3">
                            <button
                              onClick={() => handleToggle(biller)}
                              disabled={toggling === biller.product_code}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                biller.enabled
                                  ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/40'
                                  : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-900/40'
                              } disabled:opacity-50`}
                            >
                              {toggling === biller.product_code ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : biller.enabled ? (
                                <ToggleRight className="w-3 h-3" />
                              ) : (
                                <ToggleLeft className="w-3 h-3" />
                              )}
                              {biller.enabled ? 'Disable' : 'Enable'}
                            </button>
                          </td>
                        </motion.tr>
                      ))}
                    </AnimatePresence>
                  )}
                </tbody>
              </table>
            </div>

            {!loading && filtered.length > 0 && (
              <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
                Showing {filtered.length} of {billers.length} banks
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
