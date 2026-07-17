'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { apiFetch } from '@/lib/api-client'
import { User, X, Loader2, Users, ChevronDown, Check, Handshake, Crown, Network, Store, Globe } from 'lucide-react'

export interface NetworkFilterValue {
  user_id?: string
  distributor_id?: string
  md_id?: string
  partner_id?: string
}

interface Option {
  id: string
  name: string
}

interface SearchUser {
  id: string
  name: string
  business_name: string | null
  role: string
  status: string | null
}

interface Props {
  userRole: string
  onChange: (value: NetworkFilterValue | null) => void
}

type AdminRole = 'all' | 'partner' | 'master_distributor' | 'distributor' | 'retailer'

const ADMIN_ROLES: { value: AdminRole; label: string; icon: any; activeCls: string }[] = [
  { value: 'all', label: 'All Users', icon: Globe, activeCls: 'bg-gray-800 text-white border-gray-800 dark:bg-gray-200 dark:text-gray-900 dark:border-gray-200' },
  { value: 'partner', label: 'Partner', icon: Handshake, activeCls: 'bg-purple-600 text-white border-purple-600' },
  { value: 'master_distributor', label: 'MD', icon: Crown, activeCls: 'bg-amber-500 text-white border-amber-500' },
  { value: 'distributor', label: 'DT', icon: Network, activeCls: 'bg-blue-600 text-white border-blue-600' },
  { value: 'retailer', label: 'RT', icon: Store, activeCls: 'bg-emerald-600 text-white border-emerald-600' },
]

const ROLE_BADGE: Record<string, string> = {
  partner: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  master_distributor: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  distributor: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  retailer: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
}

const ROLE_LABELS: Record<string, string> = {
  retailer: 'Retailer',
  distributor: 'Distributor',
  master_distributor: 'Master Distributor',
  partner: 'Partner',
}

