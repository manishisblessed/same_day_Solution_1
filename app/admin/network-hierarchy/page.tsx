'use client'

import { useState, useEffect, useMemo, Suspense } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { secureDb } from '@/lib/secure-db'
import AdminSidebar from '@/components/AdminSidebar'
import NetworkHierarchyTree from '@/components/NetworkHierarchyTree'
import {
  Crown, Package, Users, GitBranch, RefreshCw,
  ChevronDown, ChevronRight, TrendingUp, Activity, Search,
  CheckCircle2, XCircle, AlertTriangle, Loader2, Menu
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useSidebarMobile } from '@/hooks/useSidebar'

interface MasterDistributor {
  id: string
  partner_id: string
  name: string
  email: string
  phone?: string
  status?: string
  business_name?: string
  city?: string
  state?: string
  created_at?: string
}

interface Distributor {
  id: string
  partner_id: string
  name: string
  email: string
  phone?: string
  status?: string
  business_name?: string
  master_distributor_id?: string
  created_at?: string
}

interface Retailer {
  id: string
  partner_id: string
  name: string
  email: string
  phone?: string
  status?: string
  business_name?: string
  distributor_id?: string
  master_distributor_id?: string
  created_at?: string
}

function NetworkHierarchyContent() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const { openMobile } = useSidebarMobile()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [masterDistributors, setMasterDistributors] = useState<MasterDistributor[]>([])
  const [distributors, setDistributors] = useState<Distributor[]>([])
  const [retailers, setRetailers] = useState<Retailer[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Which MD node is expanded
  const [expandedMDs, setExpandedMDs] = useState<Set<string>>(new Set())
  const [allMDsExpanded, setAllMDsExpanded] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    if (authLoading) return
    if (!user || (user.role !== 'admin' && user.role !== 'finance_executive')) {
      router.push('/admin/login')
      return
    }
    fetchData()
  }, [user, authLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    try {
      const [mdsRes, dtsRes, rtsRes] = await Promise.all([
        secureDb.from('master_distributors').select('*').order('created_at', { ascending: false }),
        secureDb.from('distributors').select('*').order('created_at', { ascending: false }),
        secureDb.from('retailers').select('*').order('created_at', { ascending: false }),
      ])
      setMasterDistributors(mdsRes.data || [])
      setDistributors(dtsRes.data || [])
      setRetailers(rtsRes.data || [])
    } catch (err) {
      console.error('Failed to load hierarchy data', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  // Group distributors by MD
  const dtsByMD = useMemo(() => {
    const map: Record<string, Distributor[]> = {}
    distributors.forEach((d) => {
      const key = d.master_distributor_id || '__none__'
      if (!map[key]) map[key] = []
      map[key].push(d)
    })
    return map
  }, [distributors])

  // Group retailers by MD
  const rtsByMD = useMemo(() => {
    const map: Record<string, Retailer[]> = {}
    retailers.forEach((r) => {
      const key = r.master_distributor_id || '__none__'
      if (!map[key]) map[key] = []
      map[key].push(r)
    })
    return map
  }, [retailers])

  // Network-wide stats
  const totalMDs = masterDistributors.length
  const activeMDs = masterDistributors.filter((m) => !m.status || m.status === 'active').length
  const totalDTs = distributors.length
  const activeDTs = distributors.filter((d) => !d.status || d.status === 'active').length
  const totalRTs = retailers.length
  const activeRTs = retailers.filter((r) => !r.status || r.status === 'active').length
  const unassignedDTs = (dtsByMD['__none__'] || []).length
  const unassignedRTs = (rtsByMD['__none__'] || []).length

  // Filter MDs by search
  const lc = searchTerm.toLowerCase()
  const filteredMDs = useMemo(() => {
    if (!lc) return masterDistributors
    return masterDistributors.filter(
      (m) =>
        m.name?.toLowerCase().includes(lc) ||
        m.business_name?.toLowerCase().includes(lc) ||
        m.email?.toLowerCase().includes(lc) ||
        m.partner_id?.toLowerCase().includes(lc)
    )
  }, [masterDistributors, lc])

  const toggleMD = (mdId: string) => {
    setExpandedMDs((prev) => {
      const next = new Set(prev)
      if (next.has(mdId)) next.delete(mdId)
      else next.add(mdId)
      return next
    })
  }

  const toggleAllMDs = () => {
    if (allMDsExpanded) {
      setExpandedMDs(new Set())
      setAllMDsExpanded(false)
    } else {
      setExpandedMDs(new Set(masterDistributors.map((m) => m.partner_id)))
      setAllMDsExpanded(true)
    }
  }

  const isMDExpanded = (mdId: string) => !!lc || allMDsExpanded || expandedMDs.has(mdId)

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <Loader2 className="w-8 h-8 animate-spin text-yellow-500" />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-950">
      <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="flex-1 lg:ml-56 pt-20 pb-10">
        {/* Mobile header */}
        <div className="fixed top-0 left-0 right-0 z-40 flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 lg:hidden">
          <button onClick={() => { setSidebarOpen(true); openMobile() }} className="p-2 rounded-lg hover:bg-gray-100">
            <Menu className="w-5 h-5 text-gray-700" />
          </button>
          <span className="font-semibold text-gray-900 dark:text-white">Network Hierarchy</span>
        </div>

        <div className="px-4 md:px-6 max-w-7xl mx-auto space-y-6">
          {/* Page header */}
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="p-2.5 bg-gradient-to-br from-yellow-400 to-amber-500 rounded-xl shadow-sm">
                  <GitBranch className="w-5 h-5 text-white" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Network Hierarchy</h1>
              </div>
              <p className="text-sm text-gray-500 ml-14">
                Full view — Admin → MD → DT → RT with live counts, status and search
              </p>
            </div>
            <button
              onClick={() => fetchData(true)}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60 transition shadow-sm"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {/* Network-wide stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {[
              { label: 'Master Distributors', value: totalMDs, active: activeMDs, color: 'yellow', Icon: Crown },
              { label: 'Distributors', value: totalDTs, active: activeDTs, color: 'blue', Icon: Package },
              { label: 'Retailers', value: totalRTs, active: activeRTs, color: 'purple', Icon: Users },
              { label: 'Active Rate (MD)', value: `${totalMDs > 0 ? Math.round((activeMDs / totalMDs) * 100) : 0}%`, color: 'green', Icon: TrendingUp },
              { label: 'Unassigned DTs', value: unassignedDTs, color: 'orange', Icon: AlertTriangle },
              { label: 'Unassigned RTs', value: unassignedRTs, color: 'red', Icon: AlertTriangle },
            ].map(({ label, value, active, color, Icon }) => (
              <div key={label} className={`bg-white border rounded-xl p-4 shadow-sm border-gray-200`}>
                <div className="flex items-center gap-2 mb-1">
                  <div className={`p-1.5 rounded-lg bg-${color}-100`}>
                    <Icon className={`w-3.5 h-3.5 text-${color}-600`} />
                  </div>
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide leading-tight">{label}</span>
                </div>
                <p className="text-xl font-bold text-gray-900">{value}</p>
                {active !== undefined && (
                  <p className="text-xs text-gray-400 mt-0.5">{active} active</p>
                )}
              </div>
            ))}
          </div>

          {/* Search + expand/collapse all */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name, partner ID or email across all levels…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none transition shadow-sm"
              />
            </div>
            <button
              onClick={toggleAllMDs}
              className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50 whitespace-nowrap shadow-sm transition"
            >
              {allMDsExpanded
                ? <><ChevronDown className="w-4 h-4" /> Collapse All MDs</>
                : <><ChevronRight className="w-4 h-4" /> Expand All MDs</>
              }
            </button>
          </div>

          {/* Hierarchy tree per MD */}
          <div className="space-y-4">
            {filteredMDs.length === 0 && (
              <div className="bg-white border border-gray-200 rounded-xl p-12 text-center shadow-sm">
                <Crown className="w-12 h-12 mx-auto mb-3 text-gray-200" />
                <p className="text-gray-500 font-medium">
                  {searchTerm ? 'No master distributors match your search' : 'No master distributors yet'}
                </p>
              </div>
            )}

            {filteredMDs.map((md) => {
              const mdDTs = dtsByMD[md.partner_id] || []
              const mdRTs = rtsByMD[md.partner_id] || []
              const expanded = isMDExpanded(md.partner_id)
              const mdActive = !md.status || md.status === 'active'

              return (
                <div key={md.id} className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
                  {/* MD header row */}
                  <button
                    onClick={() => !lc && !allMDsExpanded && toggleMD(md.partner_id)}
                    className="w-full flex items-center gap-4 px-5 py-4 bg-gradient-to-r from-amber-50 via-yellow-50 to-white hover:from-amber-100 hover:via-yellow-100 hover:to-gray-50 transition-colors text-left group"
                  >
                    {/* Expand icon */}
                    <div className="text-amber-400 group-hover:text-amber-600 transition-colors">
                      {expanded
                        ? <ChevronDown className="w-5 h-5" />
                        : <ChevronRight className="w-5 h-5" />
                      }
                    </div>

                    {/* MD avatar */}
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center flex-shrink-0 shadow-sm">
                      <Crown className="w-5 h-5 text-white" />
                    </div>

                    {/* MD info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-gray-900">
                          {md.business_name || md.name}
                        </span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          mdActive ? 'bg-emerald-100 text-emerald-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {mdActive ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                          {md.status || 'active'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 truncate">
                        {md.partner_id} &nbsp;·&nbsp; {md.email}
                        {md.city ? ` · ${md.city}` : ''}
                        {md.state ? `, ${md.state}` : ''}
                      </p>
                    </div>

                    {/* Counts */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 text-blue-700 border border-blue-100 rounded-full text-xs font-semibold">
                        <Package className="w-3 h-3" />
                        {mdDTs.length} DT{mdDTs.length !== 1 ? 's' : ''}
                      </span>
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-purple-50 text-purple-700 border border-purple-100 rounded-full text-xs font-semibold">
                        <Users className="w-3 h-3" />
                        {mdRTs.length} RT{mdRTs.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </button>

                  {/* Expanded: nested DT → RT hierarchy tree */}
                  <AnimatePresence initial={false}>
                    {expanded && (
                      <motion.div
                        key="md-tree"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: 'easeInOut' }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-gray-100 p-4 bg-gray-50/40">
                          {mdDTs.length === 0 && mdRTs.length === 0 ? (
                            <div className="py-6 text-center text-gray-400 text-sm">
                              <Package className="w-8 h-8 mx-auto mb-2 opacity-20" />
                              No distributors or retailers under this MD
                            </div>
                          ) : (
                            <NetworkHierarchyTree
                              distributors={mdDTs}
                              retailers={mdRTs}
                              showStatsCards={false}
                            />
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}

            {/* Orphan DTs — not under any MD */}
            {(dtsByMD['__none__'] || []).length > 0 && (
              <div className="bg-white border-2 border-dashed border-orange-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="flex items-center gap-4 px-5 py-4 bg-orange-50/60">
                  <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-5 h-5 text-orange-500" />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-orange-700">Orphan Distributors ({dtsByMD['__none__'].length})</p>
                    <p className="text-xs text-orange-400">Not assigned to any Master Distributor</p>
                  </div>
                </div>
                <div className="divide-y divide-orange-100">
                  {dtsByMD['__none__'].map((dt) => {
                    const dtRTs = retailers.filter((r) => r.distributor_id === dt.partner_id)
                    return (
                      <div key={dt.id} className="flex items-center gap-4 px-5 py-3">
                        <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                          <Package className="w-3.5 h-3.5 text-blue-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800">{dt.business_name || dt.name}</p>
                          <p className="text-xs text-gray-400">{dt.partner_id} · {dt.email}</p>
                        </div>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full text-xs font-medium">
                          <Users className="w-3 h-3" /> {dtRTs.length} RTs
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Orphan RTs — not under any MD or DT */}
            {(retailers.filter(r => !r.master_distributor_id && !r.distributor_id)).length > 0 && (
              <div className="bg-white border-2 border-dashed border-red-200 rounded-2xl shadow-sm overflow-hidden">
                <div className="flex items-center gap-4 px-5 py-4 bg-red-50/60">
                  <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-5 h-5 text-red-500" />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-red-700">
                      Orphan Retailers ({retailers.filter(r => !r.master_distributor_id && !r.distributor_id).length})
                    </p>
                    <p className="text-xs text-red-400">Not assigned to any MD or DT</p>
                  </div>
                </div>
                <div className="divide-y divide-red-100">
                  {retailers
                    .filter((r) => !r.master_distributor_id && !r.distributor_id)
                    .map((rt) => (
                      <div key={rt.id} className="flex items-center gap-4 px-5 py-3">
                        <div className="w-7 h-7 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0">
                          <Users className="w-3.5 h-3.5 text-purple-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800">{rt.name}</p>
                          <p className="text-xs text-gray-400">{rt.partner_id} · {rt.email}</p>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          rt.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {rt.status || 'active'}
                        </span>
                      </div>
                    ))
                  }
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

export default function NetworkHierarchyPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-yellow-500" />
      </div>
    }>
      <NetworkHierarchyContent />
    </Suspense>
  )
}
