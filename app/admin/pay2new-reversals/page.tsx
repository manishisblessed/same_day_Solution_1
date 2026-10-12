'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import AdminSidebar from '@/components/AdminSidebar'
import {
  RotateCcw, RefreshCw, ShieldCheck, CheckCircle, XCircle, AlertTriangle, Clock, Menu, Layers, Undo2,
} from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { useToast } from '@/components/Toast'

type HeldItem = {
  request_id: string
  owner: 'partner' | 'retailer' | 'partner_api'
  amount: number
  reason: string
  created_at: string
  product_name?: string
}

type RowCheck = { decision: 'refundable' | 'blocked' | 'wait'; provider_status: string; not_found?: boolean }

function fmtINR(n?: number) {
  if (n === undefined || n === null) return '—'
  return `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(s?: string) {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// Known false-refund candidates from the Oct-2026 loss sweep (partner_api).
// Pre-seeded for one-click recovery; each is re-verified live against the vendor.
const RECOVER_SEED = [
  'SDS1790323955794', 'SDS1789740337216', 'SDS1789639195670', 'SDS1789573883111',
  'SDS1788855809313', 'SDS1788855621976', 'SDS1788612712988', 'SDS1788609571486',
  'SDS1791206748465', 'SDS1791198994919', 'SDS1791106209521', 'SDS1790849210617',
  'SDS1791617967717', 'SDS1791617959724', 'SDS1791617888780', 'SDS1791617735654', 'SDS1791617629907',
].join('\n')

const DECISION_META: Record<RowCheck['decision'], { label: string; cls: string }> = {
  refundable: { label: 'Refundable (not charged)', cls: 'bg-green-100 text-green-700' },
  blocked: { label: 'SUCCESS — do not refund', cls: 'bg-red-100 text-red-700' },
  wait: { label: 'Pending — hold', cls: 'bg-amber-100 text-amber-700' },
}

export default function Pay2NewReversalsPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const { showToast } = useToast()

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [items, setItems] = useState<HeldItem[]>([])
  const [loading, setLoading] = useState(false)
  const [days, setDays] = useState(30)
  const [checks, setChecks] = useState<Record<string, RowCheck>>({})
  const [checking, setChecking] = useState<string | null>(null)
  const [refunding, setRefunding] = useState<string | null>(null)
  const [manualIds, setManualIds] = useState('')
  const [busyManual, setBusyManual] = useState(false)
  const [recoverIds, setRecoverIds] = useState(RECOVER_SEED)
  const [busyRecover, setBusyRecover] = useState(false)

  useEffect(() => {
    if (!authLoading && (!user || (user.role !== 'admin' && (user as any).role !== 'finance_executive'))) {
      router.push('/admin/login')
    }
  }, [user, authLoading, router])

  const loadHeld = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/admin/pay2new/review?days=${days}`)
      const data = await res.json()
      if (data.success) { setItems(data.items || []); setChecks({}) }
      else showToast(data.error || 'Failed to load', 'error')
    } catch (e: any) {
      showToast(e?.message || 'Failed to load', 'error')
    } finally {
      setLoading(false)
    }
  }, [days, showToast])

  useEffect(() => {
    if (user && (user.role === 'admin' || (user as any).role === 'finance_executive')) loadHeld()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const checkRow = async (id: string) => {
    setChecking(id)
    try {
      const res = await apiFetch(`/api/admin/pay2new/status?request_id=${encodeURIComponent(id)}`)
      const data = await res.json()
      if (data.success) {
        setChecks((p) => ({ ...p, [id]: { decision: data.decision, provider_status: data.provider_status, not_found: data.not_found } }))
        showToast(`Vendor: ${data.provider_status}${data.not_found ? ' (not found)' : ''}`, data.decision === 'blocked' ? 'error' : 'info')
      } else showToast(data.error || 'Check failed', 'error')
    } catch {
      showToast('Check failed', 'error')
    } finally {
      setChecking(null)
    }
  }

  const refundRow = async (id: string) => {
    const chk = checks[id]
    if (!chk || chk.decision !== 'refundable') {
      showToast('Run Check first — refund is only allowed when the vendor confirms NOT charged.', 'error')
      return
    }
    if (!window.confirm(`Refund ${id}?\n\nThe wallet will be credited and any commission reversed. Safe to re-run (never double-credits).`)) return
    setRefunding(id)
    try {
      const res = await apiFetch('/api/admin/pay2new/review', {
        method: 'POST',
        body: JSON.stringify({ request_ids: [id], dryRun: false }),
      })
      const data = await res.json()
      const r = data?.results?.[0]
      if (data.success && r?.result === 'refunded') {
        showToast(`Refunded ${fmtINR(r.amount)}`, 'success')
        loadHeld()
      } else {
        showToast(r?.message || r?.result || data.error || 'Refund not performed', 'error')
      }
    } catch {
      showToast('Refund failed', 'error')
    } finally {
      setRefunding(null)
    }
  }

  const parseManual = () => manualIds.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)

  const doManual = async (dryRun: boolean) => {
    const ids = parseManual()
    if (ids.length === 0) { showToast('Paste at least one request id', 'error'); return }
    if (!dryRun && !window.confirm(`Refund ${ids.length} transaction(s)?\n\nEach is re-verified against the vendor; only confirmed-not-charged are refunded. Safe to re-run.`)) return
    setBusyManual(true)
    try {
      const res = await apiFetch('/api/admin/pay2new/review', {
        method: 'POST',
        body: JSON.stringify({ request_ids: ids, dryRun }),
      })
      const data = await res.json()
      if (data.success) {
        const s = data.summary
        if (dryRun) showToast(`Preview: ${s.would_refund} refundable · ${s.blocked_success} blocked (SUCCESS) · ${s.waiting} waiting`, 'info')
        else { showToast(`Refunded ${s.refunded} · ${fmtINR(s.total_refunded_amount)}`, 'success'); loadHeld() }
        console.table(data.results)
      } else showToast(data.error || 'Failed', 'error')
    } catch {
      showToast('Failed', 'error')
    } finally {
      setBusyManual(false)
    }
  }

  const parseRecover = () => recoverIds.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)

  const discoverRecover = async () => {
    setBusyRecover(true)
    try {
      const res = await apiFetch('/api/admin/pay2new/recover?days=90')
      const data = await res.json()
      if (data.success) {
        setRecoverIds((data.candidates || []).map((c: any) => c.request_id).join('\n'))
        showToast(`Found ${data.count} false-refund candidate(s)`, 'info')
      } else showToast(data.error || 'Discover failed', 'error')
    } catch {
      showToast('Discover failed', 'error')
    } finally {
      setBusyRecover(false)
    }
  }

  const doRecover = async (dryRun: boolean) => {
    const ids = parseRecover()
    if (ids.length === 0) { showToast('Paste at least one request id', 'error'); return }
    if (!dryRun && !window.confirm(`Recover (clawback) ${ids.length} transaction(s)?\n\nEach is re-verified live; ONLY vendor-confirmed SUCCESS are re-debited to reverse a wrong refund. Idempotent — safe to re-run.`)) return
    setBusyRecover(true)
    try {
      const res = await apiFetch('/api/admin/pay2new/recover', {
        method: 'POST',
        body: JSON.stringify({ request_ids: ids, dryRun }),
      })
      const data = await res.json()
      if (data.success) {
        const s = data.summary
        if (dryRun) showToast(`Preview: ${s.would_recover} recoverable (${fmtINR(s.would_recover_amount)}) · ${s.refund_was_correct} correct · ${s.waiting} wait · ${s.insufficient_balance} no-balance`, 'info')
        else { showToast(`Recovered ${s.recovered} · ${fmtINR(s.recovered_amount)}${s.insufficient_balance ? ` · ${s.insufficient_balance} failed (no balance)` : ''}`, 'success'); loadHeld() }
        console.table(data.results)
      } else showToast(data.error || 'Failed', 'error')
    } catch {
      showToast('Failed', 'error')
    } finally {
      setBusyRecover(false)
    }
  }

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-600" /></div>
  }

  const totalHeld = items.reduce((s, i) => s + (i.amount || 0), 0)

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
                <RotateCcw className="w-7 h-7 text-blue-600" /> BBPS-2 (Pay2New) Reversals
              </h1>
              <p className="text-gray-600 max-w-2xl">
                Payments held for manual review (vendor said &quot;not found&quot; or aged past the auto window).
                Money is <b>held, never auto-refunded</b>. Refund is allowed only after <b>Check</b> confirms the vendor did <b>NOT</b> charge, and only ≥5 min after the transaction. Idempotent — never double-credits — and commission is reversed automatically.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="px-2 py-2 border rounded-lg text-sm">
                <option value={7}>7 days</option>
                <option value={30}>30 days</option>
                <option value={90}>90 days</option>
              </select>
              <button onClick={loadHeld} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm">
                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Refresh
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            <div className="rounded-lg p-3 bg-amber-50 text-amber-700"><p className="text-xs font-medium opacity-80">Held for review</p><p className="text-2xl font-bold mt-1">{items.length}</p></div>
            <div className="rounded-lg p-3 bg-emerald-50 text-emerald-700"><p className="text-xs font-medium opacity-80">Held amount</p><p className="text-lg font-bold mt-1">{fmtINR(totalHeld)}</p></div>
          </div>

          {/* Manual ID entry */}
          <div className="bg-white rounded-lg shadow p-4 mb-6">
            <div className="flex items-center gap-2 font-medium text-gray-800 mb-2"><Layers className="w-5 h-5 text-blue-600" /> Manual ID entry (paste request IDs, e.g. SDS…)</div>
            <textarea value={manualIds} onChange={(e) => setManualIds(e.target.value)} rows={3} className="w-full px-3 py-2 border rounded-lg font-mono text-xs mb-2" placeholder={'SDS1791707410679\nSDS1791706804043'} />
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">{parseManual().length} ID(s) · each re-verified against the vendor</span>
              <div className="flex gap-2">
                <button onClick={() => doManual(true)} disabled={busyManual} className="px-4 py-2 border border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50 disabled:opacity-50 text-sm">Preview</button>
                <button onClick={() => doManual(false)} disabled={busyManual} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm">Refund pasted</button>
              </div>
            </div>
          </div>

          {/* False-refund recovery (clawback) */}
          <div className="bg-white rounded-lg shadow p-4 mb-6 border-l-4 border-rose-400">
            <div className="flex items-center gap-2 font-medium text-gray-800 mb-1"><Undo2 className="w-5 h-5 text-rose-600" /> Recover false refunds (clawback)</div>
            <p className="text-xs text-gray-500 mb-2">
              Reverses a wrong refund where the vendor actually <b>SUCCEEDED</b>. Each ID is re-verified live against Pay2New;
              <b> only vendor-confirmed SUCCESS</b> is re-debited. Idempotent (CLAWBACK_). If the partner already spent the money it reports <b>no-balance</b> for manual follow-up.
              <b> Must be run from the deployed (IP-whitelisted) server.</b>
            </p>
            <textarea value={recoverIds} onChange={(e) => setRecoverIds(e.target.value)} rows={4} className="w-full px-3 py-2 border rounded-lg font-mono text-xs mb-2" placeholder={'SDS…'} />
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs text-gray-500">{parseRecover().length} ID(s)</span>
              <div className="flex gap-2">
                <button onClick={discoverRecover} disabled={busyRecover} className="px-3 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-100 disabled:opacity-50 text-sm">Auto-discover</button>
                <button onClick={() => doRecover(true)} disabled={busyRecover} className="px-4 py-2 border border-rose-500 text-rose-600 rounded-lg hover:bg-rose-50 disabled:opacity-50 text-sm">Preview</button>
                <button onClick={() => doRecover(false)} disabled={busyRecover} className="px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50 text-sm">Recover (clawback)</button>
              </div>
            </div>
          </div>

          {/* Held table */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 border-b font-medium text-gray-800">{items.length} held transaction(s)</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left px-3 py-3 font-medium">Created</th>
                    <th className="text-left px-3 py-3 font-medium">Request ID</th>
                    <th className="text-left px-3 py-3 font-medium">Owner</th>
                    <th className="text-right px-3 py-3 font-medium">Amount</th>
                    <th className="text-left px-3 py-3 font-medium">Reason</th>
                    <th className="text-left px-3 py-3 font-medium">Vendor check</th>
                    <th className="text-left px-3 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.length === 0 && !loading && (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400 flex-col"><CheckCircle className="w-6 h-6 text-green-500 inline mb-1" /><div>No held transactions. Nothing awaiting manual review.</div></td></tr>
                  )}
                  {items.map((it) => {
                    const chk = checks[it.request_id]
                    return (
                      <tr key={it.request_id} className="hover:bg-gray-50">
                        <td className="px-3 py-3 whitespace-nowrap text-gray-600">{fmtDate(it.created_at)}</td>
                        <td className="px-3 py-3 font-mono text-xs">{it.request_id}<div className="text-[10px] text-gray-400">{it.product_name}</div></td>
                        <td className="px-3 py-3 capitalize">{it.owner.replace('_', ' ')}</td>
                        <td className="px-3 py-3 text-right font-medium whitespace-nowrap">{fmtINR(it.amount)}</td>
                        <td className="px-3 py-3"><span className="inline-flex items-center gap-1 text-xs text-amber-700"><Clock className="w-3.5 h-3.5" />{it.reason}</span></td>
                        <td className="px-3 py-3">
                          {chk ? <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${DECISION_META[chk.decision].cls}`}>{chk.decision === 'refundable' ? <CheckCircle className="w-3.5 h-3.5" /> : chk.decision === 'blocked' ? <XCircle className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}{DECISION_META[chk.decision].label}</span> : <span className="text-xs text-gray-400">not checked</span>}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <button onClick={() => checkRow(it.request_id)} disabled={checking === it.request_id} className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-50">
                              {checking === it.request_id ? '…' : 'Check'}
                            </button>
                            <button onClick={() => refundRow(it.request_id)} disabled={refunding === it.request_id || !chk || chk.decision !== 'refundable'} title={!chk ? 'Run Check first' : chk.decision !== 'refundable' ? 'Only refundable when vendor confirms NOT charged' : ''} className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
                              {refunding === it.request_id ? '…' : 'Refund'}
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
          <p className="text-xs text-gray-400 mt-3 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> Refund is blocked automatically if the vendor shows SUCCESS or the payment is still pending/unverifiable.</p>
        </div>
      </div>
    </div>
  )
}
