'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { apiFetch } from '@/lib/api-client'
import { Wallet, RefreshCw, Landmark, Fingerprint, Plug, Eye, EyeOff, Users, Search } from 'lucide-react'

type RoleBreakdown = {
  retailer: number
  distributor: number
  master_distributor: number
  partner: number
  total: number
  wallet_count: number
}

type CumulativeBalances = {
  primary: RoleBreakdown
  aeps: RoleBreakdown
  partner_api: { total: number; wallet_count: number }
  grand_total: number
  generated_at: string
}

type UserBalance = {
  user_id: string
  name: string | null
  business_name: string | null
  primary: number
  aeps: number
  api: number
  total: number
}

type RoleKey = 'retailer' | 'distributor' | 'master_distributor' | 'partner'

const ROLE_OPTIONS: { key: RoleKey; label: string }[] = [
  { key: 'retailer', label: 'Retailers' },
  { key: 'distributor', label: 'Distributors' },
  { key: 'master_distributor', label: 'Master Distributors' },
  { key: 'partner', label: 'Partners' },
]

export default function AdminCumulativeWalletBalances({
  balancesVisible,
  onToggleVisible,
}: {
  balancesVisible: boolean
  onToggleVisible?: () => void
}) {
  const [data, setData] = useState<CumulativeBalances | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchBalances = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/admin/wallet/cumulative-balances', { timeout: 30000 })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Failed to load balances')
      setData(json)
    } catch (e: any) {
      setError(e.message || 'Failed to load cumulative balances')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBalances()
  }, [fetchBalances])

  const fmt = (n: number | null | undefined) =>
    balancesVisible
      ? `₹${(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : '₹ • • • • •'

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.25 }}
      className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 rounded-2xl p-5 shadow-2xl border border-slate-800"
    >
      <div className="pointer-events-none absolute -top-16 -left-16 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 -right-20 w-72 h-72 bg-sky-500/10 rounded-full blur-3xl" />

      <div className="relative flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-emerald-500 via-teal-600 to-sky-600 rounded-xl shadow-lg shadow-teal-500/30">
            <Wallet className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-bold bg-gradient-to-r from-white via-emerald-100 to-sky-200 bg-clip-text text-transparent">
              Cumulative Wallet Balances
            </h3>
            <p className="text-[11px] text-slate-400">
              Total user funds held across the platform (liability view)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/70 border border-slate-700">
            <span className="text-[10px] uppercase tracking-wider text-slate-400">System total</span>
            <span className="text-sm font-bold bg-gradient-to-r from-emerald-300 to-sky-300 bg-clip-text text-transparent tabular-nums">
              {loading ? '…' : fmt(data?.grand_total)}
            </span>
          </div>
          {onToggleVisible && (
            <button
              onClick={onToggleVisible}
              title={balancesVisible ? 'Hide balances' : 'Show balances'}
              className="flex items-center justify-center w-9 h-9 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition-all"
            >
              {balancesVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
          )}
          <button
            onClick={fetchBalances}
            disabled={loading}
            className="flex items-center gap-2 px-3 h-9 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg text-xs font-semibold transition-all shadow-md shadow-emerald-500/30 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="relative mb-3 p-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="relative grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <BalanceCard
          icon={<Landmark className="w-4 h-4 text-white" />}
          iconBg="from-emerald-500 to-teal-600"
          title="Total Primary Wallet"
          subtitle={`${data?.primary.wallet_count ?? 0} wallets`}
          total={loading ? null : data?.primary.total ?? 0}
          rows={[
            { label: 'Retailers (RT)', value: data?.primary.retailer },
            { label: 'Distributors (DT)', value: data?.primary.distributor },
            { label: 'Master Distributors (MD)', value: data?.primary.master_distributor },
            { label: 'Partners', value: data?.primary.partner },
          ]}
          fmt={fmt}
          loading={loading}
        />
        <BalanceCard
          icon={<Fingerprint className="w-4 h-4 text-white" />}
          iconBg="from-amber-500 to-orange-600"
          title="Total AEPS Wallet"
          subtitle={`${data?.aeps.wallet_count ?? 0} wallets`}
          total={loading ? null : data?.aeps.total ?? 0}
          rows={[
            { label: 'Retailers (RT)', value: data?.aeps.retailer },
            { label: 'Distributors (DT)', value: data?.aeps.distributor },
            { label: 'Master Distributors (MD)', value: data?.aeps.master_distributor },
            { label: 'Partners', value: data?.aeps.partner },
          ]}
          fmt={fmt}
          loading={loading}
        />
        <BalanceCard
          icon={<Plug className="w-4 h-4 text-white" />}
          iconBg="from-sky-500 to-indigo-600"
          title="API Partner Wallets"
          subtitle={`${data?.partner_api.wallet_count ?? 0} partners · separate wallet system`}
          total={loading ? null : data?.partner_api.total ?? 0}
          rows={[]}
          fmt={fmt}
          loading={loading}
        />
      </div>

      <UserBalancesSection fmt={fmt} />

      {data && (
        <p className="relative mt-3 text-[10px] text-slate-500 text-right">
          As of {new Date(data.generated_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
        </p>
      )}
    </motion.div>
  )
}

function UserBalancesSection({ fmt }: { fmt: (n: number | null | undefined) => string }) {
  const [role, setRole] = useState<RoleKey>('retailer')
  const [users, setUsers] = useState<UserBalance[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await apiFetch(`/api/admin/wallet/cumulative-balances/users?role=${role}`, {
          timeout: 60000,
        })
        const json = await res.json()
        if (!res.ok || !json.success) throw new Error(json.error || 'Failed to load user balances')
        if (!cancelled) setUsers(json.users || [])
      } catch (e: any) {
        if (!cancelled) {
          setUsers([])
          setError(e.message || 'Failed to load user balances')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [role])

  const isPartner = role === 'partner'
  const q = search.trim().toLowerCase()
  const filtered = q
    ? users.filter(
        (u) =>
          (u.name || '').toLowerCase().includes(q) ||
          (u.business_name || '').toLowerCase().includes(q) ||
          u.user_id.toLowerCase().includes(q)
      )
    : users

  return (
    <div className="relative mt-4 rounded-xl bg-slate-900/70 border border-slate-800 backdrop-blur-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 shadow">
            <Users className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-100">User-wise Balances</p>
            <p className="text-[10px] text-slate-400">
              {loading ? 'Loading…' : `${filtered.length} of ${users.length} users`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg bg-slate-800/70 border border-slate-700 p-0.5">
            {ROLE_OPTIONS.map((r) => (
              <button
                key={r.key}
                onClick={() => setRole(r.key)}
                className={`px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-all ${
                  role === r.key
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name / ID…"
              className="w-44 pl-8 pr-2.5 py-1.5 rounded-lg bg-slate-800/70 border border-slate-700 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-600"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-4 mb-3 p-2.5 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-xs">
          {error}
        </div>
      )}

      <div className="max-h-80 overflow-y-auto overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-900 z-10">
            <tr className="text-slate-400 border-y border-slate-800">
              <th className="text-left font-medium px-4 py-2">#</th>
              <th className="text-left font-medium px-2 py-2">Name</th>
              {isPartner ? (
                <th className="text-right font-medium px-2 py-2">API Wallet</th>
              ) : (
                <>
                  <th className="text-right font-medium px-2 py-2">Primary</th>
                  <th className="text-right font-medium px-2 py-2">AEPS</th>
                </>
              )}
              <th className="text-right font-medium px-4 py-2">Total</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={isPartner ? 4 : 5} className="px-4 py-6 text-center text-slate-500">
                  Loading balances…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={isPartner ? 4 : 5} className="px-4 py-6 text-center text-slate-500">
                  No users found
                </td>
              </tr>
            ) : (
              filtered.map((u, i) => (
                <tr
                  key={u.user_id}
                  className="border-b border-slate-800/60 hover:bg-slate-800/40 transition-colors"
                >
                  <td className="px-4 py-2 text-slate-500">{i + 1}</td>
                  <td className="px-2 py-2">
                    <p className="font-medium text-slate-200">
                      {u.name || u.business_name || 'Unknown'}
                    </p>
                    <p className="text-[10px] text-slate-500 font-mono">{u.user_id}</p>
                  </td>
                  {isPartner ? (
                    <td className="px-2 py-2 text-right tabular-nums text-slate-300">
                      {fmt(u.api)}
                    </td>
                  ) : (
                    <>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-300">
                        {fmt(u.primary)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-300">
                        {fmt(u.aeps)}
                      </td>
                    </>
                  )}
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-white">
                    {fmt(u.total)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {!loading && filtered.length > 0 && (
            <tfoot className="sticky bottom-0 bg-slate-900">
              <tr className="border-t border-slate-700 text-slate-100 font-semibold">
                <td className="px-4 py-2" />
                <td className="px-2 py-2">Total ({filtered.length})</td>
                {isPartner ? (
                  <td className="px-2 py-2 text-right tabular-nums">
                    {fmt(filtered.reduce((s, u) => s + u.api, 0))}
                  </td>
                ) : (
                  <>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {fmt(filtered.reduce((s, u) => s + u.primary, 0))}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {fmt(filtered.reduce((s, u) => s + u.aeps, 0))}
                    </td>
                  </>
                )}
                <td className="px-4 py-2 text-right tabular-nums">
                  {fmt(filtered.reduce((s, u) => s + u.total, 0))}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

function BalanceCard({
  icon,
  iconBg,
  title,
  subtitle,
  total,
  rows,
  fmt,
  loading,
}: {
  icon: React.ReactNode
  iconBg: string
  title: string
  subtitle: string
  total: number | null
  rows: { label: string; value: number | undefined }[]
  fmt: (n: number | null | undefined) => string
  loading: boolean
}) {
  return (
    <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-4 backdrop-blur-sm">
      <div className="flex items-center gap-2.5 mb-3">
        <div className={`p-2 rounded-lg bg-gradient-to-br ${iconBg} shadow`}>{icon}</div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-100 truncate">{title}</p>
          <p className="text-[10px] text-slate-400 truncate">{subtitle}</p>
        </div>
      </div>
      <p className="text-2xl font-bold text-white tabular-nums mb-3">
        {loading || total === null ? '…' : fmt(total)}
      </p>
      {rows.length > 0 && (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex items-center justify-between text-xs bg-slate-800/60 rounded-lg px-2.5 py-1.5"
            >
              <span className="text-slate-400">{r.label}</span>
              <span className="font-semibold text-slate-100 tabular-nums">
                {loading ? '…' : fmt(r.value ?? 0)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
