'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import AdminSidebar from '@/components/AdminSidebar'
import {
  RotateCcw, Search, Layers, CheckCircle, XCircle, AlertTriangle, ShieldCheck,
  Download, RefreshCw, Filter, Calendar, ChevronDown, ChevronUp, Activity,
  Wallet, Building2, IndianRupee, ListChecks,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api-client'
import { useToast } from '@/components/Toast'

type TxRow = {
  id: string
  retailer_id: string
  reference_id: string
  order_id: string
  status: string
  status_message?: string
  amount?: number
  charges?: number
  total_debit?: number
  actual_wallet_debit?: number
  utr?: string
  account_holder_name?: string
  account_number?: string
  ifsc_code?: string
  mode?: string
  created_at: string
  updated_at?: string
  refund_amount: number
  target: 'partner' | 'retailer'
  owner_name: string
  refund_state: 'refunded' | 'not_refunded'
}

type SearchStats = {
  total: number
  pending: number
  failed: number
  success: number
  already_refunded: number
  refundable: number
  refundable_amount: number
}

type ItemResult = {
  identifier: string
  found: boolean
  order_id?: string
  reference_id?: string
  beneficiary?: string
  amount?: number
  db_status?: string
  target?: 'partner' | 'retailer' | 'none'
  result: 'refunded' | 'already_refunded' | 'reconciled_success' | 'critical_refund_failed' | 'not_found' | 'error'
  message?: string
}

type RefundSummary = {
  total: number
  refunded: number
  already_refunded: number
  reconciled_success: number
  critical_failed: number
  not_found: number
  total_refunded_amount: number
}

const RESULT_META: Record<ItemResult['result'], { label: string; className: string; Icon: any }> = {
  refunded: { label: 'Refunded', className: 'bg-green-100 text-green-700', Icon: CheckCircle },
  already_refunded: { label: 'Already Refunded', className: 'bg-blue-100 text-blue-700', Icon: ShieldCheck },
  reconciled_success: { label: 'Success (kept)', className: 'bg-amber-100 text-amber-700', Icon: AlertTriangle },
  critical_refund_failed: { label: 'CRITICAL — Failed', className: 'bg-red-100 text-red-700', Icon: XCircle },
  not_found: { label: 'Not Found', className: 'bg-gray-100 text-gray-600', Icon: XCircle },
  error: { label: 'Error', className: 'bg-red-100 text-red-700', Icon: XCircle },
}

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  FAILED: 'bg-red-100 text-red-700',
  SUCCESS: 'bg-green-100 text-green-700',
}

