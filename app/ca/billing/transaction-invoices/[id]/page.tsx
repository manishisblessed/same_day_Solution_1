'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter, useParams } from 'next/navigation'
import { motion } from 'framer-motion'
import {
  ArrowLeft, Loader2, FileText, Download,
  CheckCircle, AlertCircle, IndianRupee,
} from 'lucide-react'
import { apiFetch } from '@/lib/api-client'
import Link from 'next/link'
import ExportDropdown, { type ExportFormat, downloadBlob } from '@/components/ExportDropdown'

const INR = (n: number) =>
  '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const pct = (n: number) => `${Number(n).toFixed(2)}%`

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-amber-100 text-amber-700',
  issued: 'bg-blue-100 text-blue-700',
  filed: 'bg-emerald-100 text-emerald-700',
  void: 'bg-red-100 text-red-700',
}

export default function InvoiceDetailPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [invoice, setInvoice] = useState<any>(null)
  const [fetching, setFetching] = useState(true)
  const [exporting, setExporting] = useState<ExportFormat | null>(null)
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  useEffect(() => {
    if (!loading && user?.role !== 'ca_executive') router.push('/ca/login')
  }, [user, loading, router])

  useEffect(() => {
    if (!id || user?.role !== 'ca_executive') return
    const fetchInvoice = async () => {
      try {
        const res = await apiFetch(`/api/ca/transaction-invoices/${id}`)
        const data = await res.json()
        if (data.success) setInvoice(data.invoice)
      } catch { /* ignore */ }
      finally { setFetching(false) }
    }
    fetchInvoice()
  }, [id, user])

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  const handleExport = async (format: ExportFormat) => {
    setExporting(format)
    try {
      const res = await apiFetch(`/api/ca/transaction-invoices/${id}/export?format=${format}`)
      const blob = await res.blob()
      const ext = format === 'pdf' ? 'pdf' : format === 'excel' ? 'xls' : 'csv'
      downloadBlob(blob, `${invoice?.invoice_number || 'invoice'}.${ext}`)
    } catch {
      alert('Export failed')
    } finally {
      setExporting(null)
    }
  }

  const handleStatusChange = async (status: string) => {
    setUpdatingStatus(true)
    try {
      const res = await apiFetch(`/api/ca/transaction-invoices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const data = await res.json()
      if (!data.success) { showToast(data.error || 'Update failed', 'error'); return }
      setInvoice({ ...invoice, status })
      showToast(`Status updated to ${status}`)
    } catch {
      showToast('Update failed', 'error')
    } finally {
      setUpdatingStatus(false)
    }
  }

  if (loading || !user || user.role !== 'ca_executive') {
    return <div className="flex justify-center mt-16"><Loader2 className="w-8 h-8 animate-spin text-violet-600" /></div>
  }

  if (fetching) {
    return <div className="flex justify-center mt-16"><Loader2 className="w-6 h-6 animate-spin text-violet-500" /></div>
  }

  if (!invoice) {
    return (
      <div className="text-center py-16">
        <FileText className="w-10 h-10 mx-auto mb-2 text-gray-300" />
        <p className="text-gray-500">Invoice not found.</p>
        <Link href="/ca/billing/transaction-invoices" className="mt-3 text-sm text-violet-600 hover:underline inline-block">← Back to invoices</Link>
      </div>
    )
  }

  const breakdown: any[] = invoice.breakdown || []

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="max-w-4xl space-y-6">
      {toast && (
        <div className={`fixed top-20 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-white text-sm font-medium ${toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
          {toast.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/ca/billing/transaction-invoices" className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">{invoice.invoice_number}</h1>
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[invoice.status] || 'bg-gray-100 text-gray-600'}`}>
                {invoice.status}
              </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
              {invoice.brands?.name} · {invoice.period_start} to {invoice.period_end}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Status change */}
          <select value={invoice.status} onChange={(e) => handleStatusChange(e.target.value)} disabled={updatingStatus}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-violet-500 outline-none disabled:opacity-60">
            <option value="draft">Draft</option>
            <option value="issued">Issued</option>
            <option value="filed">Filed ✓</option>
            <option value="void">Void</option>
          </select>
          <ExportDropdown formats={['pdf', 'excel', 'csv']} onExport={handleExport} exporting={exporting} />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Transaction Value', value: INR(invoice.total_transaction_value), color: 'text-gray-900 dark:text-white' },
          { label: 'Bank MDR Total', value: INR(invoice.bank_mdr_total), color: 'text-red-600 dark:text-red-400' },
          { label: `Margin (${pct(invoice.margin_percent)})`, value: INR(invoice.margin_amount), color: 'text-orange-600 dark:text-orange-400' },
          { label: 'Service Charge Total', value: INR(invoice.service_charge_total), color: 'text-blue-700 dark:text-blue-300' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</p>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* GST Summary highlight card */}
      <div className="bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <IndianRupee className="w-5 h-5 text-violet-600" />
          <h2 className="font-bold text-violet-900 dark:text-violet-300">GST Output Tax (GSTR-1 Filing)</h2>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-violet-600 dark:text-violet-400 mb-1">Service Charge (Taxable Value)</p>
            <p className="text-2xl font-bold text-violet-900 dark:text-violet-200">{INR(invoice.service_charge_total)}</p>
          </div>
          <div>
            <p className="text-xs text-violet-600 dark:text-violet-400 mb-1">GST @ {pct(invoice.gst_percent)}</p>
            <p className="text-2xl font-bold text-violet-700 dark:text-violet-300">{INR(invoice.gst_amount)}</p>
          </div>
          <div>
            <p className="text-xs text-violet-600 dark:text-violet-400 mb-1">Total with GST</p>
            <p className="text-2xl font-bold text-violet-900 dark:text-violet-100">{INR(invoice.total_with_gst)}</p>
          </div>
        </div>
      </div>

      {/* Per-TID Breakdown */}
      <div>
        <h2 className="text-base font-bold text-gray-900 dark:text-white mb-3">
          Per-TID Breakdown ({invoice.txn_count.toLocaleString('en-IN')} transactions)
        </h2>
        {breakdown.length === 0 ? (
          <p className="text-gray-400 text-sm">No transaction data in this period.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                  {['TID', 'Payment Mode', 'Txn Count', 'Transaction Value', 'Bank MDR %', 'Bank MDR Amount'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {breakdown.map((b: any) => (
                  <tr key={b.tid} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/20">
                    <td className="px-4 py-3 font-mono text-gray-700 dark:text-gray-300">{b.tid}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{b.payment_mode}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{b.txn_count.toLocaleString('en-IN')}</td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{INR(b.transaction_value)}</td>
                    <td className="px-4 py-3 text-violet-700 dark:text-violet-300">{pct(b.bank_mdr_percent)}</td>
                    <td className="px-4 py-3 font-semibold text-red-600 dark:text-red-400">{INR(b.bank_mdr_amount)}</td>
                  </tr>
                ))}
                {/* Totals row */}
                <tr className="bg-gray-50 dark:bg-gray-800/50 border-t-2 border-gray-200 dark:border-gray-700">
                  <td className="px-4 py-3 font-bold text-gray-900 dark:text-white" colSpan={2}>Total</td>
                  <td className="px-4 py-3 font-bold text-gray-900 dark:text-white">{invoice.txn_count.toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 font-bold text-gray-900 dark:text-white">{INR(invoice.total_transaction_value)}</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 font-bold text-red-600 dark:text-red-400">{INR(invoice.bank_mdr_total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Notes */}
      {invoice.notes && (
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Notes</p>
          <p className="text-sm text-gray-700 dark:text-gray-300">{invoice.notes}</p>
        </div>
      )}

      <p className="text-xs text-gray-400">
        Generated {new Date(invoice.generated_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
        {invoice.created_by ? ` by ${invoice.created_by}` : ''}
      </p>
    </motion.div>
  )
}
