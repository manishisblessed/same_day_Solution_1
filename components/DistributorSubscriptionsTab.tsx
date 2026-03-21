'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'
import {
  RefreshCw, CreditCard, Monitor, CalendarDays, IndianRupee,
  UserPlus, Repeat, Package, X, History, Calendar, ArrowUpRight
} from 'lucide-react'
import { motion } from 'framer-motion'

interface RetailerRow {
  partner_id: string
  name: string
  email?: string
  status: string
  subscription: {
    monthly_amount: number
    pos_machine_count: number
    next_billing_date: string
    billing_day?: number
    status: string
  } | null
}
interface PosMachine {
  id: string
  machine_id: string
  serial_number?: string
  brand?: string
  machine_type?: string
  status?: string
  inventory_status?: string
}

interface HistoryRow { id: string; activity_type: string; activity_description: string; user_id: string; user_role: string; status: string; created_at: string }
interface MySubscription { id: string; user_id: string; user_role: string; pos_machine_count: number; monthly_amount: number; next_billing_date: string; billing_day?: number; auto_debit_enabled: boolean; status: string }
interface MySubItem { id: string; reference_id: string; distributor_rate: number; gst_percent: number; subscription_products?: { name: string } }
interface DebitRow { id: string; amount: number; base_amount: number; gst_amount: number; item_count: number; billing_period_start: string; billing_period_end: string; status: string; created_at: string }
interface CommissionRow { id: string; amount: number; beneficiary_role: string; item_count: number; status: string; created_at: string }