function fmtINR(n?: number) {
  if (n === undefined || n === null) return '—'
  return `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(s?: string) {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function toYMD(d: Date) {
  return d.toISOString().slice(0, 10)
}

export default function AdminCapabilities() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const { showToast } = useToast()

  // Filters
  const [startDate, setStartDate] = useState(() => toYMD(new Date(Date.now() - 30 * 864e5)))
  const [endDate, setEndDate] = useState(() => toYMD(new Date()))
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'FAILED' | 'SUCCESS' | 'REFUNDABLE'>('REFUNDABLE')
  const [searchText, setSearchText] = useState('')

  // Data
  const [rows, setRows] = useState<TxRow[]>([])
  const [stats, setStats] = useState<SearchStats | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [searching, setSearching] = useState(false)
  const [rowStatus, setRowStatus] = useState<Record<string, { provider_status: string; txn_status?: string | null }>>({})
  const [checkingRow, setCheckingRow] = useState<string | null>(null)

  // Options
  const [verifyProvider, setVerifyProvider] = useState(true)

  // Manual entry
  const [showManual, setShowManual] = useState(false)
  const [manualIds, setManualIds] = useState('')

  // Refund result modal
  const [refunding, setRefunding] = useState(false)
  const [results, setResults] = useState<ItemResult[] | null>(null)
  const [summary, setSummary] = useState<RefundSummary | null>(null)
  const [lastWasDryRun, setLastWasDryRun] = useState(false)

  useEffect(() => {
    if (!authLoading && (!user || (user.role !== 'admin' && (user as any).role !== 'finance_executive'))) {
      router.push('/admin/login')
    }
  }, [user, authLoading, router])

  const runSearch = useCallback(async () => {
    setSearching(true)
    setSelected(new Set())
    try {
      const params = new URLSearchParams({
        start: startDate,
        end: endDate,
        status: statusFilter,
        search: searchText.trim(),
        limit: '500',
      })
      const res = await apiFetch(`/api/admin/reversal/shadval-search?${params.toString()}`)
      const data = await res.json()
      if (data.success) {
        setRows(data.transactions || [])
        setStats(data.stats || null)
        setRowStatus({})
        if ((data.transactions || []).length === 0) showToast('No transactions found for these filters', 'info')
      } else {
        showToast(data.error || 'Search failed', 'error')
      }
    } catch {
      showToast('Failed to search transactions', 'error')
    } finally {
      setSearching(false)
    }
  }, [startDate, endDate, statusFilter, searchText, showToast])

  useEffect(() => {
    if (user && (user.role === 'admin' || (user as any).role === 'finance_executive')) runSearch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const preset = (days: number) => {
    setStartDate(toYMD(new Date(Date.now() - days * 864e5)))
    setEndDate(toYMD(new Date()))
  }

  const refundableRows = useMemo(
    () => rows.filter((r) => r.refund_state === 'not_refunded' && r.status !== 'SUCCESS'),
    [rows]
  )

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected])
  const selectedAmount = useMemo(() => selectedRows.reduce((s, r) => s + (r.refund_amount || 0), 0), [selectedRows])

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const selectAllVisible = () =>
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))))
  const selectRefundable = () => setSelected(new Set(refundableRows.map((r) => r.id)))

  const doRefund = async (identifiers: string[], dryRun: boolean) => {
    if (identifiers.length === 0) {
      showToast('Select at least one transaction', 'error')
      return
    }
    if (!dryRun) {
      const ok = window.confirm(
        `Refund ${identifiers.length} transaction(s)?\n\nWallets will be credited. Safe to re-run (never double-credits).`
      )
      if (!ok) return
    }
    setRefunding(true)
    try {
      const res = await apiFetch('/api/admin/reversal/shadval-refund', {
        method: 'POST',
        body: JSON.stringify({ identifiers, dryRun, verifyProvider }),
      })
      const data = await res.json()
      if (data.success) {
        setResults(data.results || [])
        setSummary(data.summary || null)
        setLastWasDryRun(dryRun)
        const s: RefundSummary = data.summary
        if (dryRun) showToast(`Preview: ${s.refunded} to refund · ${s.already_refunded} already done`, 'info')
        else {
          showToast(`Refunded ${s.refunded} · ${fmtINR(s.total_refunded_amount)}`, 'success')
          runSearch()
        }
      } else {
        showToast(data.error || 'Refund failed', 'error')
      }
    } catch {
      showToast('Failed to process refund', 'error')
    } finally {
      setRefunding(false)
    }
  }

  const identifiersFor = (list: TxRow[]) => list.map((r) => r.order_id || r.reference_id).filter(Boolean)
  const parseManual = () => manualIds.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)

  const checkRowStatus = async (r: TxRow) => {
    if (!r.reference_id) return
    setCheckingRow(r.id)
    try {
      const res = await apiFetch(`/api/admin/reversal/shadval-status?reference_id=${encodeURIComponent(r.reference_id)}`)
      const data = await res.json()
      if (data.success) {
        setRowStatus((prev) => ({ ...prev, [r.id]: { provider_status: data.provider_status, txn_status: data.txn_status } }))
        showToast(`Provider: ${data.txn_status || data.provider_status}`, 'info')
      } else showToast(data.error || 'Status check failed', 'error')
    } catch {
      showToast('Status check failed', 'error')
    } finally {
      setCheckingRow(null)
    }
  }

  const exportCsv = () => {
    if (rows.length === 0) return
    const headers = ['Created', 'Order ID', 'Reference ID', 'Owner', 'Target', 'Beneficiary', 'Account', 'IFSC', 'Mode', 'Amount', 'Charges', 'Refund Amount', 'Status', 'Refund State', 'UTR']
    const lines = rows.map((r) =>
      [
        fmtDate(r.created_at), r.order_id, r.reference_id, r.owner_name, r.target,
        r.account_holder_name || '', r.account_number || '', r.ifsc_code || '', r.mode || '',
        r.amount ?? '', r.charges ?? '', r.refund_amount ?? '', r.status, r.refund_state, r.utr || '',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    )
    const csv = [headers.join(','), ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `reversals_${startDate}_to_${endDate}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  const allSelected = rows.length > 0 && selected.size === rows.length

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminSidebar isOpen={true} onClose={() => {}} />
      <div className="ml-64 p-6">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-1 flex items-center gap-2">
              <RotateCcw className="w-7 h-7 text-blue-600" /> Reversals &amp; Refunds
            </h1>
            <p className="text-gray-600">Find, verify and refund stuck payout / settlement transactions — single or bulk.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setVerifyProvider((v) => !v)}
              title="When on, never refunds a transaction the provider reports as genuinely SUCCESSFUL."
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium ${
                verifyProvider ? 'bg-green-50 border-green-300 text-green-700' : 'bg-gray-50 border-gray-300 text-gray-500'
              }`}
            >
              <ShieldCheck className="w-4 h-4" /> Verify provider {verifyProvider ? 'ON' : 'OFF'}
            </button>
            <button
              onClick={exportCsv}
              disabled={rows.length === 0}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="px-3 py-2 border rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="px-3 py-2 border rounded-lg text-sm">
                <option value="REFUNDABLE">Refundable (Pending + Failed)</option>
                <option value="PENDING">Pending</option>
                <option value="FAILED">Failed</option>
                <option value="SUCCESS">Success</option>
                <option value="ALL">All</option>
              </select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Search (Order ID / Ref / Beneficiary / Account / UTR)</label>
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                  className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm"
                  placeholder="APITXN… / SV2_… / name / a/c no."
                />
              </div>
            </div>
            <button
              onClick={runSearch}
              disabled={searching}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {searching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Filter className="w-4 h-4" />}
              {searching ? 'Searching…' : 'Search'}
            </button>
          </div>
          <div className="flex items-center gap-2 mt-3">
            <Calendar className="w-4 h-4 text-gray-400" />
            {[['Today', 0], ['7 days', 7], ['30 days', 30], ['90 days', 90]].map(([label, d]) => (
              <button key={label as string} onClick={() => preset(d as number)} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600">
                {label as string}
              </button>
            ))}
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            <StatCard label="Total" value={stats.total} icon={ListChecks} tint="bg-gray-50 text-gray-700" />
            <StatCard label="Pending" value={stats.pending} icon={Activity} tint="bg-amber-50 text-amber-700" />
            <StatCard label="Failed" value={stats.failed} icon={XCircle} tint="bg-red-50 text-red-700" />
            <StatCard label="Success" value={stats.success} icon={CheckCircle} tint="bg-green-50 text-green-700" />
            <StatCard label="Already Refunded" value={stats.already_refunded} icon={ShieldCheck} tint="bg-blue-50 text-blue-700" />
            <StatCard label="Refundable ₹" value={fmtINR(stats.refundable_amount)} icon={IndianRupee} tint="bg-emerald-50 text-emerald-700" small />
          </div>
        )}

        {/* Manual entry (collapsible) */}
        <div className="bg-white rounded-lg shadow mb-6">
          <button onClick={() => setShowManual((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
            <span className="flex items-center gap-2 font-medium text-gray-800">
              <Layers className="w-5 h-5 text-blue-600" /> Manual ID Entry (paste Order/Request IDs)
            </span>
            {showManual ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
          </button>
          <AnimatePresence>
            {showManual && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="px-4 pb-4">
                  <textarea
                    value={manualIds}
                    onChange={(e) => setManualIds(e.target.value)}
                    rows={4}
                    className="w-full px-3 py-2 border rounded-lg font-mono text-xs mb-2"
                    placeholder={'APITXN0508261422128G\nSV2_71c2d8dc-...\nAPITXN0508261421015N'}
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">{parseManual().length} ID(s) · max 200</span>
                    <div className="flex gap-2">
                      <button onClick={() => doRefund(parseManual(), true)} disabled={refunding} className="px-4 py-2 border border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 disabled:opacity-50 text-sm">
                        Preview
                      </button>
                      <button onClick={() => doRefund(parseManual(), false)} disabled={refunding} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm">
                        Refund Pasted
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Results table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="flex items-center gap-3">
              <span className="font-medium text-gray-800">{rows.length} transaction(s)</span>
              {rows.length > 0 && (
                <button onClick={selectRefundable} className="text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 hover:bg-emerald-200">
                  Select {refundableRows.length} refundable
                </button>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-3 w-10">
                    <input type="checkbox" checked={allSelected} onChange={selectAllVisible} />
                  </th>
                  <th className="text-left px-3 py-3 font-medium">Created</th>
                  <th className="text-left px-3 py-3 font-medium">Order ID</th>
                  <th className="text-left px-3 py-3 font-medium">Owner</th>
                  <th className="text-left px-3 py-3 font-medium">Beneficiary</th>
                  <th className="text-right px-3 py-3 font-medium">Amount</th>
                  <th className="text-left px-3 py-3 font-medium">Status</th>
                  <th className="text-left px-3 py-3 font-medium">Refund</th>
                  <th className="text-left px-3 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.length === 0 && !searching && (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">No transactions. Adjust filters and search.</td></tr>
                )}
                {rows.map((r) => {
                  const isSel = selected.has(r.id)
                  const rs = rowStatus[r.id]
                  return (
                    <tr key={r.id} className={`hover:bg-gray-50 ${isSel ? 'bg-blue-50/50' : ''}`}>
                      <td className="px-3 py-3"><input type="checkbox" checked={isSel} onChange={() => toggleSelect(r.id)} /></td>
                      <td className="px-3 py-3 whitespace-nowrap text-gray-600">{fmtDate(r.created_at)}</td>
                      <td className="px-3 py-3 font-mono text-xs">
                        <div>{r.order_id || '—'}</div>
                        <div className="text-gray-400 text-[10px] truncate max-w-[180px]" title={r.reference_id}>{r.reference_id}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5">
                          {r.target === 'partner' ? <Building2 className="w-3.5 h-3.5 text-purple-500" /> : <Wallet className="w-3.5 h-3.5 text-blue-500" />}
                          <span className="truncate max-w-[140px]" title={r.owner_name}>{r.owner_name}</span>
                        </div>
                        <span className="text-[10px] text-gray-400 capitalize">{r.target}</span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="truncate max-w-[130px]" title={r.account_holder_name}>{r.account_holder_name || '—'}</div>
                        <div className="text-[10px] text-gray-400">{r.account_number} · {r.mode}</div>
                      </td>
                      <td className="px-3 py-3 text-right font-medium whitespace-nowrap">{fmtINR(r.refund_amount)}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[r.status] || 'bg-gray-100 text-gray-600'}`}>{r.status}</span>
                        {rs && <div className="text-[10px] text-gray-500 mt-1">prov: {rs.txn_status || rs.provider_status}</div>}
                      </td>
                      <td className="px-3 py-3">
                        {r.refund_state === 'refunded' ? (
                          <span className="inline-flex items-center gap-1 text-green-700 text-xs"><ShieldCheck className="w-3.5 h-3.5" /> Done</span>
                        ) : r.status === 'SUCCESS' ? (
                          <span className="inline-flex items-center gap-1 text-amber-600 text-xs"><AlertTriangle className="w-3.5 h-3.5" /> Success</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-gray-500 text-xs">Not refunded</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => checkRowStatus(r)}
                            disabled={checkingRow === r.id || !r.reference_id}
                            className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                          >
                            {checkingRow === r.id ? '…' : 'Check'}
                          </button>
                          <button
                            onClick={() => doRefund([r.order_id || r.reference_id], false)}
                            disabled={refunding || r.status === 'SUCCESS' || r.refund_state === 'refunded'}
                            className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
                          >
                            Refund
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Sticky bulk action bar */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
            className="fixed bottom-0 left-64 right-0 bg-white border-t shadow-2xl px-6 py-4 flex items-center justify-between z-40"
          >
            <div className="flex items-center gap-4">
              <span className="font-semibold text-gray-900">{selected.size} selected</span>
              <span className="text-gray-500">Total {fmtINR(selectedAmount)}</span>
              <button onClick={() => setSelected(new Set())} className="text-sm text-gray-500 hover:text-gray-700 underline">Clear</button>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => doRefund(identifiersFor(selectedRows), true)}
                disabled={refunding}
                className="px-5 py-2 border border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 disabled:opacity-50"
              >
                Preview
              </button>
              <button
                onClick={() => doRefund(identifiersFor(selectedRows), false)}
                disabled={refunding}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                {refunding ? 'Processing…' : `Refund ${selected.size} selected`}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Results modal */}
      <AnimatePresence>
        {results && summary && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-6 py-4 border-b">
                <h3 className="text-xl font-bold">{lastWasDryRun ? 'Preview Result' : 'Refund Result'}</h3>
                <button onClick={() => { setResults(null); setSummary(null) }} className="text-gray-400 hover:text-gray-600"><XCircle className="w-6 h-6" /></button>
              </div>
              <div className="p-6 overflow-y-auto">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-center mb-5">
                  <MiniStat v={summary.refunded} l={lastWasDryRun ? 'Would refund' : 'Refunded'} c="bg-green-50 text-green-700" />
                  <MiniStat v={summary.already_refunded} l="Already done" c="bg-blue-50 text-blue-700" />
                  <MiniStat v={summary.reconciled_success} l="Success (kept)" c="bg-amber-50 text-amber-700" />
                  <MiniStat v={summary.critical_failed} l="Critical" c="bg-red-50 text-red-700" />
                  <MiniStat v={summary.not_found} l="Not found" c="bg-gray-50 text-gray-600" />
                  <MiniStat v={fmtINR(summary.total_refunded_amount)} l="Total ₹" c="bg-emerald-50 text-emerald-700" small />
                </div>
                <div className="overflow-x-auto border rounded-lg">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Identifier</th>
                        <th className="text-left px-3 py-2 font-medium">Beneficiary</th>
                        <th className="text-right px-3 py-2 font-medium">Amount</th>
                        <th className="text-left px-3 py-2 font-medium">Target</th>
                        <th className="text-left px-3 py-2 font-medium">Result</th>
                        <th className="text-left px-3 py-2 font-medium">Message</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {results.map((r, i) => {
                        const meta = RESULT_META[r.result]
                        const Icon = meta.Icon
                        return (
                          <tr key={i}>
                            <td className="px-3 py-2 font-mono text-xs">{r.order_id || r.identifier}</td>
                            <td className="px-3 py-2">{r.beneficiary || '—'}</td>
                            <td className="px-3 py-2 text-right">{r.amount ? fmtINR(r.amount) : '—'}</td>
                            <td className="px-3 py-2 capitalize">{r.target || '—'}</td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${meta.className}`}><Icon className="w-3.5 h-3.5" /> {meta.label}</span>
                            </td>
                            <td className="px-3 py-2 text-gray-500 text-xs max-w-xs truncate" title={r.message}>{r.message || '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="px-6 py-4 border-t flex justify-end">
                <button onClick={() => { setResults(null); setSummary(null) }} className="px-5 py-2 bg-gray-100 rounded-lg hover:bg-gray-200">Close</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

function StatCard({ label, value, icon: Icon, tint, small }: { label: string; value: any; icon: any; tint: string; small?: boolean }) {
  return (
    <div className={`rounded-lg p-3 ${tint}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium opacity-80">{label}</span>
        <Icon className="w-4 h-4 opacity-70" />
      </div>
      <p className={`font-bold ${small ? 'text-lg' : 'text-2xl'} mt-1`}>{value}</p>
    </div>
  )
}

function MiniStat({ v, l, c, small }: { v: any; l: string; c: string; small?: boolean }) {
  return (
    <div className={`p-3 rounded-lg ${c}`}>
      <p className={`font-bold ${small ? 'text-base' : 'text-2xl'}`}>{v}</p>
      <p className="text-xs text-gray-600">{l}</p>
    </div>
  )
}
