'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import {
  Users2, Activity, TrendingUp, IndianRupee, RefreshCw, Wallet,
} from 'lucide-react'

interface MemberRow {
  partner_id: string
  name: string
  email?: string
  phone?: string
  status?: string
  transactionCount: number
  posCount: number
  posGross: number
  credit: number
  debit: number
  isActive: boolean
}

interface ServiceRow {
  type: string
  count: number
  credit: number
  debit: number
}

interface ReportData {
  summary: {
    totalMembers: number
    activeMembers: number
    totalTransactions: number
    totalPosGross: number
    totalOverrideEarned: number
  }
  memberWise: MemberRow[]
  serviceBreakdown: ServiceRow[]
}

const money = (n: number) =>
  `₹${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const SERVICE_LABELS: Record<string, string> = {
  pos: 'POS',
  pos_master_override: 'MCP Override',
  bbps: 'BBPS',
  payout: 'Payout / Settlement',
  settlement: 'Settlement',
  aeps: 'AEPS',
  rechargekit: 'Credit Card',
  unknown: 'Other',
}
const serviceLabel = (t: string) => SERVICE_LABELS[t] || t.replace(/_/g, ' ')

export default function MasterPartnerReportTab() {
  const today = new Date().toISOString().slice(0, 10)
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const [startDate, setStartDate] = useState(monthAgo)
  const [endDate, setEndDate] = useState(today)
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    apiFetch(`/api/master-partner/reports?start_date=${startDate}&end_date=${endDate}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setData(res.data)
        else setError(res.error || 'Failed to load report')
      })
      .catch(() => setError('Failed to load report'))
      .finally(() => setLoading(false))
  }, [startDate, endDate])

  useEffect(() => { load() }, [load])

  const s = data?.summary

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Users2 className="w-5 h-5 text-purple-600" /> My Partners — Reports
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Read-only performance of partners onboarded under you. Commission is earned on POS transactions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)}
            className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-white" />
          <span className="text-gray-400">–</span>
          <input type="date" value={endDate} min={startDate} max={today} onChange={(e) => setEndDate(e.target.value)}
            className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-white" />
          <button onClick={load} className="p-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700" title="Refresh">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 border border-red-200 text-sm">{error}</div>
      )}

      {/* Summary widgets */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <SummaryCard icon={Users2} label="Total Partners" value={String(s?.totalMembers ?? 0)} color="purple" />
        <SummaryCard icon={Activity} label="Active Partners" value={String(s?.activeMembers ?? 0)} color="blue" />
        <SummaryCard icon={TrendingUp} label="Total Transactions" value={String(s?.totalTransactions ?? 0)} color="emerald" />
        <SummaryCard icon={IndianRupee} label="POS Volume" value={money(s?.totalPosGross ?? 0)} color="amber" />
        <SummaryCard icon={Wallet} label="Commission Earned" value={money(s?.totalOverrideEarned ?? 0)} color="pink" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Service-wise breakdown */}
        <div className="lg:col-span-1 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Service-wise Breakdown</h3>
          {loading ? (
            <SkeletonRows />
          ) : (data?.serviceBreakdown?.length ?? 0) === 0 ? (
            <p className="text-sm text-gray-400">No activity in this period.</p>
          ) : (
            <div className="space-y-2">
              {data!.serviceBreakdown.map((row) => (
                <div key={row.type} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-100 dark:border-gray-700 last:border-0">
                  <span className="font-medium text-gray-700 dark:text-gray-300 capitalize">{serviceLabel(row.type)}</span>
                  <span className="text-gray-500">{row.count} txn · {money(row.credit)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Member-wise table */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 overflow-x-auto">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-3">Partner-wise Details</h3>
          {loading ? (
            <SkeletonRows />
          ) : (data?.memberWise?.length ?? 0) === 0 ? (
            <p className="text-sm text-gray-400">No partners onboarded yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-2 pr-3 font-medium">Partner</th>
                  <th className="py-2 px-3 font-medium text-center">Status</th>
                  <th className="py-2 px-3 font-medium text-right">Txns</th>
                  <th className="py-2 px-3 font-medium text-right">POS</th>
                  <th className="py-2 pl-3 font-medium text-right">POS Volume</th>
                </tr>
              </thead>
              <tbody>
                {data!.memberWise.map((m) => (
                  <tr key={m.partner_id} className="border-b border-gray-100 dark:border-gray-700 last:border-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-gray-800 dark:text-gray-200">{m.name}</div>
                      <div className="text-xs text-gray-400">{m.email || m.phone || ''}</div>
                    </td>
                    <td className="py-2 px-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${
                        m.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                      }`}>{m.isActive ? 'Active' : 'Idle'}</span>
                    </td>
                    <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">{m.transactionCount}</td>
                    <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">{m.posCount}</td>
                    <td className="py-2 pl-3 text-right font-medium text-gray-800 dark:text-gray-200">{money(m.posGross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    purple: 'from-purple-500 to-purple-600',
    blue: 'from-blue-500 to-blue-600',
    emerald: 'from-emerald-500 to-emerald-600',
    amber: 'from-amber-500 to-amber-600',
    pink: 'from-pink-500 to-pink-600',
  }
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${colors[color]} flex items-center justify-center mb-2`}>
        <Icon className="w-4 h-4 text-white" />
      </div>
      <div className="text-lg font-bold text-gray-900 dark:text-white truncate">{value}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
    </div>
  )
}

function SkeletonRows() {
  return (
    <div className="space-y-2 animate-pulse">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-6 bg-gray-100 dark:bg-gray-700 rounded" />
      ))}
    </div>
  )
}
