'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'
import { IndianRupee, Calendar, CreditCard, RefreshCw, Repeat, Package, ArrowUpRight, History } from 'lucide-react'
import { motion } from 'framer-motion'

interface Subscription {
  id: string; user_id: string; user_role: string; pos_machine_count: number; monthly_amount: number; next_billing_date: string; billing_day?: number; auto_debit_enabled: boolean; status: string
}
interface Item {
  id: string; reference_id: string; retailer_rate: number; gst_percent: number; subscription_products?: { name: string }
}
interface DebitRow {
  id: string; amount: number; base_amount: number; gst_amount: number; item_count: number; billing_period_start: string; billing_period_end: string; status: string; created_at: string
}
interface CommissionRow {
  id: string; amount: number; beneficiary_role: string; item_count: number; status: string; created_at: string
}
interface HistoryRow {
  id: string; activity_type: string; activity_description: string; user_id: string; user_role: string; status: string; created_at: string
}

export default function PartnerSubscriptionsTab() {
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [debits, setDebits] = useState<DebitRow[]>([])
  const [commissions, setCommissions] = useState<CommissionRow[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/partner/subscriptions')
      const data = await res.json()
      setSubscription(data.subscription || null)
      setItems(data.items || [])
      setDebits(data.debits || [])
      setCommissions(data.commissions || [])
      setHistory(data.history || [])
    } catch (e) {
      console.error('Failed to load subscriptions', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  if (loading) return <div className="p-6 flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-gray-400" /></div>

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2"><Repeat className="w-5 h-5" /> Subscriptions</h2>
        <button onClick={fetchData} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {!subscription ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 text-center text-gray-500">
          No active subscription. Charges are based on the number of products assigned to you.
        </div>
      ) : (
        <>
          {/* Overview */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 font-medium flex items-center gap-2"><CreditCard className="w-4 h-4" /> Current subscription</div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <div><p className="text-xs text-gray-500">Items</p><p className="font-medium">{subscription.pos_machine_count}</p></div>
              <div><p className="text-xs text-gray-500">Monthly total (incl GST)</p><p className="font-medium flex items-center gap-1"><IndianRupee className="w-4 h-4" />{Number(subscription.monthly_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p></div>
              <div><p className="text-xs text-gray-500">Billing day</p><p className="font-medium flex items-center gap-1"><Calendar className="w-4 h-4" />{subscription.billing_day || 1} of every month</p></div>
              <div><p className="text-xs text-gray-500">Next auto-debit</p><p className="font-medium">{subscription.next_billing_date}</p></div>
              <div><p className="text-xs text-gray-500">Auto-debit</p><p className="font-medium">{subscription.auto_debit_enabled ? 'Enabled' : 'Disabled'} · {subscription.status}</p></div>
            </div>
          </div>

          {/* Items */}
          {items.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 font-medium flex items-center gap-2"><Package className="w-4 h-4" /> Subscribed items</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-gray-50 dark:bg-gray-900/50"><th className="text-left p-3">Product</th><th className="text-left p-3">Reference</th><th className="text-right p-3">Rate</th><th className="text-right p-3">GST</th><th className="text-right p-3">Total/month</th></tr></thead>
                  <tbody>{items.map((it) => {
                    const gst = Number(it.retailer_rate) * Number(it.gst_percent) / 100
                    return (
                      <tr key={it.id} className="border-t border-gray-100 dark:border-gray-700">
                        <td className="p-3">{it.subscription_products?.name || '-'}</td>
                        <td className="p-3 font-mono text-xs">{it.reference_id || '-'}</td>
                        <td className="p-3 text-right">₹{Number(it.retailer_rate).toLocaleString('en-IN')}</td>
                        <td className="p-3 text-right">₹{gst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        <td className="p-3 text-right font-medium">₹{(Number(it.retailer_rate) + gst).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    )
                  })}</tbody>
                </table>
              </div>
            </div>
          )}

          {/* Debit history */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 font-medium">Debit history</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 dark:bg-gray-900/50"><th className="text-left p-3">Date</th><th className="text-right p-3">Base</th><th className="text-right p-3">GST</th><th className="text-right p-3">Total</th><th className="text-center p-3">Items</th><th className="text-left p-3">Period</th><th className="text-center p-3">Status</th></tr></thead>
                <tbody>{debits.map((d) => (
                  <tr key={d.id} className="border-t border-gray-100 dark:border-gray-700">
                    <td className="p-3">{new Date(d.created_at).toLocaleDateString('en-IN')}</td>
                    <td className="p-3 text-right">₹{Number(d.base_amount || 0).toLocaleString('en-IN')}</td>
                    <td className="p-3 text-right">₹{Number(d.gst_amount || 0).toLocaleString('en-IN')}</td>
                    <td className="p-3 text-right font-medium">₹{Number(d.amount).toLocaleString('en-IN')}</td>
                    <td className="p-3 text-center">{d.item_count || 0}</td>
                    <td className="p-3">{d.billing_period_start} – {d.billing_period_end}</td>
                    <td className="p-3 text-center"><span className={d.status === 'completed' ? 'text-green-600' : d.status === 'failed' || d.status === 'insufficient_balance' ? 'text-red-600' : 'text-gray-500'}>{d.status}</span></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            {debits.length === 0 && <p className="p-4 text-gray-500 text-sm text-center">No debit history yet.</p>}
          </div>

          {/* Commissions (for distributors/MDs) */}
          {commissions.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 font-medium flex items-center gap-2"><ArrowUpRight className="w-4 h-4 text-green-500" /> POS rental commissions earned</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-gray-50 dark:bg-gray-900/50"><th className="text-left p-3">Date</th><th className="text-right p-3">Amount</th><th className="text-center p-3">Items</th><th className="text-center p-3">Status</th></tr></thead>
                  <tbody>{commissions.map((c) => (
                    <tr key={c.id} className="border-t border-gray-100 dark:border-gray-700">
                      <td className="p-3">{new Date(c.created_at).toLocaleDateString('en-IN')}</td>
                      <td className="p-3 text-right font-medium text-green-600">₹{Number(c.amount).toLocaleString('en-IN')}</td>
                      <td className="p-3 text-center">{c.item_count}</td>
                      <td className="p-3 text-center">{c.status}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}

          {/* Subscription Change History */}
          {history.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 font-medium flex items-center gap-2"><History className="w-4 h-4" /> Subscription Activity</div>
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0"><tr className="bg-gray-50 dark:bg-gray-900/50"><th className="text-left p-3">Date</th><th className="text-left p-3">Action</th><th className="text-left p-3">Description</th><th className="text-center p-3">Status</th></tr></thead>
                  <tbody>{history.map((h) => (
                    <tr key={h.id} className="border-t border-gray-100 dark:border-gray-700">
                      <td className="p-3 text-xs text-gray-500 whitespace-nowrap">{new Date(h.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="p-3 text-xs font-medium whitespace-nowrap">{h.activity_type.replace(/_/g, ' ')}</td>
                      <td className="p-3 text-xs text-gray-600 dark:text-gray-400">{h.activity_description}</td>
                      <td className="p-3 text-center"><span className={`text-xs ${h.status === 'success' ? 'text-green-600' : 'text-red-600'}`}>{h.status}</span></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </motion.div>
  )
}
