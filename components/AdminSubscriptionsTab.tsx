'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'
import {
  RefreshCw, CreditCard, Repeat, ToggleLeft, ToggleRight,
  Play, FileCheck, Users, Clock, Plus, Package, IndianRupee,
  Monitor, CalendarDays, UserPlus, Wallet, Trash2, X, History,
  Eye, Download, ChevronDown, ChevronUp
} from 'lucide-react'
import { motion } from 'framer-motion'

interface Product { id: string; name: string; description?: string; default_gst_percent: number; is_active: boolean }
interface Subscription { id: string; user_id: string; user_role: string; plan_id: string | null; pos_machine_count: number; monthly_amount: number; next_billing_date: string; billing_day?: number; auto_debit_enabled: boolean; status: string; subscription_plans?: any }
interface CronSettings { schedule_hour: number; schedule_minute: number; timezone: string; is_enabled: boolean; last_run_at: string | null; last_run_status: string | null; last_run_message: string | null; last_run_processed: number; last_run_failed: number }
interface PosMachine { id: string; machine_id: string; serial_number?: string; brand?: string; machine_type?: string; status?: string; inventory_status?: string; retailer_id?: string; distributor_id?: string; master_distributor_id?: string }
interface UserOption { partner_id: string; name: string }
interface ActivityLog { id: string; activity_type: string; activity_description: string; user_id: string; user_role: string; status: string; metadata?: any; created_at: string }

