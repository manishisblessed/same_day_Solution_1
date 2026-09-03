'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api-client'

interface Row {
  user_id: string
  user_role: string
  name: string
  opening: number
  push: number
  pull: number
  credit: number
  debit: number
  commission: number
  closing: number
  reconDelta: number
  txnCount: number
}

interface Totals {
  opening: number
  push: number
  pull: number
  credit: number
  debit: number
  commission: number
  closing: number
  reconDelta: number
  users: number
}

const inr = (n: number) =>
  `₹${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const ROLE_LABEL: Record<string, string> = {
  retailer: 'RT',
  distributor: 'DT',
  master_distributor: 'MD',
  partner: 'PT',
  master_partner: 'MP',
}

function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

/**
 * Daily report: opening / push / pull / credit / debit / commission / closing
 * per user for a selected day, scoped to the caller's visibility server-side.
 */
export default function DailyReport() {
  const [date, setDate] = useState(todayIST())
  const [role, setRole] = useState('')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const params = new URLSearchParams({ date })
      if (role) params.set('role', role)
      if (q) params.set('q', q)
      const res = await apiFetch(`/api/reports/daily?${params.toString()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load report')
      setRows(data.rows || [])
      setTotals(data.totals || null)
    } catch (e: any) {
      setErr(e.message)
      setRows([])
      setTotals(null)
    } finally {
      setLoading(false)
    }
  }, [date, role, q])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, role])

  async function exportCsv() {
    const params = new URLSearchParams({ date, format: 'csv' })
    if (role) params.set('role', role)
    if (q) params.set('q', q)
    const res = await apiFetch(`/api/reports/daily?${params.toString()}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `daily-report-${date}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const kpis = totals
    ? [
        { label: 'Opening', value: totals.opening, color: 'text-gray-700' },
        { label: 'Push', value: totals.push, color: 'text-green-600' },
        { label: 'Pull', value: totals.pull, color: 'text-red-600' },
        { label: 'Credit', value: totals.credit, color: 'text-green-700' },
        { label: 'Debit', value: totals.debit, color: 'text-red-700' },
        { label: 'Commission', value: totals.commission, color: 'text-indigo-600' },
        { label: 'Closing', value: totals.closing, color: 'text-gray-900' },
      ]
    : []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 shadow ring-1 ring-gray-100">
        <div>
          <label className="block text-xs font-medium text-gray-500">Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500">Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value)} className="mt-1 rounded-lg border border-gray-300 px-3 py-2 text-sm">
            <option value="">All</option>
            <option value="master_partner">Master Partner</option>
            <option value="partner">Partner</option>
            <option value="master_distributor">Master Distributor</option>
            <option value="distributor">Distributor</option>
            <option value="retailer">Retailer</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-500">Search</label>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            placeholder="Name or ID"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <button onClick={load} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
          Apply
        </button>
        <button onClick={exportCsv} className="rounded-lg border border-indigo-600 px-4 py-2 text-sm font-semibold text-indigo-600 hover:bg-indigo-50">
          Export CSV
        </button>
      </div>

      {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      {totals && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-xl bg-white p-3 shadow ring-1 ring-gray-100">
              <p className="text-xs text-gray-400">{k.label}</p>
              <p className={`mt-1 text-sm font-bold ${k.color}`}>{inr(k.value)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl bg-white p-4 shadow ring-1 ring-gray-100">
        {loading ? (
          <p className="py-8 text-center text-sm text-gray-400">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">No activity for this day.</p>
        ) : (
          <table className="w-full text-right text-sm">
            <thead>
              <tr className="border-b text-xs uppercase text-gray-400">
                <th className="py-2 text-left">User</th>
                <th className="py-2">Opening</th>
                <th className="py-2">Push</th>
                <th className="py-2">Pull</th>
                <th className="py-2">Credit</th>
                <th className="py-2">Debit</th>
                <th className="py-2">Comm.</th>
                <th className="py-2">Closing</th>
                <th className="py-2">Δ</th>
                <th className="py-2">Txns</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-2 text-left">
                    <span className="font-medium text-gray-800">{r.name}</span>
                    <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                      {ROLE_LABEL[r.user_role] || r.user_role}
                    </span>
                    <div className="text-[10px] text-gray-400">{r.user_id}</div>
                  </td>
                  <td className="py-2 text-gray-600">{inr(r.opening)}</td>
                  <td className="py-2 text-green-600">{inr(r.push)}</td>
                  <td className="py-2 text-red-600">{inr(r.pull)}</td>
                  <td className="py-2 text-green-700">{inr(r.credit)}</td>
                  <td className="py-2 text-red-700">{inr(r.debit)}</td>
                  <td className="py-2 text-indigo-600">{inr(r.commission)}</td>
                  <td className="py-2 font-semibold text-gray-900">{inr(r.closing)}</td>
                  <td className={`py-2 ${Math.abs(r.reconDelta) > 0.01 ? 'text-amber-600' : 'text-gray-300'}`}>
                    {r.reconDelta.toFixed(2)}
                  </td>
                  <td className="py-2 text-gray-500">{r.txnCount}</td>
                </tr>
              ))}
            </tbody>
            {totals && (
              <tfoot>
                <tr className="border-t-2 font-bold text-gray-800">
                  <td className="py-2 text-left">Totals ({totals.users})</td>
                  <td className="py-2">{inr(totals.opening)}</td>
                  <td className="py-2 text-green-600">{inr(totals.push)}</td>
                  <td className="py-2 text-red-600">{inr(totals.pull)}</td>
                  <td className="py-2 text-green-700">{inr(totals.credit)}</td>
                  <td className="py-2 text-red-700">{inr(totals.debit)}</td>
                  <td className="py-2 text-indigo-600">{inr(totals.commission)}</td>
                  <td className="py-2">{inr(totals.closing)}</td>
                  <td className="py-2">{totals.reconDelta.toFixed(2)}</td>
                  <td className="py-2" />
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
    </div>
  )
}
