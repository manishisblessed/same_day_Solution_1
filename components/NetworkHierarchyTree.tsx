'use client'

import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronDown, ChevronRight, Users, Package, Crown, Search,
  CheckCircle2, XCircle, Activity, GitBranch, AlertTriangle
} from 'lucide-react'

export interface HierarchyDistributor {
  id: string
  partner_id: string
  name: string
  email: string
  phone?: string
  status?: string
  master_distributor_id?: string
  business_name?: string
  created_at?: string
}

export interface HierarchyRetailer {
  id: string
  partner_id: string
  name: string
  email: string
  phone?: string
  status?: string
  distributor_id?: string
  master_distributor_id?: string
  business_name?: string
  created_at?: string
}

interface NetworkHierarchyTreeProps {
  distributors: HierarchyDistributor[]
  retailers: HierarchyRetailer[]
  masterDistributorName?: string
  className?: string
  showStatsCards?: boolean
}

function StatusBadge({ status }: { status?: string }) {
  const s = status || 'active'
  if (s === 'active') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
        <CheckCircle2 className="w-3 h-3" /> Active
      </span>
    )
  }
  if (s === 'inactive') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
        <AlertTriangle className="w-3 h-3" /> Inactive
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
      <XCircle className="w-3 h-3" /> {s}
    </span>
  )
}

