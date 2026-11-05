'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import AdminSidebar from '@/components/AdminSidebar'
import {
  ShieldCheck, RefreshCw, CheckCircle, Clock, AlertTriangle, Menu, Undo2, TrendingDown,
} from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useToast } from '@/components/Toast'

type RowStatus = 'awaiting_approval' | 'approved_pending' | 'recovered'

type Item = {
  request_id: string
  owner?: 'partner_api' | 'partner' | 'retailer'
  partner_id: string
  name?: string | null
  amount: number
  created_at: string
  status: RowStatus
  vendor_status?: string
  verified_at?: string | null
  order_id?: string | null
  operator_reference?: string | null
  cc_card?: string | null
  cc_name?: string | null
  cc_mobile?: string | null
}

type Totals = {
  detected_count: number; detected_amount: number
  awaiting_count: number; awaiting_amount: number
  pending_count: number; pending_amount: number
  recovered_count: number; recovered_amount: number
}

type PartnerAgg = { partner_id: string; name: string | null; count: number; amount: number; recovered_amount: number }

function fmtINR(n?: number) {
  if (n === undefined || n === null) return '—'
  return `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(s?: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

const STATUS_META: Record<RowStatus, { label: string; cls: string; icon: any }> = {
  awaiting_approval: { label: 'Awaiting Approval', cls: 'bg-amber-100 text-amber-700', icon: Clock },
  approved_pending: { label: 'Approved · recovering', cls: 'bg-blue-100 text-blue-700', icon: RefreshCw },
  recovered: { label: 'Recovered', cls: 'bg-emerald-100 text-emerald-700', icon: CheckCircle },
}

export default function Pay2NewClawbackApprovalPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const { showToast } = useToast()

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [byPartner, setByPartner] = useState<PartnerAgg[]>([])
  const [loading, setLoading] = useState(false)
  const [days, setDays] = useState(180)
  const [approving, setApproving] = useState<string | null>(null)
  const [busyBulk, setBusyBulk] = useState(false)

  useEffect(() => {
    if (!authLoading && (!user || (user.role !== 'admin' && (user as any).role !== 'finance_executive'))) {
      router.push('/admin/login')
    }
  }, [user, authLoading, router])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/admin/pay2new/clawback-approval?days=${days}`)
      const data = await res.json()
      if (data.success) {
        setItems(data.items || [])
        setTotals(data.totals || null)
        setByPartner(data.by_partner || [])
      } else showToast(data.error || 'Failed to load', 'error')
    } catch (e: any) {
      showToast(e?.message || 'Failed to load', 'error')
    } finally {
      setLoading(false)
    }
  }, [days, showToast])

  useEffect(() => {
    if (user && (user.role === 'admin' || (user as any).role === 'finance_executive')) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const approve = async (ids: string[]) => {
    const res = await apiFetch('/api/admin/pay2new/clawback-approval', {
      method: 'POST',
      body: JSON.stringify({ request_ids: ids, dryRun: false }),
    })
    return res.json()
  }

  const approveRow = async (it: Item) => {
    if (!window.confirm(`Approve clawback of ${fmtINR(it.amount)} for ${it.request_id}?\n\nThe vendor is re-verified live; the wallet is re-debited ONLY if it still shows SUCCESS. Idempotent — safe to re-run. If balance is short it is queued and recovered automatically later.`)) return
    setApproving(it.request_id)
    try {
      const data = await approve([it.request_id])
      const r = data?.results?.[0]
      if (data.success && (r?.result === 'recovered' || r?.result === 'approved_pending')) {
        showToast(r.result === 'recovered' ? `Recovered ${fmtINR(r.amount)}` : `Approved — queued for recovery (balance short)`, 'success')
        load()
      } else {
        showToast(r?.message || r?.result || data.error || 'Not approved', 'error')
      }
    } catch {
      showToast('Approval failed', 'error')
    } finally {
      setApproving(null)
    }
  }

  const approveAllAwaiting = async () => {
    const ids = items.filter((i) => i.status === 'awaiting_approval').map((i) => i.request_id)
    if (ids.length === 0) { showToast('Nothing awaiting approval', 'info'); return }
    if (!window.confirm(`Approve ALL ${ids.length} awaiting clawback(s)?\n\nEach is re-verified live against the vendor; only confirmed SUCCESS is re-debited. Idempotent. Balance-short ones are queued for automatic recovery.`)) return
    setBusyBulk(true)
    try {
      const data = await approve(ids)
      if (data.success) {
        const s = data.summary
        showToast(`Recovered ${s.recovered} (${fmtINR(s.recovered_amount)}) · queued ${s.approved_pending} · correct ${s.refund_was_correct} · wait ${s.waiting}`, 'success')
        load()
      } else showToast(data.error || 'Failed', 'error')
    } catch {
      showToast('Failed', 'error')
    } finally {
      setBusyBulk(false)
    }
  }

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600" /></div>
  }

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900 overflow-x-hidden">
      <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 lg:ml-56 min-w-0 overflow-x-hidden pt-16">
        <button onClick={() => setSidebarOpen(true)} className="lg:hidden fixed top-20 left-2 z-30 p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
          <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
        </button>
        <div className="p-4 sm:p-6">
          <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-1 flex items-center gap-2">
                <ShieldCheck className="w-7 h-7 text-rose-600" /> BBPS-2 Clawback Approval
              </h1>
              <p className="text-gray-600 max-w-2xl">
                False refunds found by the continuous audit — payments we refunded that the vendor <b>actually charged</b> (our loss).
                The audit only <b>detects</b>; money moves only when you <b>Approve</b>. Each approval re-verifies the vendor live and re-debits only if it still shows <b>SUCCESS</b>. Idempotent — never double-debits. If the partner has spent the money it is queued and recovered automatically when balance returns.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="px-2 py-2 border rounded-lg text-sm">
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
                <option value={180}>180 days</option>
                <option value={365}>365 days</option>
              </select>
              <button onClick={load} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm">
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>
          </div>

          {/* Exposure summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="rounded-lg p-3 bg-rose-50 text-rose-700">
              <p className="text-xs font-medium opacity-80 flex items-center gap-1"><TrendingDown className="w-3.5 h-3.5" /> Detected loss</p>
              <p className="text-lg font-bold mt-1">{fmtINR(totals?.detected_amount)}</p>
              <p className="text-[11px] opacity-70">{totals?.detected_count || 0} txn</p>
            </div>
            <div className="rounded-lg p-3 bg-amber-50 text-amber-700">
              <p className="text-xs font-medium opacity-80">Awaiting approval</p>
              <p className="text-lg font-bold mt-1">{fmtINR(totals?.awaiting_amount)}</p>
              <p className="text-[11px] opacity-70">{totals?.awaiting_count || 0} txn</p>
            </div>
            <div className="rounded-lg p-3 bg-blue-50 text-blue-700">
              <p className="text-xs font-medium opacity-80">Approved · recovering</p>
              <p className="text-lg font-bold mt-1">{fmtINR(totals?.pending_amount)}</p>
              <p className="text-[11px] opacity-70">{totals?.pending_count || 0} txn</p>
            </div>
            <div className="rounded-lg p-3 bg-emerald-50 text-emerald-700">
              <p className="text-xs font-medium opacity-80">Recovered</p>
              <p className="text-lg font-bold mt-1">{fmtINR(totals?.recovered_amount)}</p>
              <p className="text-[11px] opacity-70">{totals?.recovered_count || 0} txn</p>
            </div>
          </div>

          {/* By partner */}
          {byPartner.length > 0 && (
            <div className="bg-white rounded-lg shadow p-4 mb-6">
              <div className="font-medium text-gray-800 mb-2">Exposure by partner</div>
              <div className="flex flex-wrap gap-2">
                {byPartner.map((p) => (
                  <div key={p.partner_id} className="px-3 py-2 rounded-lg border border-gray-200 text-sm">
                    <span className="font-medium text-gray-800">{p.name || p.partner_id}</span>
                    <span className="text-gray-500"> · {p.count} txn · </span>
                    <span className="font-semibold text-rose-600">{fmtINR(p.amount)}</span>
                    {p.recovered_amount > 0 && <span className="text-emerald-600"> · recovered {fmtINR(p.recovered_amount)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Table */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <span className="font-medium text-gray-800">{items.length} detected false refund(s)</span>
              <button onClick={approveAllAwaiting} disabled={busyBulk || !items.some((i) => i.status === 'awaiting_approval')} className="flex items-center gap-2 px-3 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-40 text-sm">
                <Undo2 className="w-4 h-4" /> Approve all awaiting
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left px-3 py-3 font-medium">Created</th>
                    <th className="text-left px-3 py-3 font-medium">Request ID</th>
                    <th className="text-left px-3 py-3 font-medium">Partner</th>
                    <th className="text-left px-3 py-3 font-medium">Card / Customer</th>
                    <th className="text-right px-3 py-3 font-medium">Amount</th>
                    <th className="text-left px-3 py-3 font-medium">Vendor</th>
                    <th className="text-left px-3 py-3 font-medium">Current Status</th>
                    <th className="text-left px-3 py-3 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.length === 0 && !loading && (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400"><CheckCircle className="w-6 h-6 text-green-500 inline mb-1" /><div>No false refunds detected. Nothing awaiting approval.</div></td></tr>
                  )}
                  {items.map((it) => {
                    const meta = STATUS_META[it.status]
                    const Icon = meta.icon
                    return (
                      <tr key={it.request_id} className="hover:bg-gray-50">
                        <td className="px-3 py-3 whitespace-nowrap text-gray-600">{fmtDate(it.created_at)}</td>
                        <td className="px-3 py-3 font-mono text-xs">{it.request_id}{it.order_id && <div className="text-[10px] text-gray-400">order {it.order_id}</div>}</td>
                        <td className="px-3 py-3">
                          <div className="font-medium text-gray-800">{it.name || '—'}</div>
                          {it.owner && <div className="text-[10px] text-gray-400 capitalize">{it.owner === 'partner_api' ? 'partner API' : it.owner}</div>}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <div className="font-mono text-xs text-gray-700">{it.cc_card || '—'}</div>
                          <div className="text-[10px] text-gray-500">{it.cc_name || ''}{it.cc_mobile ? `${it.cc_name ? ' · ' : ''}${it.cc_mobile}` : ''}</div>
                        </td>
                        <td className="px-3 py-3 text-right font-medium whitespace-nowrap text-rose-600">{fmtINR(it.amount)}</td>
                        <td className="px-3 py-3"><span className="inline-flex items-center gap-1 text-xs text-gray-600">{it.vendor_status || 'SUCCESS'}</span></td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${meta.cls}`}>
                            <Icon className="w-3.5 h-3.5" />{meta.label}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <button
                            onClick={() => approveRow(it)}
                            disabled={approving === it.request_id || it.status === 'recovered'}
                            title={it.status === 'recovered' ? 'Already recovered' : 'Re-verify vendor & clawback'}
                            className="text-xs px-3 py-1 rounded bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40"
                          >
                            {approving === it.request_id ? '…' : it.status === 'recovered' ? 'Recovered' : it.status === 'approved_pending' ? 'Retry' : 'Approve'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-3 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> Clawback runs only on a fresh vendor SUCCESS. Detection is continuous (every 2h); approval and money movement are manual.</p>
        </div>
      </div>
    </div>
  )
}
