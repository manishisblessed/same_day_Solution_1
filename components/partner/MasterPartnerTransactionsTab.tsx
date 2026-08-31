'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'
import {
  Receipt, RefreshCw, IndianRupee, Wallet, TrendingUp, ChevronLeft, ChevronRight,
} from 'lucide-react'

interface TxnRow {
  id: string
  txn_id: string
  created_at: string
  amount: number
  payment_mode?: string | null
  status?: string | null
  merchant_slug?: string | null
  partner_id: string
  partner_name: string
  commission_net: number | null
  commission_tds: number | null
  commission_credited: boolean
}

interface Summary {
  count: number
  grossVolume: number
  commissionNet: number
  tdsTotal: number
  creditedCount: number
}

const money = (n: number) =>
  `₹${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const dt = (s: string) => new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

const PAGE = 50

export default function MasterPartnerTransactionsTab() {
  const today = new Date().toISOString().slice(0, 10)
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const [startDate, setStartDate] = useState(monthAgo)
  const [endDate, setEndDate] = useState(today)
  const [partnerId, setPartnerId] = useState('')
  const [partners, setPartners] = useState<{ id: string; name: string }[]>([])

  const [rows, setRows] = useState<TxnRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Child partner list for the filter dropdown.
  useEffect(() => {
    apiFetch('/api/master-partner/schemes')
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setPartners((res.data.partners || []).map((p: any) => ({ id: p.partner_id, name: p.name })))
      })
      .catch(() => {})
  }, [])

  const load = useCallback((newOffset: number) => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
      limit: String(PAGE),
      offset: String(newOffset),
    })
    if (partnerId) params.set('partner_id', partnerId)
    apiFetch(`/api/master-partner/transactions?${params.toString()}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) {
          setRows(res.data.transactions || [])
          setSummary(res.data.summary || null)
          setTotal(res.data.total || 0)
          setOffset(newOffset)
        } else setError(res.error || 'Failed to load transactions')
      })
      .catch(() => setError('Failed to load transactions'))
      .finally(() => setLoading(false))
  }, [startDate, endDate, partnerId])

  useEffect(() => { load(0) }, [load])

  const pageStart = total === 0 ? 0 : offset + 1
  const pageEnd = Math.min(offset + PAGE, total)

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Receipt className="w-5 h-5 text-purple-600" /> Partner Transactions
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Every POS transaction under your partners and the commission you earned on each.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)}
            className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-white max-w-[180px]">
            <option value="">All partners</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input type="date" value={startDate} max={endDate} onChange={(e) => setStartDate(e.target.value)}
            className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-white" />
          <span className="text-gray-400">–</span>
          <input type="date" value={endDate} min={startDate} max={today} onChange={(e) => setEndDate(e.target.value)}
            className="px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 dark:text-white" />
          <button onClick={() => load(0)} className="p-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700" title="Refresh">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 border border-red-200 text-sm">{error}</div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card icon={TrendingUp} label="Transactions" value={String(summary?.count ?? 0)} color="blue" />
        <Card icon={IndianRupee} label="POS Volume" value={money(summary?.grossVolume ?? 0)} color="amber" />
        <Card icon={Wallet} label="Commission (net)" value={money(summary?.commissionNet ?? 0)} color="emerald" />
        <Card icon={Receipt} label="TDS Withheld" value={money(summary?.tdsTotal ?? 0)} color="pink" />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 overflow-x-auto">
        {loading ? (
          <div className="space-y-2 animate-pulse">
            {[...Array(6)].map((_, i) => <div key={i} className="h-8 bg-gray-100 dark:bg-gray-700 rounded" />)}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">No transactions in this period.</p>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200 dark:border-gray-700">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 px-3 font-medium">Partner</th>
                  <th className="py-2 px-3 font-medium">Txn</th>
                  <th className="py-2 px-3 font-medium text-right">Amount</th>
                  <th className="py-2 px-3 font-medium text-right">Commission</th>
                  <th className="py-2 px-3 font-medium text-right">TDS</th>
                  <th className="py-2 pl-3 font-medium text-center">Credited</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100 dark:border-gray-700 last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap text-gray-600 dark:text-gray-300">{dt(r.created_at)}</td>
                    <td className="py-2 px-3">
                      <div className="font-medium text-gray-800 dark:text-gray-200">{r.partner_name}</div>
                      {r.merchant_slug ? <div className="text-xs text-gray-400">{r.merchant_slug}</div> : null}
                    </td>
                    <td className="py-2 px-3">
                      <div className="text-xs text-gray-500 font-mono">{r.txn_id}</div>
                      <div className="text-xs text-gray-400">{r.payment_mode || ''} · {r.status || ''}</div>
                    </td>
                    <td className="py-2 px-3 text-right text-gray-800 dark:text-gray-200">{money(r.amount)}</td>
                    <td className="py-2 px-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                      {r.commission_net != null ? money(r.commission_net) : '—'}
                    </td>
                    <td className="py-2 px-3 text-right text-gray-500">
                      {r.commission_tds != null ? money(r.commission_tds) : '—'}
                    </td>
                    <td className="py-2 pl-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${
                        r.commission_credited ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                      }`}>{r.commission_credited ? 'Yes' : 'Pending'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex items-center justify-between mt-3 text-sm text-gray-500">
              <span>{pageStart}–{pageEnd} of {total}</span>
              <div className="flex items-center gap-1">
                <button disabled={offset === 0 || loading} onClick={() => load(Math.max(0, offset - PAGE))}
                  className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button disabled={offset + PAGE >= total || loading} onClick={() => load(offset + PAGE)}
                  className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Card({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
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