export default function DistributorSubscriptionsTab() {
  const [retailers, setRetailers] = useState<RetailerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [history, setHistory] = useState<HistoryRow[]>([])

  // My own subscription (assigned by MD/admin)
  const [mySub, setMySub] = useState<MySubscription | null>(null)
  const [myItems, setMyItems] = useState<MySubItem[]>([])
  const [myDebits, setMyDebits] = useState<DebitRow[]>([])
  const [myCommissions, setMyCommissions] = useState<CommissionRow[]>([])

  const [manageRetId, setManageRetId] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupMachines, setLookupMachines] = useState<PosMachine[]>([])
  const [lookupExistingSub, setLookupExistingSub] = useState<any>(null)
  const [lookupExistingRate, setLookupExistingRate] = useState<any>(null)
  const [lookupDone, setLookupDone] = useState(false)
  const [subRate, setSubRate] = useState('')
  const [subGst, setSubGst] = useState('18')
  const [subBillingDay, setSubBillingDay] = useState('1')
  const [creatingSubscription, setCreatingSubscription] = useState(false)
  const [showManagePanel, setShowManagePanel] = useState(false)

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  const fetchRetailers = useCallback(async () => {
    setLoading(true)
    try {
      const [retRes, mySubRes] = await Promise.all([
        apiFetch('/api/distributor/subscriptions/retailers'),
        apiFetch('/api/partner/subscriptions'),
      ])
      const [retData, mySubData] = await Promise.all([retRes.json(), mySubRes.json()])
      if (retData.error) throw new Error(retData.error)
      setRetailers(retData.retailers || [])
      setMySub(mySubData.subscription || null)
      setMyItems(mySubData.items || [])
      setMyDebits(mySubData.debits || [])
      setMyCommissions(mySubData.commissions || [])
      setHistory(mySubData.history || [])
    } catch (e: any) {
      showMsg('error', e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchRetailers() }, [fetchRetailers])

  const startManage = (retId: string) => {
    setManageRetId(retId)
    setLookupDone(false)
    setLookupMachines([])
    setLookupExistingSub(null)
    setLookupExistingRate(null)
    setShowManagePanel(true)
    doLookup(retId)
  }

  const doLookup = async (retailerId: string) => {
    if (!retailerId) return
    setLookupLoading(true)
    try {
      const res = await apiFetch(`/api/distributor/subscriptions/retailer-machines?retailer_id=${encodeURIComponent(retailerId)}`)
      const data = await res.json()
      if (data.error) { showMsg('error', data.error); return }
      setLookupMachines(data.machines || [])
      setLookupExistingSub(data.existingSubscription || null)
      setLookupExistingRate(data.existingRate || null)
      if (data.existingRate) {
        setSubRate(String(data.existingRate.rate_per_unit))
        setSubGst(String(data.existingRate.gst_percent))
      }
      if (data.existingSubscription?.billing_day) {
        setSubBillingDay(String(data.existingSubscription.billing_day))
      }
      setLookupDone(true)
    } catch (e: any) { showMsg('error', e.message) } finally { setLookupLoading(false) }
  }

  const handleCreateSubscription = async () => {
    if (!manageRetId || !subRate) { showMsg('error', 'Enter a rate per machine'); return }
    setCreatingSubscription(true)
    try {
      const res = await apiFetch('/api/distributor/subscriptions/create-for-retailer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          retailer_id: manageRetId,
          rate_per_unit: parseFloat(subRate),
          gst_percent: parseFloat(subGst) || 18,
          billing_day: parseInt(subBillingDay) || 1,
        }),
      })
      const data = await res.json()
      if (data.success) {
        showMsg('success', `Subscription saved. ${data.machines_total} machines, monthly ₹${data.monthly_amount}`)
        fetchRetailers()
        doLookup(manageRetId)
      } else {
        showMsg('error', data.error || 'Failed')
      }
    } catch (e: any) { showMsg('error', e.message) } finally { setCreatingSubscription(false) }
  }

  const selectedRet = retailers.find((r) => r.partner_id === manageRetId)

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <RefreshCw className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    )
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-4 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <Repeat className="w-5 h-5 text-purple-500" /> Retailer Subscriptions
        </h2>
        {message && (
          <p className={`text-sm px-3 py-1.5 rounded-lg ${message.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>
            {message.text}
          </p>
        )}
        <button onClick={fetchRetailers} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* ============ MY SUBSCRIPTION (assigned by MD/admin) ============ */}
      {mySub && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border-2 border-purple-200 dark:border-purple-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20 font-medium flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-purple-600" /> My Subscription (assigned to you)
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div><p className="text-xs text-gray-500">Machines</p><p className="font-medium">{mySub.pos_machine_count}</p></div>
            <div><p className="text-xs text-gray-500">Monthly (incl GST)</p><p className="font-medium flex items-center gap-1"><IndianRupee className="w-4 h-4" />{Number(mySub.monthly_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p></div>
            <div><p className="text-xs text-gray-500">Billing day</p><p className="font-medium flex items-center gap-1"><Calendar className="w-4 h-4" />{mySub.billing_day || 1} of every month</p></div>
            <div><p className="text-xs text-gray-500">Next auto-debit</p><p className="font-medium">{mySub.next_billing_date}</p></div>
            <div><p className="text-xs text-gray-500">Status</p><p className="font-medium">{mySub.auto_debit_enabled ? 'Auto-debit on' : 'Auto-debit off'} · <span className={mySub.status === 'active' ? 'text-green-600' : mySub.status === 'paused' ? 'text-yellow-600' : 'text-red-600'}>{mySub.status}</span></p></div>
          </div>

          {myItems.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700">
              <div className="px-4 py-2 text-xs font-medium text-gray-500 bg-gray-50 dark:bg-gray-900/30 flex items-center gap-2"><Package className="w-3 h-3" /> Subscribed items</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-gray-50 dark:bg-gray-900/50"><th className="text-left p-3">Product</th><th className="text-left p-3">Machine</th><th className="text-right p-3">Rate</th><th className="text-right p-3">GST</th><th className="text-right p-3">Total/mo</th></tr></thead>
                  <tbody>{myItems.map((it) => {
                    const rate = Number(it.distributor_rate) || 0
                    const gst = rate * Number(it.gst_percent) / 100
                    return (
                      <tr key={it.id} className="border-t border-gray-100 dark:border-gray-700">
                        <td className="p-3">{it.subscription_products?.name || 'POS Machine'}</td>
                        <td className="p-3 font-mono text-xs">{it.reference_id || '-'}</td>
                        <td className="p-3 text-right">₹{rate.toLocaleString('en-IN')}</td>
                        <td className="p-3 text-right">₹{gst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                        <td className="p-3 text-right font-medium">₹{(rate + gst).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    )
                  })}</tbody>
                </table>
              </div>
            </div>
          )}

          {myDebits.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700">
              <div className="px-4 py-2 text-xs font-medium text-gray-500 bg-gray-50 dark:bg-gray-900/30">Debit history</div>
              <div className="overflow-x-auto max-h-48 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0"><tr className="bg-gray-50 dark:bg-gray-900/50"><th className="text-left p-3">Date</th><th className="text-right p-3">Base</th><th className="text-right p-3">GST</th><th className="text-right p-3">Total</th><th className="text-center p-3">Items</th><th className="text-left p-3">Period</th><th className="text-center p-3">Status</th></tr></thead>
                  <tbody>{myDebits.map((d) => (
                    <tr key={d.id} className="border-t border-gray-100 dark:border-gray-700">
                      <td className="p-3 text-xs">{new Date(d.created_at).toLocaleDateString('en-IN')}</td>
                      <td className="p-3 text-right">₹{Number(d.base_amount || 0).toLocaleString('en-IN')}</td>
                      <td className="p-3 text-right">₹{Number(d.gst_amount || 0).toLocaleString('en-IN')}</td>
                      <td className="p-3 text-right font-medium">₹{Number(d.amount).toLocaleString('en-IN')}</td>
                      <td className="p-3 text-center">{d.item_count || 0}</td>
                      <td className="p-3 text-xs">{d.billing_period_start} – {d.billing_period_end}</td>
                      <td className="p-3 text-center"><span className={d.status === 'completed' ? 'text-green-600' : d.status === 'failed' || d.status === 'insufficient_balance' ? 'text-red-600' : 'text-gray-500'}>{d.status}</span></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}

          {myCommissions.length > 0 && (
            <div className="border-t border-gray-200 dark:border-gray-700">
              <div className="px-4 py-2 text-xs font-medium text-gray-500 bg-gray-50 dark:bg-gray-900/30 flex items-center gap-2"><ArrowUpRight className="w-3 h-3 text-green-500" /> POS rental commissions earned</div>
              <div className="overflow-x-auto max-h-48 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0"><tr className="bg-gray-50 dark:bg-gray-900/50"><th className="text-left p-3">Date</th><th className="text-right p-3">Amount</th><th className="text-center p-3">Items</th><th className="text-center p-3">Status</th></tr></thead>
                  <tbody>{myCommissions.map((c) => (
                    <tr key={c.id} className="border-t border-gray-100 dark:border-gray-700">
                      <td className="p-3 text-xs">{new Date(c.created_at).toLocaleDateString('en-IN')}</td>
                      <td className="p-3 text-right font-medium text-green-600">₹{Number(c.amount).toLocaleString('en-IN')}</td>
                      <td className="p-3 text-center">{c.item_count}</td>
                      <td className="p-3 text-center">{c.status}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-4 text-sm text-purple-800 dark:text-purple-200 border border-purple-200 dark:border-purple-800">
        <p className="font-medium mb-1">How this works</p>
        <ol className="list-decimal ml-4 space-y-0.5">
          <li>Assign POS machines to a retailer from the <strong>POS Machines</strong> tab (Assign → Retailer).</li>
          <li>Here, click <strong>Manage</strong> for that retailer to set their rental rate and billing day, then create/update their subscription.</li>
          <li>They will be charged monthly on the billing day from their wallet; you earn commission on the margin.</li>
        </ol>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 font-medium flex items-center gap-2">
          <Package className="w-4 h-4 text-purple-500" /> Your retailers
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-900/50">
                <th className="text-left p-3">Retailer</th>
                <th className="text-left p-3">ID</th>
                <th className="text-right p-3">Subscription</th>
                <th className="text-right p-3">Monthly</th>
                <th className="text-center p-3">Next billing</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {retailers.map((r) => (
                <tr key={r.partner_id} className="border-t border-gray-100 dark:border-gray-700">
                  <td className="p-3 font-medium">{r.name}</td>
                  <td className="p-3 font-mono text-xs">{r.partner_id}</td>
                  <td className="p-3 text-right">
                    {r.subscription ? (
                      <span className="text-green-600 dark:text-green-400">{r.subscription.pos_machine_count} machines · {r.subscription.status}</span>
                    ) : (
                      <span className="text-gray-500">No subscription</span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    {r.subscription ? `₹${Number(r.subscription.monthly_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'}
                  </td>
                  <td className="p-3 text-center">{r.subscription?.next_billing_date || '—'}</td>
                  <td className="p-3">
                    <button
                      onClick={() => startManage(r.partner_id)}
                      className="text-purple-600 dark:text-purple-400 hover:underline font-medium text-sm"
                    >
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {retailers.length === 0 && (
          <p className="p-4 text-gray-500 text-sm text-center">No retailers in your network yet.</p>
        )}
      </div>

      {/* Subscription Activity History */}
      {history.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <History className="w-4 h-4 text-purple-500" /> <span className="font-medium">Subscription Activity</span>
          </div>
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

      {showManagePanel && manageRetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowManagePanel(false)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
          >
            <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-purple-50 dark:bg-purple-900/20">
              <h3 className="font-semibold text-purple-800 dark:text-purple-200 flex items-center gap-2">
                <UserPlus className="w-4 h-4" /> Subscription for {selectedRet?.name || manageRetId}
              </h3>
              <button onClick={() => setShowManagePanel(false)} className="p-1 rounded hover:bg-purple-100 dark:hover:bg-purple-900/40"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 overflow-y-auto space-y-4">
              {lookupLoading ? (
                <div className="flex justify-center py-8"><RefreshCw className="w-8 h-8 animate-spin text-purple-500" /></div>
              ) : lookupDone ? (
                <>
                  {lookupExistingSub && (
                    <div className="flex items-center gap-2 text-sm bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 px-3 py-2 rounded-lg">
                      <CreditCard className="w-4 h-4" />
                      Existing: ₹{Number(lookupExistingSub.monthly_amount).toLocaleString('en-IN')}/mo, {lookupExistingSub.pos_machine_count} machines, billing day {lookupExistingSub.billing_day || 1}
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                      <Monitor className="w-4 h-4" /> POS machines assigned to this retailer
                      <span className="ml-auto text-gray-500">{lookupMachines.length} machine(s)</span>
                    </p>
                    {lookupMachines.length === 0 ? (
                      <p className="text-sm text-gray-500 italic">No machines yet. Assign machines from the POS Machines tab first.</p>
                    ) : (
                      <div className="overflow-x-auto border rounded-lg dark:border-gray-700 max-h-48 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 dark:bg-gray-900/50">
                            <tr>
                              <th className="text-left p-2">Machine ID</th>
                              <th className="text-left p-2">Brand</th>
                              <th className="text-left p-2">Type</th>
                              <th className="text-center p-2">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lookupMachines.map((m) => (
                              <tr key={m.id} className="border-t border-gray-100 dark:border-gray-700">
                                <td className="p-2 font-mono">{m.machine_id}</td>
                                <td className="p-2">{m.brand || '-'}</td>
                                <td className="p-2">{m.machine_type || '-'}</td>
                                <td className="p-2 text-center">{m.status || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                  {lookupMachines.length > 0 && (
                    <div className="bg-gray-50 dark:bg-gray-900/30 rounded-lg p-4 space-y-3">
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2"><IndianRupee className="w-4 h-4" /> Rate & billing</p>
                      <div className="flex flex-wrap gap-3 items-end">
                        <div className="w-36">
                          <label className="text-xs text-gray-500 block mb-1">Rate/machine (excl GST)</label>
                          <input value={subRate} onChange={(e) => setSubRate(e.target.value)} type="number" className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600" placeholder="e.g. 499" />
                        </div>
                        <div className="w-20">
                          <label className="text-xs text-gray-500 block mb-1">GST %</label>
                          <input value={subGst} onChange={(e) => setSubGst(e.target.value)} type="number" className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600" />
                        </div>
                        <div className="w-32">
                          <label className="text-xs text-gray-500 block mb-1 flex items-center gap-1"><CalendarDays className="w-3 h-3" /> Billing day (1-28)</label>
                          <input value={subBillingDay} onChange={(e) => setSubBillingDay(e.target.value)} type="number" min={1} max={28} className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600" />
                        </div>
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          {subRate && (
                            <p>Monthly total: <strong className="text-purple-600">₹{(lookupMachines.length * parseFloat(subRate) * (1 + (parseFloat(subGst) || 18) / 100)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> (incl GST)</p>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={handleCreateSubscription}
                        disabled={creatingSubscription || !subRate}
                        className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-purple-700"
                      >
                        <CreditCard className="w-4 h-4" /> {creatingSubscription ? 'Saving...' : lookupExistingSub ? 'Update subscription' : 'Create subscription'}
                      </button>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  )
}