export default function NetworkUserFilter({ userRole, onChange }: Props) {
  const isAdmin = userRole === 'admin' || userRole === 'finance_executive'
  const isDT = userRole === 'distributor'
  const isMD = userRole === 'master_distributor'

  // ── Admin state ──
  const [adminRole, setAdminRole] = useState<AdminRole>('all')
  const [roleUsers, setRoleUsers] = useState<SearchUser[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [selected, setSelected] = useState<SearchUser | null>(null)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [filterText, setFilterText] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)

  // ── DT/MD state ──
  const [retailers, setRetailers] = useState<Option[]>([])
  const [distributors, setDistributors] = useState<Option[]>([])
  const [selDistributor, setSelDistributor] = useState('')
  const [selRetailer, setSelRetailer] = useState('')

  useEffect(() => {
    if (!isDT && !isMD) return
    apiFetch('/api/pos/filter-options')
      .then(r => r.json())
      .then(d => {
        setRetailers(d.retailers || [])
        setDistributors(d.distributors || [])
      })
      .catch(() => {})
  }, [isDT, isMD])

  // Load the user list whenever the admin picks a role
  useEffect(() => {
    if (!isAdmin || adminRole === 'all') {
      setRoleUsers([])
      return
    }
    let cancelled = false
    setLoadingUsers(true)
    apiFetch(`/api/admin/users/search?all=1&roles=${adminRole}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setRoleUsers(d.results || []) })
      .catch(() => { if (!cancelled) setRoleUsers([]) })
      .finally(() => { if (!cancelled) setLoadingUsers(false) })
    return () => { cancelled = true }
  }, [isAdmin, adminRole])

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const filteredUsers = useMemo(() => {
    const t = filterText.trim().toLowerCase()
    if (!t) return roleUsers
    return roleUsers.filter(u =>
      u.name.toLowerCase().includes(t) ||
      (u.business_name || '').toLowerCase().includes(t) ||
      u.id.toLowerCase().includes(t)
    )
  }, [roleUsers, filterText])

  const emit = (u: SearchUser | null) => {
    if (!u) { onChange(null); return }
    if (u.role === 'retailer') onChange({ user_id: u.id })
    else if (u.role === 'distributor') onChange({ distributor_id: u.id })
    else if (u.role === 'master_distributor') onChange({ md_id: u.id })
    else if (u.role === 'partner') onChange({ partner_id: u.id })
  }

  const pickRole = (r: AdminRole) => {
    setAdminRole(r)
    setSelected(null)
    setFilterText('')
    setDropdownOpen(false)
    onChange(null)
  }

  const pickUser = (u: SearchUser) => {
    setSelected(u)
    setDropdownOpen(false)
    setFilterText('')
    emit(u)
  }

  const clearUser = () => {
    setSelected(null)
    emit(null)
  }

  // ── Admin / Finance: role pills + user dropdown ──
  if (isAdmin) {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">View Report For</label>
        <div className="flex flex-wrap items-center gap-2">
          {/* Role pills */}
          <div className="flex items-center gap-1 p-1 bg-gray-100 dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700">
            {ADMIN_ROLES.map(r => {
              const Icon = r.icon
              const active = adminRole === r.value
              return (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => pickRole(r.value)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${
                    active
                      ? `${r.activeCls} shadow-sm`
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-800 hover:text-gray-800 dark:hover:text-gray-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {r.label}
                </button>
              )
            })}
          </div>

          {/* User select (visible once a role is chosen) */}
          {adminRole !== 'all' && (
            <div className="relative min-w-[260px]" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setDropdownOpen(o => !o)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm transition-colors ${
                  selected
                    ? 'border-indigo-400 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20'
                    : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                <User className="w-4 h-4 text-gray-400 shrink-0" />
                {selected ? (
                  <>
                    <span className="truncate font-medium text-gray-900 dark:text-white">{selected.business_name || selected.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${ROLE_BADGE[selected.role] || ''}`}>
                      {selected.id}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); clearUser() }}
                      className="ml-auto p-0.5 rounded hover:bg-indigo-100 dark:hover:bg-indigo-800 cursor-pointer"
                    >
                      <X className="w-4 h-4 text-gray-500" />
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-gray-500 dark:text-gray-400">
                      {loadingUsers ? 'Loading users…' : `All ${ROLE_LABELS[adminRole]}s — select one`}
                    </span>
                    {loadingUsers
                      ? <Loader2 className="ml-auto w-4 h-4 text-gray-400 animate-spin" />
                      : <ChevronDown className={`ml-auto w-4 h-4 text-gray-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />}
                  </>
                )}
              </button>

              {dropdownOpen && (
                <div className="absolute z-30 mt-1.5 w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-2xl overflow-hidden">
                  <div className="p-2 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                    <input
                      type="text"
                      autoFocus
                      value={filterText}
                      onChange={e => setFilterText(e.target.value)}
                      placeholder={`Filter ${roleUsers.length} ${ROLE_LABELS[adminRole].toLowerCase()}s…`}
                      className="w-full px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {loadingUsers ? (
                      <div className="flex items-center gap-2 px-3 py-4 text-sm text-gray-500">
                        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                      </div>
                    ) : filteredUsers.length === 0 ? (
                      <div className="px-3 py-4 text-sm text-gray-500 text-center">No users found</div>
                    ) : (
                      filteredUsers.map(u => {
                        const isSel = selected?.id === u.id
                        return (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => pickUser(u)}
                            className={`w-full flex items-center gap-2.5 text-left px-3 py-2.5 border-b border-gray-50 dark:border-gray-700/50 last:border-0 transition-colors ${
                              isSel ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                            }`}
                          >
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${ROLE_BADGE[u.role] || 'bg-gray-100 text-gray-600'}`}>
                              {(u.business_name || u.name).slice(0, 1).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{u.business_name || u.name}</p>
                              <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                                {u.id}{u.status && u.status !== 'active' ? ` · ${u.status}` : ''}
                              </p>
                            </div>
                            {isSel && <Check className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />}
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  const handleDistributor = (dist: string) => {
    setSelDistributor(dist)
    setSelRetailer('')
    if (dist) onChange({ distributor_id: dist })
    else onChange(null)
  }

  const handleRetailer = (ret: string) => {
    setSelRetailer(ret)
    if (ret) onChange({ user_id: ret })
    else if (selDistributor) onChange({ distributor_id: selDistributor })
    else onChange(null)
  }

  // ── Distributor: retailer dropdown ──
  if (isDT) {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Filter by Retailer</label>
        <div className="relative">
          <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <select
            value={selRetailer}
            onChange={(e) => handleRetailer(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
          >
            <option value="">All Retailers</option>
            {retailers.map((r) => (
              <option key={r.id} value={r.id}>{r.name} ({r.id})</option>
            ))}
          </select>
        </div>
      </div>
    )
  }

  // ── Master Distributor: distributor + retailer dropdowns ──
  if (isMD) {
    return (
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Filter by Distributor</label>
          <div className="relative">
            <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <select
              value={selDistributor}
              onChange={(e) => handleDistributor(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
            >
              <option value="">All Distributors</option>
              {distributors.map((d) => (
                <option key={d.id} value={d.id}>{d.name} ({d.id})</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Filter by Retailer</label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <select
              value={selRetailer}
              onChange={(e) => handleRetailer(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-900 dark:text-white"
            >
              <option value="">All Retailers</option>
              {retailers.map((r) => (
                <option key={r.id} value={r.id}>{r.name} ({r.id})</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    )
  }

  return null
}