export default function NetworkHierarchyTree({
  distributors,
  retailers,
  masterDistributorName,
  className = '',
  showStatsCards = true,
}: NetworkHierarchyTreeProps) {
  const [expandedDTs, setExpandedDTs] = useState<Set<string>>(new Set())
  const [searchTerm, setSearchTerm] = useState('')
  const [allExpanded, setAllExpanded] = useState(false)

  // Group retailers by distributor_id
  const retailersByDT = useMemo(() => {
    const map: Record<string, HierarchyRetailer[]> = {}
    retailers.forEach((r) => {
      const key = r.distributor_id || '__none__'
      if (!map[key]) map[key] = []
      map[key].push(r)
    })
    return map
  }, [retailers])

  const unassignedRetailers = retailersByDT['__none__'] || []

  // Stats
  const totalDTs = distributors.length
  const activeDTs = distributors.filter((d) => !d.status || d.status === 'active').length
  const totalRTs = retailers.length
  const activeRTs = retailers.filter((r) => !r.status || r.status === 'active').length
  const avgRTsPerDT = totalDTs > 0 ? (totalRTs / totalDTs).toFixed(1) : '0'
  const unassignedRTCount = unassignedRetailers.length

  // Search filter
  const lc = searchTerm.toLowerCase()

  const filteredDTs = useMemo(() => {
    if (!lc) return distributors
    return distributors.filter(
      (d) =>
        d.name?.toLowerCase().includes(lc) ||
        d.business_name?.toLowerCase().includes(lc) ||
        d.email?.toLowerCase().includes(lc) ||
        d.partner_id?.toLowerCase().includes(lc)
    )
  }, [distributors, lc])

  const getFilteredRTsForDT = (dtPartnerId: string) => {
    const all = retailersByDT[dtPartnerId] || []
    if (!lc) return all
    return all.filter(
      (r) =>
        r.name?.toLowerCase().includes(lc) ||
        r.email?.toLowerCase().includes(lc) ||
        r.partner_id?.toLowerCase().includes(lc)
    )
  }

  // Expand all when searching
  const effectivelyExpanded = (dtId: string) =>
    !!lc || allExpanded || expandedDTs.has(dtId)

  const toggleDT = (dtId: string) => {
    setExpandedDTs((prev) => {
      const next = new Set(prev)
      if (next.has(dtId)) next.delete(dtId)
      else next.add(dtId)
      return next
    })
  }

  const toggleExpandAll = () => {
    if (allExpanded) {
      setExpandedDTs(new Set())
      setAllExpanded(false)
    } else {
      setExpandedDTs(new Set(distributors.map((d) => d.partner_id)))
      setAllExpanded(true)
    }
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Stats Cards */}
      {showStatsCards && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 bg-blue-100 rounded-lg">
                <Package className="w-4 h-4 text-blue-600" />
              </div>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Distributors</span>
            </div>
            <p className="text-2xl font-bold text-gray-900 mt-1">{totalDTs}</p>
            <p className="text-xs text-gray-400 mt-0.5">{activeDTs} active · {totalDTs - activeDTs} inactive</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 bg-purple-100 rounded-lg">
                <Users className="w-4 h-4 text-purple-600" />
              </div>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Retailers</span>
            </div>
            <p className="text-2xl font-bold text-gray-900 mt-1">{totalRTs}</p>
            <p className="text-xs text-gray-400 mt-0.5">{activeRTs} active · {totalRTs - activeRTs} inactive</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 bg-green-100 rounded-lg">
                <Activity className="w-4 h-4 text-green-600" />
              </div>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Avg RTs / DT</span>
            </div>
            <p className="text-2xl font-bold text-gray-900 mt-1">{avgRTsPerDT}</p>
            <p className="text-xs text-gray-400 mt-0.5">retailers per distributor</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <div className="p-1.5 bg-orange-100 rounded-lg">
                <GitBranch className="w-4 h-4 text-orange-600" />
              </div>
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Unassigned RTs</span>
            </div>
            <p className="text-2xl font-bold text-gray-900 mt-1">{unassignedRTCount}</p>
            <p className="text-xs text-gray-400 mt-0.5">not under any DT</p>
          </div>
        </div>
      )}

      {/* Search + expand control */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search distributors or retailers by name, ID or email…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none transition"
          />
        </div>
        <button
          onClick={toggleExpandAll}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50 whitespace-nowrap transition"
        >
          {allExpanded ? (
            <><ChevronDown className="w-4 h-4" /> Collapse All</>
          ) : (
            <><ChevronRight className="w-4 h-4" /> Expand All</>
          )}
        </button>
      </div>

      {/* Tree */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        {/* MD Root node */}
        {masterDistributorName && (
          <div className="flex items-center gap-3 px-5 py-4 bg-gradient-to-r from-amber-50 to-yellow-50 border-b border-yellow-100">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-yellow-400 to-amber-500 flex items-center justify-center flex-shrink-0 shadow-sm">
              <Crown className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900">{masterDistributorName}</p>
              <p className="text-xs text-amber-600 font-medium">
                Master Distributor &nbsp;·&nbsp; {totalDTs} DT{totalDTs !== 1 ? 's' : ''} &nbsp;·&nbsp; {totalRTs} RT{totalRTs !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        )}

        {/* Empty state */}
        {filteredDTs.length === 0 && (
          <div className="py-12 text-center text-gray-400">
            <Package className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="font-medium">
              {searchTerm ? 'No results for your search' : 'No distributors yet'}
            </p>
            {searchTerm && (
              <p className="text-xs mt-1">Try a different name, ID or email</p>
            )}
          </div>
        )}

        {/* DT nodes */}
        {filteredDTs.map((dt, idx) => {
          const dtRTs = getFilteredRTsForDT(dt.partner_id)
          const allDTRTs = retailersByDT[dt.partner_id] || []
          const expanded = effectivelyExpanded(dt.partner_id)
          const isLastDT = idx === filteredDTs.length - 1 && unassignedRetailers.length === 0

          return (
            <div
              key={dt.id}
              className={`${!isLastDT ? 'border-b border-gray-100' : ''}`}
            >
              {/* DT row */}
              <button
                onClick={() => !lc && !allExpanded && toggleDT(dt.partner_id)}
                className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-gray-50 transition-colors text-left group"
              >
                {/* Toggle icon */}
                <div className="w-4 h-4 flex-shrink-0 text-gray-400 group-hover:text-gray-600">
                  {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </div>

                {/* Indent line */}
                <div className="w-4 flex-shrink-0" />

                {/* DT icon */}
                <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <Package className="w-3.5 h-3.5 text-blue-600" />
                </div>

                {/* DT info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-800 text-sm">
                      {dt.business_name || dt.name}
                    </span>
                    <StatusBadge status={dt.status} />
                  </div>
                  <p className="text-xs text-gray-400 truncate">
                    {dt.partner_id} &nbsp;·&nbsp; {dt.email}
                    {dt.phone ? ` · ${dt.phone}` : ''}
                  </p>
                </div>

                {/* RT count badge */}
                <div className="flex-shrink-0">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-purple-50 text-purple-700 border border-purple-100 rounded-full text-xs font-semibold">
                    <Users className="w-3 h-3" />
                    {allDTRTs.length} RT{allDTRTs.length !== 1 ? 's' : ''}
                  </span>
                </div>
              </button>

              {/* RT rows */}
              <AnimatePresence initial={false}>
                {expanded && (
                  <motion.div
                    key="rt-list"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.18, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    {dtRTs.length === 0 ? (
                      <div className="pl-20 pr-5 py-3 text-sm text-gray-400 bg-gray-50/60 border-t border-gray-100">
                        No retailers under this distributor
                        {searchTerm ? ' (filtered)' : ''}
                      </div>
                    ) : (
                      dtRTs.map((rt, rIdx) => (
                        <div
                          key={rt.id}
                          className="flex items-center gap-3 pl-5 pr-5 py-2.5 bg-gray-50/60 border-t border-gray-100 hover:bg-gray-100/60 transition-colors"
                        >
                          {/* Indent tree lines */}
                          <div className="w-4 flex-shrink-0" />
                          <div className="w-4 flex-shrink-0 flex items-center justify-center">
                            <div
                              className={`w-3.5 border-l-2 border-b-2 border-gray-200 rounded-bl-sm ${
                                rIdx === dtRTs.length - 1 ? 'h-3.5' : 'h-3.5'
                              }`}
                            />
                          </div>
                          <div className="w-4 flex-shrink-0" />

                          {/* RT icon */}
                          <div className="w-6 h-6 rounded-md bg-purple-100 flex items-center justify-center flex-shrink-0">
                            <Users className="w-3 h-3 text-purple-600" />
                          </div>

                          {/* RT info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm text-gray-800 font-medium">{rt.name}</span>
                              <StatusBadge status={rt.status} />
                            </div>
                            <p className="text-xs text-gray-400 truncate">
                              {rt.partner_id} &nbsp;·&nbsp; {rt.email}
                              {rt.phone ? ` · ${rt.phone}` : ''}
                            </p>
                          </div>

                          {/* Member since */}
                          {rt.created_at && (
                            <div className="flex-shrink-0 text-xs text-gray-400">
                              {new Date(rt.created_at).toLocaleDateString('en-IN', {
                                day: '2-digit', month: 'short', year: 'numeric'
                              })}
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}

        {/* Unassigned retailers section */}
        {unassignedRetailers.length > 0 && (
          <div className="border-t-2 border-dashed border-orange-200">
            <div className="flex items-center gap-3 px-5 py-3.5 bg-orange-50/60">
              <div className="w-4 h-4 flex-shrink-0" />
              <div className="w-4 flex-shrink-0" />
              <div className="w-7 h-7 rounded-lg bg-orange-100 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-orange-700">
                  Unassigned Retailers ({unassignedRetailers.length})
                </p>
                <p className="text-xs text-orange-400">Not linked to any distributor</p>
              </div>
            </div>
            {unassignedRetailers.map((rt) => (
              <div
                key={rt.id}
                className="flex items-center gap-3 pl-5 pr-5 py-2.5 bg-orange-50/30 border-t border-orange-100"
              >
                <div className="w-4 flex-shrink-0" />
                <div className="w-4 flex-shrink-0" />
                <div className="w-4 flex-shrink-0" />
                <div className="w-6 h-6 rounded-md bg-orange-100 flex items-center justify-center flex-shrink-0">
                  <Users className="w-3 h-3 text-orange-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-gray-800 font-medium">{rt.name}</span>
                    <StatusBadge status={rt.status} />
                  </div>
                  <p className="text-xs text-gray-400 truncate">
                    {rt.partner_id} &nbsp;·&nbsp; {rt.email}
                  </p>
                </div>
                {rt.created_at && (
                  <div className="flex-shrink-0 text-xs text-gray-400">
                    {new Date(rt.created_at).toLocaleDateString('en-IN', {
                      day: '2-digit', month: 'short', year: 'numeric'
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
