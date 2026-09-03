'use client'

import React, { useState, useEffect, Suspense } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import AdminSidebar from '@/components/AdminSidebar'
import {
  Loader2, ArrowLeft, CheckCircle2, Ban, Plus, Trash2, Download, RefreshCw,
  X, Wallet, Building2, Receipt, FileText,
} from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import { motion, AnimatePresence } from 'framer-motion'

interface Settlement {
  id: string
  amount: number
  settled_on: string
  method: string
  bank_account: string | null
  utr_reference: string | null
  note: string | null
  reference_type: string | null
  recorded_by: string | null
  created_at: string
}

interface BreakdownRow {
  payment_mode: string
  card_type: string
  card_brand: string
  txn_count: number
  gross: number
  mdr: number
  net: number
}

interface InvoiceDetail {
  id: string
  invoice_number: string
  partner_id: string
  partner: { name?: string; business_name?: string; email?: string; phone?: string; gst_number?: string }
  period_start: string
  period_end: string
  transaction_value: number
  txn_count: number
  service_charge: number
  net_payable: number
  amount_settled: number
  balance_due: number
  breakdown: BreakdownRow[]
  status: string
  notes: string | null
  generated_at: string
  issued_at: string | null
  created_by: string | null
  settlements: Settlement[]
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  issued: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  partially_settled: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  settled: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  void: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const METHOD_LABELS: Record<string, string> = {
  bank_transfer: 'Bank Transfer',
  wallet_push: 'Wallet Push',
  upi: 'UPI',
  cash: 'Cash',
  adjustment: 'Adjustment',
  other: 'Other',
}

const money = (n: number | string) =>
  `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
const statusLabel = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export default function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const { id } = params
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary-600" /></div>}>
      <InvoiceDetailContent id={id} />
    </Suspense>
  )
}

function InvoiceDetailContent({ id }: { id: string }) {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [actioning, setActioning] = useState(false)
  const [showSettle, setShowSettle] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'admin')) router.push('/admin/login')
  }, [user, authLoading, router])

  const fetchInvoice = async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/admin/partner-invoices/${id}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load')
      setInvoice(json.data)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user && user.role === 'admin') fetchInvoice()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, id])

  const doAction = async (action: 'issue' | 'void') => {
    if (action === 'void' && !confirm('Void this invoice? This cannot be undone.')) return
    setActioning(true)
    setError('')
    try {
      const res = await apiFetch(`/api/admin/partner-invoices/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Action failed')
      await fetchInvoice()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setActioning(false)
    }
  }

  const regenerate = async () => {
    if (!invoice) return
    setActioning(true)
    setError('')
    try {
      const res = await apiFetch('/api/admin/partner-invoices', {
        method: 'POST',
        body: JSON.stringify({ partner_id: invoice.partner_id, period_start: invoice.period_start, period_end: invoice.period_end }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Regenerate failed')
      await fetchInvoice()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setActioning(false)
    }
  }

  const deleteSettlement = async (settlementId: string) => {
    if (!confirm('Remove this settlement entry?')) return
    try {
      const res = await apiFetch(`/api/admin/partner-invoices/${id}/settlements?settlement_id=${settlementId}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Delete failed')
      await fetchInvoice()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const exportInvoice = (format: 'pdf' | 'excel' | 'csv') => {
    window.open(`/api/admin/partner-invoices/${id}/export?format=${format}`, '_blank')
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="lg:pl-56 flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-primary-600" /></div>
      </div>
    )
  }

  if (!invoice) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="lg:pl-56 p-6 pt-20">
          <button onClick={() => router.push('/admin/partner-invoices')} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-4"><ArrowLeft className="w-4 h-4" /> Back</button>
          <p className="text-red-600">{error || 'Invoice not found'}</p>
        </div>
      </div>
    )
  }

  const canSettle = ['issued', 'partially_settled'].includes(invoice.status)

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="lg:pl-56">
        <div className="p-6 pt-20 space-y-5 max-w-5xl">
          {/* Back + actions */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <button onClick={() => router.push('/admin/partner-invoices')} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
              <ArrowLeft className="w-4 h-4" /> All Invoices
            </button>
            <div className="flex items-center gap-2 flex-wrap">
              {invoice.status === 'draft' && (
                <>
                  <button onClick={regenerate} disabled={actioning} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50">
                    <RefreshCw className={`w-4 h-4 ${actioning ? 'animate-spin' : ''}`} /> Regenerate
                  </button>
                  <button onClick={() => doAction('issue')} disabled={actioning} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                    <CheckCircle2 className="w-4 h-4" /> Issue Invoice
                  </button>
                  <button onClick={() => doAction('void')} disabled={actioning} className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-red-300 text-red-600 dark:border-red-700 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50">
                    <Ban className="w-4 h-4" /> Void
                  </button>
                </>
              )}
              {canSettle && (
                <button onClick={() => setShowSettle(true)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700">
                  <Plus className="w-4 h-4" /> Record Settlement
                </button>
              )}
              <div className="flex items-center gap-1">
                <button onClick={() => exportInvoice('pdf')} title="Export PDF" className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600">
                  <Download className="w-4 h-4" /> PDF
                </button>
                <button onClick={() => exportInvoice('excel')} title="Export Excel" className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600">Excel</button>
              </div>
            </div>
          </div>

          {error && <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm rounded-lg px-4 py-2">{error}</div>}

          {/* Invoice header card */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary-600" />
                  <h1 className="text-xl font-bold text-gray-900 dark:text-white font-mono">{invoice.invoice_number}</h1>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[invoice.status]}`}>{statusLabel(invoice.status)}</span>
                </div>
                <div className="mt-2 flex items-center gap-2 text-gray-700 dark:text-gray-300">
                  <Building2 className="w-4 h-4 text-gray-400" />
                  <span className="font-semibold">{invoice.partner.name}</span>
                  {invoice.partner.business_name && <span className="text-sm text-gray-500">· {invoice.partner.business_name}</span>}
                </div>
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 space-x-3">
                  {invoice.partner.gst_number && <span>GST: {invoice.partner.gst_number}</span>}
                  {invoice.partner.email && <span>{invoice.partner.email}</span>}
                  {invoice.partner.phone && <span>{invoice.partner.phone}</span>}
                </div>
              </div>
              <div className="text-right text-sm">
                <p className="text-gray-500 dark:text-gray-400">Billing Period</p>
                <p className="font-semibold text-gray-900 dark:text-white">{fmtDate(invoice.period_start)} – {fmtDate(invoice.period_end)}</p>
                <p className="text-xs text-gray-400 mt-1">Generated {fmtDate(invoice.generated_at)}</p>
              </div>
            </div>

            {/* Headline numbers */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-5">
              <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                <p className="text-xs text-gray-500">Transaction Value</p>
                <p className="text-lg font-bold text-gray-900 dark:text-white">{money(invoice.transaction_value)}</p>
                <p className="text-[10px] text-gray-400">{invoice.txn_count} txns</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                <p className="text-xs text-gray-500">Service Charge (MDR)</p>
                <p className="text-lg font-bold text-gray-900 dark:text-white">{money(invoice.service_charge)}</p>
              </div>
              <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3 border border-purple-100 dark:border-purple-800">
                <p className="text-xs text-purple-600 dark:text-purple-400">Net Payable</p>
                <p className="text-lg font-bold text-purple-900 dark:text-purple-100">{money(invoice.net_payable)}</p>
              </div>
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 border border-green-100 dark:border-green-800">
                <p className="text-xs text-green-600 dark:text-green-400">Settled</p>
                <p className="text-lg font-bold text-green-900 dark:text-green-100">{money(invoice.amount_settled)}</p>
              </div>
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3 border border-amber-100 dark:border-amber-800">
                <p className="text-xs text-amber-600 dark:text-amber-400">Balance Due</p>
                <p className="text-lg font-bold text-amber-900 dark:text-amber-100">{money(invoice.balance_due)}</p>
              </div>
            </div>
          </div>

          {/* MDR breakdown */}
          {invoice.breakdown?.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2"><Receipt className="w-4 h-4 text-gray-400" /> MDR Breakdown by Card Type</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-900 text-xs text-gray-500 uppercase">
                      <th className="px-4 py-2 text-left font-semibold">Mode</th>
                      <th className="px-4 py-2 text-left font-semibold">Card Type</th>
                      <th className="px-4 py-2 text-left font-semibold">Brand</th>
                      <th className="px-4 py-2 text-right font-semibold">Txns</th>
                      <th className="px-4 py-2 text-right font-semibold">Gross</th>
                      <th className="px-4 py-2 text-right font-semibold">MDR</th>
                      <th className="px-4 py-2 text-right font-semibold">Net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {invoice.breakdown.map((b, i) => (
                      <tr key={i} className="text-gray-700 dark:text-gray-300">
                        <td className="px-4 py-2">{b.payment_mode}</td>
                        <td className="px-4 py-2">{b.card_type}</td>
                        <td className="px-4 py-2">{b.card_brand}</td>
                        <td className="px-4 py-2 text-right">{b.txn_count}</td>
                        <td className="px-4 py-2 text-right">{money(b.gross)}</td>
                        <td className="px-4 py-2 text-right">{money(b.mdr)}</td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900 dark:text-white">{money(b.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 dark:bg-gray-900 font-semibold text-gray-900 dark:text-white">
                      <td className="px-4 py-2" colSpan={3}>Total</td>
                      <td className="px-4 py-2 text-right">{invoice.txn_count}</td>
                      <td className="px-4 py-2 text-right">{money(invoice.transaction_value)}</td>
                      <td className="px-4 py-2 text-right">{money(invoice.service_charge)}</td>
                      <td className="px-4 py-2 text-right">{money(invoice.net_payable)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Settlement timeline */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2"><Wallet className="w-4 h-4 text-gray-400" /> Settlement Log</h2>
              {canSettle && (
                <button onClick={() => setShowSettle(true)} className="flex items-center gap-1 px-2.5 py-1 text-xs bg-primary-600 text-white rounded-lg hover:bg-primary-700">
                  <Plus className="w-3.5 h-3.5" /> Add
                </button>
              )}
            </div>
            {invoice.settlements.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                {invoice.status === 'draft' ? 'Issue the invoice to start recording settlements.' : 'No settlements recorded yet.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-900 text-xs text-gray-500 uppercase">
                      <th className="px-4 py-2 text-left font-semibold">Date</th>
                      <th className="px-4 py-2 text-right font-semibold">Amount</th>
                      <th className="px-4 py-2 text-left font-semibold">Method</th>
                      <th className="px-4 py-2 text-left font-semibold">Account / Where</th>
                      <th className="px-4 py-2 text-left font-semibold">UTR / Ref</th>
                      <th className="px-4 py-2 text-left font-semibold">Recorded By</th>
                      <th className="px-4 py-2 text-center font-semibold"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {invoice.settlements.map((s) => (
                      <tr key={s.id} className="text-gray-700 dark:text-gray-300">
                        <td className="px-4 py-2 whitespace-nowrap">{fmtDate(s.settled_on)}</td>
                        <td className="px-4 py-2 text-right font-semibold text-green-600 dark:text-green-400">{money(s.amount)}</td>
                        <td className="px-4 py-2">
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">{METHOD_LABELS[s.method] || s.method}</span>
                        </td>
                        <td className="px-4 py-2">{s.bank_account || '—'}</td>
                        <td className="px-4 py-2 font-mono text-xs">{s.utr_reference || '—'}</td>
                        <td className="px-4 py-2 text-xs text-gray-500">{s.recorded_by || '—'}</td>
                        <td className="px-4 py-2 text-center">
                          {s.reference_type !== 'partner_wallet_ledger' && (
                            <button onClick={() => deleteSettlement(s.id)} className="text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {invoice.notes && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow border border-gray-200 dark:border-gray-700 p-5">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Notes</h2>
              <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">{invoice.notes}</p>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showSettle && (
          <RecordSettlementModal
            invoiceId={invoice.id}
            balanceDue={Number(invoice.balance_due)}
            onClose={() => setShowSettle(false)}
            onSaved={() => { setShowSettle(false); fetchInvoice() }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Record Settlement Modal ─────────────────────────────────────────────────
function RecordSettlementModal({
  invoiceId, balanceDue, onClose, onSaved,
}: { invoiceId: string; balanceDue: number; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(balanceDue > 0 ? String(balanceDue) : '')
  const [settledOn, setSettledOn] = useState(new Date().toISOString().split('T')[0])
  const [method, setMethod] = useState('bank_transfer')
  const [bankAccount, setBankAccount] = useState('')
  const [utr, setUtr] = useState('')
  const [note, setNote] = useState('')
  const [pushToWallet, setPushToWallet] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setError('')
    setSaving(true)
    try {
      const res = await apiFetch(`/api/admin/partner-invoices/${invoiceId}/settlements`, {
        method: 'POST',
        body: JSON.stringify({
          amount: parseFloat(amount),
          settled_on: settledOn,
          method,
          bank_account: bankAccount || null,
          utr_reference: utr || null,
          note: note || null,
          push_to_wallet: method === 'wallet_push' ? pushToWallet : false,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to record settlement')
      onSaved()
    } catch (e: any) {
      setError(e.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Record Settlement</h2>
            <p className="text-xs text-gray-500 mt-0.5">Balance due: {money(balanceDue)}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg"><X className="w-5 h-5 text-gray-500" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Amount (₹)</label>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} min="0" step="0.01"
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Settled On</label>
              <input type="date" value={settledOn} onChange={(e) => setSettledOn(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Method (How)</label>
            <select value={method} onChange={(e) => setMethod(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
              <option value="bank_transfer">Bank Transfer</option>
              <option value="wallet_push">Wallet Push</option>
              <option value="upi">UPI</option>
              <option value="cash">Cash</option>
              <option value="adjustment">Adjustment</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Account / Where</label>
            <input type="text" value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} placeholder="Bank a/c, wallet, UPI id..."
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">UTR / Reference</label>
            <input type="text" value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="UTR / transaction ref"
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Note</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white" />
          </div>

          {method === 'wallet_push' && (
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 bg-blue-50 dark:bg-blue-900/20 rounded-lg px-3 py-2 border border-blue-100 dark:border-blue-800">
              <input type="checkbox" checked={pushToWallet} onChange={(e) => setPushToWallet(e.target.checked)} className="rounded" />
              Also credit the partner wallet now (in-system)
            </label>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
          <button onClick={save} disabled={saving || !amount} className="flex items-center gap-2 px-4 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Save Settlement
          </button>
        </div>
      </motion.div>
    </div>
  )
}