export default function AdminSubscriptionsTab() {
  const [products, setProducts] = useState<Product[]>([])
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [cronSettings, setCronSettings] = useState<CronSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [runningDebit, setRunningDebit] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [togglingCron, setTogglingCron] = useState(false)
  const [editCronHour, setEditCronHour] = useState(0)
  const [editCronMinute, setEditCronMinute] = useState(0)
  const [savingCronSchedule, setSavingCronSchedule] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Add product form
  const [showAddProduct, setShowAddProduct] = useState(false)
  const [newProductName, setNewProductName] = useState('')
  const [newProductGst, setNewProductGst] = useState('18')
  const [savingProduct, setSavingProduct] = useState(false)

  // User lookup + add subscription
  const [lookupRole, setLookupRole] = useState('master_distributor')
  const [lookupUserId, setLookupUserId] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupMachines, setLookupMachines] = useState<PosMachine[]>([])
  const [lookupExistingSub, setLookupExistingSub] = useState<any>(null)
  const [lookupExistingRate, setLookupExistingRate] = useState<any>(null)
  const [lookupDone, setLookupDone] = useState(false)
  const [subRate, setSubRate] = useState('')
  const [subGst, setSubGst] = useState('18')
  const [subBillingDay, setSubBillingDay] = useState('1')
  const [creatingSubscription, setCreatingSubscription] = useState(false)
  const [revenueBalance, setRevenueBalance] = useState<{ configured: boolean; balance: number | null; error?: string; message?: string } | null>(null)
  const [revenueStatementOpen, setRevenueStatementOpen] = useState(false)
  const [revenueEntries, setRevenueEntries] = useState<any[]>([])
  const [loadingRevenueStatement, setLoadingRevenueStatement] = useState(false)

  // User dropdown for lookup
  const [lookupUserList, setLookupUserList] = useState<UserOption[]>([])
  const [lookupUsersLoading, setLookupUsersLoading] = useState(false)

  const [togglingProductId, setTogglingProductId] = useState<string | null>(null)
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null)
  const [togglingSubStatusId, setTogglingSubStatusId] = useState<string | null>(null)
  const [deletingSubId, setDeletingSubId] = useState<string | null>(null)
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([])

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 6000)
  }

  const fetchUsersByRole = useCallback(async (role: string) => {
    setLookupUsersLoading(true)
    try {
      const res = await apiFetch(`/api/admin/subscriptions/users-by-role?role=${role}`)
      const data = await res.json()
      setLookupUserList(data.users || [])
    } catch {
      setLookupUserList([])
    } finally {
      setLookupUsersLoading(false)
    }
  }, [])

  const deleteSubscription = async (sub: Subscription) => {
    if (!confirm(`Delete subscription for ${roleLabel(sub.user_role)} ${sub.user_id}? This will remove the subscription and all its items permanently.`)) return
    setDeletingSubId(sub.id)
    try {
      const res = await apiFetch(`/api/admin/subscriptions/${sub.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Delete failed')
      showMsg('success', 'Subscription deleted')
      setSubscriptions((prev) => prev.filter((s) => s.id !== sub.id))
    } catch (e: any) {
      showMsg('error', e.message || 'Delete failed')
    } finally {
      setDeletingSubId(null)
    }
  }

  const toggleProductActive = async (p: Product) => {
    setTogglingProductId(p.id)
    try {
      const res = await apiFetch(`/api/admin/subscriptions/products/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !p.is_active }),
      })
      const data = await res.json()
      if (data.product) {
        setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_active: data.product.is_active } : x)))
        showMsg('success', data.product.is_active ? 'Product enabled' : 'Product disabled')
      } else showMsg('error', data.error || 'Update failed')
    } catch (e: any) {
      showMsg('error', e.message || 'Update failed')
    } finally {
      setTogglingProductId(null)
    }
  }

  const deleteProduct = async (p: Product) => {
    if (!confirm(`Delete "${p.name}"? This will remove all product rates and subscription lines for this product. This cannot be undone.`)) return
    setDeletingProductId(p.id)
    try {
      const res = await apiFetch(`/api/admin/subscriptions/products/${p.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Delete failed')
      showMsg('success', 'Product deleted')
      setProducts((prev) => prev.filter((x) => x.id !== p.id))
      fetchData()
    } catch (e: any) {
      showMsg('error', e.message || 'Delete failed')
    } finally {
      setDeletingProductId(null)
    }
  }

  const setSubscriptionStatus = async (sub: Subscription, status: 'active' | 'paused' | 'cancelled') => {
    setTogglingSubStatusId(sub.id)
    try {
      const res = await apiFetch(`/api/admin/subscriptions/${sub.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      const data = await res.json()
      if (data.subscription) {
        setSubscriptions((prev) => prev.map((s) => (s.id === sub.id ? { ...s, status: data.subscription.status } : s)))
        showMsg('success', `Subscription ${status === 'active' ? 'enabled' : status === 'paused' ? 'paused' : 'cancelled'}`)
      } else showMsg('error', data.error || 'Update failed')
    } catch (e: any) {
      showMsg('error', e.message || 'Update failed')
    } finally {
      setTogglingSubStatusId(null)
    }
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [prodRes, subsRes, cronRes, histRes] = await Promise.all([
        apiFetch('/api/admin/subscriptions/products'),
        apiFetch('/api/admin/subscriptions'),
        apiFetch('/api/admin/subscriptions/cron-settings'),
        apiFetch('/api/admin/subscriptions/history?limit=30'),
      ])
      const [prodData, subsData, cronData, histData] = await Promise.all([prodRes.json(), subsRes.json(), cronRes.json(), histRes.json()])
      if (prodData.products) setProducts(prodData.products)
      if (subsData.subscriptions) setSubscriptions(subsData.subscriptions)
      if (cronData.settings) {
        setCronSettings(cronData.settings)
        setEditCronHour(cronData.settings.schedule_hour)
        setEditCronMinute(cronData.settings.schedule_minute)
      }
      setActivityLogs(histData.logs || [])

      try {
        const revRes = await apiFetch('/api/admin/subscriptions/revenue-balance')
        const revData = await revRes.json()
        setRevenueBalance(revData)
      } catch {
        setRevenueBalance({ configured: false, balance: null })
      }
    } catch (e: any) {
      showMsg('error', e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    fetchUsersByRole(lookupRole)
    setLookupUserId('')
    setLookupDone(false)
  }, [lookupRole, fetchUsersByRole])

  const handleSync = async () => {
    setSyncing(true)
    try {
      const res = await apiFetch('/api/admin/subscriptions/sync', { method: 'POST' })
      const data = await res.json()
      data.success ? showMsg('success', data.message) : showMsg('error', data.error || 'Sync failed')
      fetchData()
    } catch (e: any) { showMsg('error', e.message) } finally { setSyncing(false) }
  }

  const handleRunAutoDebit = async () => {
    setRunningDebit(true)
    try {
      const res = await apiFetch('/api/admin/subscriptions/run-auto-debit', { method: 'POST' })
      const data = await res.json()
      data.success ? showMsg('success', `Completed: ${data.completed}, Failed: ${data.failed}, Commissions: ${data.commissionsCreated || 0}`) : showMsg('error', data.error)
      fetchData()
    } catch (e: any) { showMsg('error', e.message) } finally { setRunningDebit(false) }
  }

  const toggleAutoDebit = async (sub: Subscription) => {
    setTogglingId(sub.id)
    try {
      const res = await apiFetch(`/api/admin/subscriptions/${sub.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_debit_enabled: !sub.auto_debit_enabled }),
      })
      const data = await res.json()
      if (data.subscription) setSubscriptions((prev) => prev.map((s) => (s.id === sub.id ? { ...s, auto_debit_enabled: data.subscription.auto_debit_enabled } : s)))
      else showMsg('error', data.error || 'Update failed')
    } catch (e: any) { showMsg('error', e.message) } finally { setTogglingId(null) }
  }

  const toggleCronEnabled = async () => {
    if (!cronSettings) return
    setTogglingCron(true)
    try {
      const res = await apiFetch('/api/admin/subscriptions/cron-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_enabled: !cronSettings.is_enabled }),
      })
      const data = await res.json()
      if (data.settings) { setCronSettings(data.settings); showMsg('success', data.message) }
      else showMsg('error', data.error)
    } catch (e: any) { showMsg('error', e.message) } finally { setTogglingCron(false) }
  }

  const saveCronSchedule = async () => {
    if (!cronSettings) return
    setSavingCronSchedule(true)
    try {
      const res = await apiFetch('/api/admin/subscriptions/cron-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule_hour: editCronHour, schedule_minute: editCronMinute }),
      })
      const data = await res.json()
      if (data.settings) {
        setCronSettings(data.settings)
        setEditCronHour(data.settings.schedule_hour)
        setEditCronMinute(data.settings.schedule_minute)
        showMsg('success', `Schedule updated to ${String(data.settings.schedule_hour).padStart(2, '0')}:${String(data.settings.schedule_minute).padStart(2, '0')}. Cron picks up changes within 60 seconds.`)
      } else showMsg('error', data.error)
    } catch (e: any) { showMsg('error', e.message) } finally { setSavingCronSchedule(false) }
  }

  const fetchRevenueStatement = async () => {
    setLoadingRevenueStatement(true)
    try {
      const res = await apiFetch('/api/admin/subscriptions/revenue-statement?limit=200')
      const data = await res.json()
      setRevenueEntries(data.entries || [])
    } catch (e: any) { showMsg('error', e.message) } finally { setLoadingRevenueStatement(false) }
  }

  const toggleRevenueStatement = () => {
    if (!revenueStatementOpen) fetchRevenueStatement()
    setRevenueStatementOpen(!revenueStatementOpen)
  }

  const downloadRevenueCSV = () => {
    if (revenueEntries.length === 0) return
    const headers = ['Date', 'Type', 'Description', 'Credit', 'Debit', 'Status']
    const rows = revenueEntries.map(e => [
      new Date(e.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      e.transaction_type || '',
      `"${(e.description || '').replace(/"/g, '""')}"`,
      e.credit || 0,
      e.debit || 0,
      e.status || '',
    ])
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `subscription-revenue-statement-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const addProduct = async () => {
    if (!newProductName.trim()) return
    setSavingProduct(true)
    try {
      const res = await apiFetch('/api/admin/subscriptions/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProductName.trim(), default_gst_percent: parseFloat(newProductGst) || 18 }),
      })
      const data = await res.json()
      if (data.product) { setProducts((p) => [...p, data.product]); setNewProductName(''); setShowAddProduct(false); showMsg('success', 'Product added') }
      else showMsg('error', data.error)
    } catch (e: any) { showMsg('error', e.message) } finally { setSavingProduct(false) }
  }

  // --- User lookup ---
  const handleLookup = async () => {
    if (!lookupUserId.trim()) return
    setLookupLoading(true)
    setLookupDone(false)
    setLookupMachines([])
    setLookupExistingSub(null)
    setLookupExistingRate(null)
    try {
      const res = await apiFetch(`/api/admin/subscriptions/user-machines?user_id=${encodeURIComponent(lookupUserId.trim())}&role=${lookupRole}`)
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
    if (!lookupUserId.trim() || !subRate) { showMsg('error', 'Enter a rate per machine'); return }
    setCreatingSubscription(true)
    try {
      const res = await apiFetch('/api/admin/subscriptions/create-for-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: lookupUserId.trim(),
          user_role: lookupRole,
          rate_per_unit: parseFloat(subRate),
          gst_percent: parseFloat(subGst) || 18,
          billing_day: parseInt(subBillingDay) || 1,
        }),
      })
      const data = await res.json()
      if (data.success) {
        showMsg('success', `Subscription created! ${data.machines_total} machines, ${data.new_items} new items. Monthly: ₹${data.monthly_amount}`)
        fetchData()
        handleLookup()
      } else {
        showMsg('error', data.error || 'Failed')
      }
    } catch (e: any) { showMsg('error', e.message) } finally { setCreatingSubscription(false) }
  }

  const roleLabel = (r: string) => {
    if (r === 'partner') return 'Partner'
    if (r === 'master_distributor') return 'Master Distributor'
    if (r === 'distributor') return 'Distributor'
    return 'Retailer'
  }

  if (loading) return <div className="p-6 flex items-center justify-center"><RefreshCw className="w-8 h-8 animate-spin text-gray-400" /></div>

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-4 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <Repeat className="w-5 h-5" /> Subscriptions & Auto-Debit
        </h2>
        {message && <p className={`text-sm px-3 py-1.5 rounded-lg ${message.type === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>{message.text}</p>}
        <div className="flex gap-2">
          <button onClick={handleSync} disabled={syncing} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 text-sm font-medium">
            <FileCheck className="w-4 h-4" /> {syncing ? 'Syncing...' : 'Sync from POS'}
          </button>
          <button onClick={handleRunAutoDebit} disabled={runningDebit} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-50 text-sm font-medium">
            <Play className="w-4 h-4" /> {runningDebit ? 'Running...' : 'Run auto-debit now'}
          </button>
          <button onClick={fetchData} className="p-2 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600"><RefreshCw className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Subscription revenue wallet (when SUBSCRIPTION_REVENUE_USER_ID is set) */}
      {revenueBalance != null && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="p-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  <Wallet className="w-4 h-4" />
                  Subscription revenue wallet
                </div>
                {revenueBalance.configured ? (
                  revenueBalance.balance != null ? (
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                      ₹{Number(revenueBalance.balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </p>
                  ) : (
                    <p className="text-sm text-amber-600 dark:text-amber-400">{revenueBalance.error || 'Could not fetch balance'}</p>
                  )
                ) : (
                  <p className="text-xs text-gray-500 dark:text-gray-400">{revenueBalance.message}</p>
                )}
              </div>
              {revenueBalance.configured && revenueBalance.balance != null && (
                <div className="flex items-center gap-2">
                  <button onClick={toggleRevenueStatement} className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600">
                    <Eye className="w-4 h-4" />
                    {revenueStatementOpen ? 'Hide' : 'View'} Statement
                    {revenueStatementOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                  {revenueEntries.length > 0 && (
                    <button onClick={downloadRevenueCSV} className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50">
                      <Download className="w-4 h-4" /> CSV
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          {revenueStatementOpen && (
            <div className="border-t border-gray-200 dark:border-gray-700">
              {loadingRevenueStatement ? (
                <div className="p-4 text-center text-gray-500"><RefreshCw className="w-5 h-5 animate-spin inline-block mr-2" />Loading statement...</div>
              ) : revenueEntries.length === 0 ? (
                <div className="p-4 text-center text-gray-500 text-sm">No transactions found</div>
              ) : (
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Type</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Description</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Credit</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Debit</th>
                        <th className="px-3 py-2 text-center text-xs font-medium text-gray-500">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {revenueEntries.map((e: any) => (
                        <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                          <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-600 dark:text-gray-400">
                            {new Date(e.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-xs font-medium">
                            <span className={e.credit > 0 ? 'text-green-600' : 'text-red-600'}>
                              {e.credit > 0 ? (e.transaction_type === 'SUBSCRIPTION_REVENUE' ? 'Revenue (Credit)' : 'Credit') : (e.transaction_type === 'POS_RENTAL_COMMISSION' ? 'Commission Payout' : 'Debit')}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-400 max-w-xs truncate">{e.description}</td>
                          <td className="px-3 py-2 text-right text-xs font-medium text-green-600">{e.credit > 0 ? `₹${Number(e.credit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}</td>
                          <td className="px-3 py-2 text-right text-xs font-medium text-red-600">{e.debit > 0 ? `₹${Number(e.debit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}</td>
                          <td className="px-3 py-2 text-center"><span className={`text-xs px-2 py-0.5 rounded-full ${e.status === 'completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}`}>{e.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ============ ADD / MANAGE SUBSCRIPTION ============ */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border-2 border-primary-200 dark:border-primary-800 overflow-hidden">
        <div className="px-4 py-3 bg-primary-50 dark:bg-primary-900/20 border-b border-primary-200 dark:border-primary-800 flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-primary-600" />
          <span className="font-semibold text-primary-700 dark:text-primary-300">Add / Manage Subscription</span>
        </div>

        {/* Lookup row */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="w-44">
              <label className="text-xs text-gray-500 block mb-1">Role</label>
              <select value={lookupRole} onChange={(e) => setLookupRole(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600">
                <option value="partner">Partner</option>
                <option value="master_distributor">Master Distributor</option>
                <option value="distributor">Distributor</option>
                <option value="retailer">Retailer</option>
              </select>
            </div>
            <div className="flex-1 min-w-[220px]">
              <label className="text-xs text-gray-500 block mb-1">Select {roleLabel(lookupRole)}</label>
              <select
                value={lookupUserId}
                onChange={(e) => { setLookupUserId(e.target.value); setLookupDone(false) }}
                disabled={lookupUsersLoading}
                className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600"
              >
                <option value="">{lookupUsersLoading ? 'Loading...' : `Select ${roleLabel(lookupRole)}`}</option>
                {lookupUserList.map((u) => (
                  <option key={u.partner_id} value={u.partner_id}>{u.name} ({u.partner_id})</option>
                ))}
              </select>
              {!lookupUsersLoading && lookupUserList.length === 0 && (
                <p className="text-xs text-gray-500 mt-0.5">No {roleLabel(lookupRole)}s found.</p>
              )}
            </div>
            <button onClick={handleLookup} disabled={lookupLoading || !lookupUserId} className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-primary-700">
              <CreditCard className="w-4 h-4" /> {lookupLoading ? 'Looking up...' : 'Lookup'}
            </button>
          </div>
        </div>

        {lookupDone && (
          <div className="p-4 space-y-4">
            {/* Existing subscription badge */}
            {lookupExistingSub && (
              <div className="flex items-center gap-2 text-sm bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 px-3 py-2 rounded-lg">
                <CreditCard className="w-4 h-4" />
                Subscription exists — Monthly: ₹{Number(lookupExistingSub.monthly_amount).toLocaleString('en-IN')},
                Machines: {lookupExistingSub.pos_machine_count},
                Billing day: {lookupExistingSub.billing_day || 1},
                Status: {lookupExistingSub.status}
              </div>
            )}

            {/* POS Machines list */}
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                <Monitor className="w-4 h-4" /> POS Machines assigned to {roleLabel(lookupRole)} <span className="font-mono text-xs bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">{lookupUserId}</span>
                <span className="ml-auto text-gray-500">{lookupMachines.length} machine(s)</span>
              </p>
              {lookupMachines.length === 0 ? (
                <p className="text-sm text-gray-500 italic">No POS machines found for this user. Assign machines first in the POS Machines tab.</p>
              ) : (
                <div className="overflow-x-auto border rounded-lg dark:border-gray-700 max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 dark:bg-gray-900/50 sticky top-0">
                      <tr>
                        <th className="text-left p-2">Machine ID</th>
                        <th className="text-left p-2">Serial No</th>
                        <th className="text-left p-2">Brand</th>
                        <th className="text-left p-2">Type</th>
                        <th className="text-center p-2">Status</th>
                        <th className="text-left p-2">Retailer</th>
                        <th className="text-left p-2">Distributor</th>
                        <th className="text-left p-2">MD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lookupMachines.map((m) => (
                        <tr key={m.id} className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                          <td className="p-2 font-mono">{m.machine_id}</td>
                          <td className="p-2">{m.serial_number || '-'}</td>
                          <td className="p-2">{m.brand || '-'}</td>
                          <td className="p-2">{m.machine_type || '-'}</td>
                          <td className="p-2 text-center"><span className={m.status === 'active' ? 'text-green-600' : 'text-gray-500'}>{m.status || '-'}</span></td>
                          <td className="p-2 font-mono">{m.retailer_id || '-'}</td>
                          <td className="p-2 font-mono">{m.distributor_id || '-'}</td>
                          <td className="p-2 font-mono">{m.master_distributor_id || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Subscription settings */}
            {lookupMachines.length > 0 && (
              <div className="bg-gray-50 dark:bg-gray-900/30 rounded-lg p-4 space-y-3">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  <IndianRupee className="w-4 h-4" /> Subscription settings
                </p>
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="w-36">
                    <label className="text-xs text-gray-500 block mb-1">Rate/machine (excl GST)</label>
                    <input value={subRate} onChange={(e) => setSubRate(e.target.value)} type="number" className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600" placeholder="e.g. 399" />
                  </div>
                  <div className="w-20">
                    <label className="text-xs text-gray-500 block mb-1">GST %</label>
                    <input value={subGst} onChange={(e) => setSubGst(e.target.value)} type="number" className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600" />
                  </div>
                  <div className="w-36">
                    <label className="text-xs text-gray-500 block mb-1 flex items-center gap-1"><CalendarDays className="w-3 h-3" /> Billing day (1-28)</label>
                    <input value={subBillingDay} onChange={(e) => setSubBillingDay(e.target.value)} type="number" min="1" max="28" className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600" />
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400 flex-1 min-w-[200px]">
                    <p>Machines: <strong>{lookupMachines.length}</strong></p>
                    {subRate && (
                      <p>Monthly total: <strong className="text-primary-600">₹{(lookupMachines.length * parseFloat(subRate) * (1 + (parseFloat(subGst) || 18) / 100)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> (incl GST)</p>
                    )}
                  </div>
                </div>
                <button onClick={handleCreateSubscription} disabled={creatingSubscription || !subRate} className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-primary-700">
                  <CreditCard className="w-4 h-4" /> {creatingSubscription ? 'Saving...' : lookupExistingSub ? 'Update Subscription' : 'Create Subscription'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ============ CRON ============ */}
      {cronSettings && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between flex-wrap gap-2">
            <span className="font-medium flex items-center gap-2"><Clock className="w-4 h-4" /> Scheduled auto-debit (in-app cron)</span>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={toggleCronEnabled} disabled={togglingCron} className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50">
                {togglingCron ? '...' : cronSettings.is_enabled ? 'Disable cron' : 'Enable cron'}
              </button>
            </div>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Hour (0-23)</label>
                <input
                  type="number" min={0} max={23}
                  value={editCronHour}
                  onChange={e => setEditCronHour(Math.max(0, Math.min(23, parseInt(e.target.value) || 0)))}
                  className="w-20 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-900"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Minute (0-59)</label>
                <input
                  type="number" min={0} max={59}
                  value={editCronMinute}
                  onChange={e => setEditCronMinute(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                  className="w-20 px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-900"
                />
              </div>
              <div className="text-sm text-gray-500 pb-1.5">IST ({cronSettings.timezone})</div>
              <button
                onClick={saveCronSchedule}
                disabled={savingCronSchedule || (editCronHour === cronSettings.schedule_hour && editCronMinute === cronSettings.schedule_minute)}
                className="px-3 py-1.5 text-sm rounded-lg bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50"
              >
                {savingCronSchedule ? 'Saving...' : 'Save Schedule'}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              <div><p className="text-gray-500">Current Schedule</p><p className="font-medium">{String(cronSettings.schedule_hour).padStart(2, '0')}:{String(cronSettings.schedule_minute).padStart(2, '0')} daily</p></div>
              <div><p className="text-gray-500">Status</p><p className="font-medium">{cronSettings.is_enabled ? '🟢 Enabled' : '🔴 Disabled'}</p></div>
              <div><p className="text-gray-500">Last run</p><p className="font-medium">{cronSettings.last_run_at ? new Date(cronSettings.last_run_at).toLocaleString() : 'Never'}</p></div>
              <div><p className="text-gray-500">Last result</p><p className="font-medium">{cronSettings.last_run_message || '—'}</p></div>
            </div>
          </div>
        </div>
      )}

      {/* ============ PRODUCTS ============ */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <span className="font-medium flex items-center gap-2"><Package className="w-4 h-4" /> Products</span>
          <button onClick={() => setShowAddProduct(!showAddProduct)} className="text-sm px-3 py-1.5 rounded-lg bg-primary-50 dark:bg-primary-900/20 text-primary-600 hover:bg-primary-100 dark:hover:bg-primary-900/40 flex items-center gap-1">
            <Plus className="w-3 h-3" /> Add product
          </button>
        </div>
        {showAddProduct && (
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[150px]">
              <label className="text-xs text-gray-500 block mb-1">Name</label>
              <input value={newProductName} onChange={(e) => setNewProductName(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600" placeholder="e.g., Sound Box" />
            </div>
            <div className="w-24">
              <label className="text-xs text-gray-500 block mb-1">GST %</label>
              <input value={newProductGst} onChange={(e) => setNewProductGst(e.target.value)} type="number" className="w-full border rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600" />
            </div>
            <button onClick={addProduct} disabled={savingProduct} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm disabled:opacity-50">{savingProduct ? 'Saving...' : 'Save'}</button>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 dark:bg-gray-900/50"><th className="text-left p-3">Name</th><th className="text-right p-3">GST %</th><th className="text-center p-3">Active</th><th className="p-3">Action</th></tr></thead>
            <tbody>{products.map((p) => (
              <tr key={p.id} className="border-t border-gray-100 dark:border-gray-700">
                <td className="p-3">{p.name}</td>
                <td className="p-3 text-right">{Number(p.default_gst_percent)}%</td>
                <td className="p-3 text-center">{p.is_active ? 'Yes' : 'No'}</td>
                <td className="p-3 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => toggleProductActive(p)} disabled={togglingProductId === p.id || deletingProductId === p.id} className="text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 disabled:opacity-50" title={p.is_active ? 'Disable product' : 'Enable product'}>
                    {togglingProductId === p.id ? '...' : p.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button type="button" onClick={() => deleteProduct(p)} disabled={deletingProductId === p.id} className="text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400 disabled:opacity-50" title="Delete product permanently">
                    {deletingProductId === p.id ? '...' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {products.length === 0 && <p className="p-4 text-gray-500 text-sm">No products. Run the migration to seed defaults.</p>}
      </div>

      {/* ============ SUBSCRIPTIONS TABLE ============ */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <Users className="w-4 h-4" /> <span className="font-medium">Subscriptions</span>
          <span className="text-xs text-gray-500 ml-2">({subscriptions.length})</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 dark:bg-gray-900/50">
              <th className="text-left p-3">User ID</th><th className="text-left p-3">Role</th><th className="text-right p-3">Items</th><th className="text-right p-3">Monthly (incl GST)</th><th className="text-center p-3">Billing day</th><th className="text-center p-3">Next billing</th><th className="text-center p-3">Auto-debit</th><th className="text-center p-3">Status</th><th className="p-3">Actions</th>
            </tr></thead>
            <tbody>{subscriptions.map((s) => (
              <tr key={s.id} className="border-t border-gray-100 dark:border-gray-700">
                <td className="p-3 font-mono text-xs">{s.user_id}</td>
                <td className="p-3">{roleLabel(s.user_role)}</td>
                <td className="p-3 text-right">{s.pos_machine_count}</td>
                <td className="p-3 text-right font-medium">₹{Number(s.monthly_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                <td className="p-3 text-center">{s.billing_day || 1}</td>
                <td className="p-3 text-center">{s.next_billing_date}</td>
                <td className="p-3 text-center">{s.auto_debit_enabled ? <ToggleRight className="w-5 h-5 text-primary-600 inline" /> : <ToggleLeft className="w-5 h-5 text-gray-400 inline" />}</td>
                <td className="p-3 text-center"><span className={s.status === 'active' ? 'text-green-600' : s.status === 'paused' ? 'text-yellow-600' : 'text-red-600'}>{s.status}</span></td>
                <td className="p-3 space-x-2 whitespace-nowrap">
                  <select value={s.status} onChange={(e) => setSubscriptionStatus(s, e.target.value as 'active' | 'paused' | 'cancelled')} disabled={togglingSubStatusId === s.id} className="text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-800 disabled:opacity-50">
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                  <button onClick={() => toggleAutoDebit(s)} disabled={togglingId === s.id} className="text-primary-600 hover:underline text-xs disabled:opacity-50" title="Toggle auto-debit">
                    {togglingId === s.id ? '...' : s.auto_debit_enabled ? 'Disable debit' : 'Enable debit'}
                  </button>
                  <button onClick={() => deleteSubscription(s)} disabled={deletingSubId === s.id} className="text-red-600 hover:text-red-700 dark:text-red-400 text-xs disabled:opacity-50 inline-flex items-center gap-0.5" title="Delete subscription">
                    <Trash2 className="w-3 h-3" /> {deletingSubId === s.id ? '...' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {subscriptions.length === 0 && <p className="p-4 text-gray-500 text-sm">No subscriptions. Use &quot;Add / Manage Subscription&quot; or &quot;Sync from POS&quot;.</p>}
      </div>

      {/* ============ SUBSCRIPTION ACTIVITY HISTORY ============ */}
      {activityLogs.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
            <History className="w-4 h-4" /> <span className="font-medium">Subscription Activity History</span>
            <span className="text-xs text-gray-500 ml-2">(last {activityLogs.length})</span>
          </div>
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0"><tr className="bg-gray-50 dark:bg-gray-900/50">
                <th className="text-left p-3 w-40">Time</th>
                <th className="text-left p-3">By</th>
                <th className="text-left p-3">Action</th>
                <th className="text-left p-3">Description</th>
                <th className="text-center p-3 w-20">Status</th>
              </tr></thead>
              <tbody>{activityLogs.map((log) => (
                <tr key={log.id} className="border-t border-gray-100 dark:border-gray-700">
                  <td className="p-3 text-xs text-gray-500 whitespace-nowrap">{new Date(log.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="p-3 text-xs whitespace-nowrap">
                    <span className="font-mono">{log.user_id}</span>
                    <span className="text-gray-400 ml-1">({log.user_role})</span>
                  </td>
                  <td className="p-3 text-xs font-medium whitespace-nowrap">{log.activity_type.replace(/_/g, ' ')}</td>
                  <td className="p-3 text-xs text-gray-600 dark:text-gray-400">{log.activity_description}</td>
                  <td className="p-3 text-center"><span className={`text-xs font-medium ${log.status === 'success' ? 'text-green-600' : log.status === 'failed' ? 'text-red-600' : 'text-gray-500'}`}>{log.status}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4 text-sm text-blue-800 dark:text-blue-200 space-y-1">
        <p className="font-semibold">How it works:</p>
        <ol className="list-decimal ml-4 space-y-0.5">
          <li>Add products (POS Machine, QR Barcode, etc.) and set GST %.</li>
          <li>Use <strong>Add / Manage Subscription</strong> to lookup a MD, distributor, or retailer — see their assigned POS machines — set rate &amp; billing day — create subscription.</li>
          <li>Or use <strong>Sync from POS</strong> to auto-create subscriptions at all hierarchy levels from current POS assignments &amp; rates.</li>
          <li>When a machine is assigned down the chain (MD → Dist → Retailer), run sync to cascade subscriptions automatically.</li>
          <li>On billing day (or &quot;Run auto-debit now&quot;): the user&apos;s wallet is debited (rate + GST), and commission margins are auto-credited up the chain as <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">POS_RENTAL_COMMISSION</code>.</li>
        </ol>
      </div>
    </motion.div>
  )
}
