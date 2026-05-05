'use client'

import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Power, Settings, Globe, Shield, RefreshCw, CheckCircle2, XCircle,
  AlertTriangle, Clock, Activity, Server, Zap, ToggleLeft, ToggleRight,
  ChevronDown, ChevronUp, Search, Save, History
} from 'lucide-react'
import { apiFetch } from '@/lib/api-fetch'

interface ServiceConfig {
  key: string
  label: string
  icon: string
  description: string
  providers: { id: string; name: string; description: string }[]
  category: 'payment' | 'banking' | 'utility' | 'value_added'
}

const SERVICE_CONFIGS: ServiceConfig[] = [
  {
    key: 'bbps',
    label: 'BBPS (Bill Payments)',
    icon: '📄',
    description: 'Bharat Bill Payment System for utility and bill payments',
    providers: [
      { id: 'sparkup', name: 'SparkUpTech', description: 'Original BBPS provider' },
      { id: 'chagans', name: 'Chagans Technologies', description: 'Alternative BBPS provider' },
    ],
    category: 'utility',
  },
  {
    key: 'aeps',
    label: 'AEPS Services',
    icon: '👆',
    description: 'Aadhaar Enabled Payment System for biometric transactions',
    providers: [
      { id: 'chagans', name: 'Chagans Technologies', description: 'AEPS via Chagans' },
    ],
    category: 'banking',
  },
  {
    key: 'payout',
    label: 'Payout / DMT',
    icon: '💸',
    description: 'Domestic Money Transfer via IMPS/NEFT',
    providers: [
      { id: 'sparkup', name: 'SparkUpTech', description: 'Payout via SparkUp' },
    ],
    category: 'payment',
  },
  {
    key: 'mini_atm_pos',
    label: 'Mini-ATM / POS',
    icon: '🏧',
    description: 'POS machine transactions and Mini-ATM services',
    providers: [
      { id: 'internal', name: 'Internal', description: 'Managed internally' },
    ],
    category: 'banking',
  },
  {
    key: 'aadhaar_pay',
    label: 'Aadhaar Pay',
    icon: '💳',
    description: 'Aadhaar-linked payment services',
    providers: [
      { id: 'chagans', name: 'Chagans Technologies', description: 'AadhaarPay via Chagans' },
    ],
    category: 'payment',
  },
  {
    key: 'recharge',
    label: 'Mobile Recharge',
    icon: '📱',
    description: 'Prepaid/Postpaid mobile recharge services',
    providers: [
      { id: 'sparkup', name: 'SparkUpTech', description: 'Recharge via SparkUp' },
    ],
    category: 'value_added',
  },
  {
    key: 'travel',
    label: 'Travel Services',
    icon: '✈️',
    description: 'Bus, flight, and hotel bookings',
    providers: [
      { id: 'internal', name: 'Internal', description: 'Managed internally' },
    ],
    category: 'value_added',
  },
  {
    key: 'cash_management',
    label: 'Cash Management',
    icon: '💰',
    description: 'Cash deposit and collection services',
    providers: [
      { id: 'internal', name: 'Internal', description: 'Managed internally' },
    ],
    category: 'banking',
  },
  {
    key: 'lic',
    label: 'LIC Bill Payment',
    icon: '🛡️',
    description: 'LIC premium collection services',
    providers: [
      { id: 'chagans', name: 'Chagans Technologies', description: 'LIC via Chagans BBPS' },
    ],
    category: 'utility',
  },
  {
    key: 'insurance',
    label: 'Insurance',
    icon: '🏥',
    description: 'Insurance premium and policy management',
    providers: [
      { id: 'internal', name: 'Internal', description: 'Managed internally' },
    ],
    category: 'value_added',
  },
]

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  payment: { label: 'Payment', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  banking: { label: 'Banking', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  utility: { label: 'Utility', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  value_added: { label: 'Value Added', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
}

interface PortalSettings {
  [key: string]: {
    enabled: boolean
    active_provider: string
    updated_at: string
    updated_by: string
  }
}

interface AuditLog {
  id: string
  service_key: string
  action: string
  old_value: string
  new_value: string
  performed_by: string
  performed_at: string
}

export default function PortalManagementTab() {
  const [settings, setSettings] = useState<PortalSettings>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [expandedService, setExpandedService] = useState<string | null>(null)
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [showAudit, setShowAudit] = useState(false)
  const [portalMasterSwitch, setPortalMasterSwitch] = useState(true)
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean
    title: string
    message: string
    onConfirm: () => void
  }>({ open: false, title: '', message: '', onConfirm: () => {} })

  const fetchSettings = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/admin/portal-settings')
      const data = await res.json()
      if (data.success) {
        setSettings(data.settings || {})
        setPortalMasterSwitch(data.master_switch !== false)
        setAuditLogs(data.audit_logs || [])
      }
    } catch (err) {
      console.error('Failed to fetch portal settings:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSettings() }, [fetchSettings])

  const toggleService = async (serviceKey: string, enabled: boolean) => {
    const svc = SERVICE_CONFIGS.find(s => s.key === serviceKey)
    const action = enabled ? 'enable' : 'disable'
    setConfirmDialog({
      open: true,
      title: `${enabled ? 'Enable' : 'Disable'} ${svc?.label || serviceKey}`,
      message: `Are you sure you want to ${action} ${svc?.label || serviceKey}? This will ${enabled ? 'allow' : 'block'} all transactions for this service across the portal.`,
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }))
        setSaving(serviceKey)
        try {
          const res = await apiFetch('/api/admin/portal-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ service_key: serviceKey, enabled }),
          })
          const data = await res.json()
          if (data.success) {
            setSettings(prev => ({
              ...prev,
              [serviceKey]: { ...prev[serviceKey], enabled, updated_at: new Date().toISOString(), updated_by: 'admin' },
            }))
          }
        } catch (err) {
          console.error('Failed to toggle service:', err)
        } finally {
          setSaving(null)
        }
      },
    })
  }

  const switchProvider = async (serviceKey: string, providerId: string) => {
    const svc = SERVICE_CONFIGS.find(s => s.key === serviceKey)
    const provider = svc?.providers.find(p => p.id === providerId)
    setConfirmDialog({
      open: true,
      title: `Switch Provider for ${svc?.label}`,
      message: `Switch ${svc?.label} provider to ${provider?.name}? Active transactions may be briefly interrupted.`,
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }))
        setSaving(serviceKey)
        try {
          const res = await apiFetch('/api/admin/portal-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ service_key: serviceKey, active_provider: providerId }),
          })
          const data = await res.json()
          if (data.success) {
            setSettings(prev => ({
              ...prev,
              [serviceKey]: { ...prev[serviceKey], active_provider: providerId, updated_at: new Date().toISOString(), updated_by: 'admin' },
            }))
          }
        } catch (err) {
          console.error('Failed to switch provider:', err)
        } finally {
          setSaving(null)
        }
      },
    })
  }

  const toggleMasterSwitch = async () => {
    const nextState = !portalMasterSwitch
    setConfirmDialog({
      open: true,
      title: nextState ? 'Enable All Services' : 'SHUT DOWN ALL SERVICES',
      message: nextState
        ? 'This will re-enable all services to their previous state.'
        : 'WARNING: This will immediately disable ALL services across the portal. No transactions will be processed. Use this only for emergency maintenance.',
      onConfirm: async () => {
        setConfirmDialog(prev => ({ ...prev, open: false }))
        setSaving('master')
        try {
          const res = await apiFetch('/api/admin/portal-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ master_switch: nextState }),
          })
          const data = await res.json()
          if (data.success) setPortalMasterSwitch(nextState)
        } catch (err) {
          console.error('Failed to toggle master switch:', err)
        } finally {
          setSaving(null)
        }
      },
    })
  }

  const filtered = SERVICE_CONFIGS.filter(s => {
    const matchSearch = !search || s.label.toLowerCase().includes(search.toLowerCase()) || s.key.includes(search.toLowerCase())
    const matchCat = categoryFilter === 'all' || s.category === categoryFilter
    return matchSearch && matchCat
  })

  const enabledCount = Object.values(settings).filter(s => s.enabled).length
  const totalCount = SERVICE_CONFIGS.length

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
            <Server className="w-7 h-7 text-blue-500" />
            Portal Management
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Control service availability, switch providers, and manage portal operations
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAudit(!showAudit)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            <History className="w-4 h-4" />
            Audit Log
          </button>
          <button
            onClick={fetchSettings}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Master Switch + Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Master Switch */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className={`col-span-1 lg:col-span-1 rounded-2xl p-6 border-2 transition-all ${
            portalMasterSwitch
              ? 'bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border-green-200 dark:border-green-700'
              : 'bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-900/20 dark:to-rose-900/20 border-red-200 dark:border-red-700'
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className={`p-3 rounded-xl ${portalMasterSwitch ? 'bg-green-500' : 'bg-red-500'}`}>
                <Power className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white">Master Switch</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">All portal services</p>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between mt-4">
            <span className={`text-sm font-semibold ${portalMasterSwitch ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {portalMasterSwitch ? 'PORTAL ONLINE' : 'PORTAL OFFLINE'}
            </span>
            <button
              onClick={toggleMasterSwitch}
              disabled={saving === 'master'}
              className="transition-transform hover:scale-105"
            >
              {saving === 'master' ? (
                <RefreshCw className="w-10 h-10 text-gray-400 animate-spin" />
              ) : portalMasterSwitch ? (
                <ToggleRight className="w-12 h-12 text-green-500" />
              ) : (
                <ToggleLeft className="w-12 h-12 text-red-500" />
              )}
            </button>
          </div>
        </motion.div>

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="rounded-2xl p-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-blue-500 rounded-xl">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white">Service Status</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">Active / Total</p>
            </div>
          </div>
          <div className="flex items-end gap-2">
            <span className="text-4xl font-bold text-green-500">{enabledCount}</span>
            <span className="text-lg text-gray-400 mb-1">/ {totalCount}</span>
          </div>
          <div className="mt-3 w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className="bg-green-500 h-2 rounded-full transition-all"
              style={{ width: `${totalCount > 0 ? (enabledCount / totalCount) * 100 : 0}%` }}
            />
          </div>
        </motion.div>

        {/* Quick Info */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-2xl p-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-purple-500 rounded-xl">
              <Globe className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white">Active Providers</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">API integrations</p>
            </div>
          </div>
          <div className="space-y-2">
            {['SparkUpTech', 'Chagans Technologies', 'Internal'].map(name => {
              const count = Object.entries(settings).filter(([k, v]) => {
                const cfg = SERVICE_CONFIGS.find(s => s.key === k)
                const prov = cfg?.providers.find(p => p.id === v.active_provider)
                return v.enabled && prov?.name === name
              }).length
              return (
                <div key={name} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600 dark:text-gray-400">{name}</span>
                  <span className="font-semibold text-gray-900 dark:text-white">{count} services</span>
                </div>
              )
            })}
          </div>
        </motion.div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search services..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div className="flex gap-2">
          {['all', 'payment', 'banking', 'utility', 'value_added'].map(cat => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                categoryFilter === cat
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {cat === 'all' ? 'All' : CATEGORY_LABELS[cat]?.label || cat}
            </button>
          ))}
        </div>
      </div>

      {/* Service Cards */}
      <div className="space-y-3">
        {filtered.map((svc, i) => {
          const svcSettings = settings[svc.key] || { enabled: false, active_provider: svc.providers[0]?.id || '', updated_at: '', updated_by: '' }
          const isEnabled = svcSettings.enabled && portalMasterSwitch
          const activeProvider = svc.providers.find(p => p.id === svcSettings.active_provider) || svc.providers[0]
          const isExpanded = expandedService === svc.key
          const isSaving = saving === svc.key

          return (
            <motion.div
              key={svc.key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
              className={`rounded-xl border transition-all ${
                isEnabled
                  ? 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                  : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-800 opacity-75'
              }`}
            >
              {/* Service Row */}
              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-4 flex-1">
                  <span className="text-2xl">{svc.icon}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h4 className="font-semibold text-gray-900 dark:text-white">{svc.label}</h4>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${CATEGORY_LABELS[svc.category]?.color}`}>
                        {CATEGORY_LABELS[svc.category]?.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{svc.description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  {/* Provider Badge */}
                  <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 rounded-lg">
                    <Globe className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{activeProvider?.name}</span>
                  </div>

                  {/* Status */}
                  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${
                    isEnabled
                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                      : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                  }`}>
                    {isEnabled ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                    {isEnabled ? 'ON' : 'OFF'}
                  </div>

                  {/* Toggle */}
                  <button
                    onClick={() => toggleService(svc.key, !svcSettings.enabled)}
                    disabled={isSaving || !portalMasterSwitch}
                    className="transition-transform hover:scale-105 disabled:opacity-50"
                  >
                    {isSaving ? (
                      <RefreshCw className="w-8 h-8 text-gray-400 animate-spin" />
                    ) : svcSettings.enabled ? (
                      <ToggleRight className="w-10 h-10 text-green-500" />
                    ) : (
                      <ToggleLeft className="w-10 h-10 text-gray-400" />
                    )}
                  </button>

                  {/* Expand */}
                  <button
                    onClick={() => setExpandedService(isExpanded ? null : svc.key)}
                    className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Expanded Panel */}
              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-5 pt-2 border-t border-gray-100 dark:border-gray-700">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Provider Selection */}
                        <div>
                          <h5 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                            <Globe className="w-4 h-4" /> Select Provider
                          </h5>
                          <div className="space-y-2">
                            {svc.providers.map(provider => (
                              <button
                                key={provider.id}
                                onClick={() => {
                                  if (svcSettings.active_provider !== provider.id) {
                                    switchProvider(svc.key, provider.id)
                                  }
                                }}
                                disabled={isSaving}
                                className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-all ${
                                  svcSettings.active_provider === provider.id
                                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                                    : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <div>
                                    <p className="font-medium text-gray-900 dark:text-white text-sm">{provider.name}</p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">{provider.description}</p>
                                  </div>
                                  {svcSettings.active_provider === provider.id && (
                                    <CheckCircle2 className="w-5 h-5 text-blue-500" />
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Service Info */}
                        <div>
                          <h5 className="text-sm font-semibold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                            <Shield className="w-4 h-4" /> Service Info
                          </h5>
                          <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4 space-y-3">
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-500 dark:text-gray-400">Status</span>
                              <span className={`font-medium ${isEnabled ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                {isEnabled ? 'Active' : 'Disabled'}
                              </span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-500 dark:text-gray-400">Provider</span>
                              <span className="font-medium text-gray-900 dark:text-white">{activeProvider?.name}</span>
                            </div>
                            {svcSettings.updated_at && (
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-500 dark:text-gray-400">Last Updated</span>
                                <span className="font-medium text-gray-900 dark:text-white">
                                  {new Date(svcSettings.updated_at).toLocaleString('en-IN')}
                                </span>
                              </div>
                            )}
                            {svcSettings.updated_by && (
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-500 dark:text-gray-400">Updated By</span>
                                <span className="font-medium text-gray-900 dark:text-white">{svcSettings.updated_by}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )
        })}
      </div>

      {/* Audit Log Panel */}
      <AnimatePresence>
        {showAudit && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="rounded-2xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-6"
          >
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
              <History className="w-5 h-5" /> Recent Changes
            </h3>
            {auditLogs.length > 0 ? (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {auditLogs.map(log => (
                  <div key={log.id} className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-900/50 rounded-xl text-sm">
                    <div className="flex items-center gap-3">
                      <Clock className="w-4 h-4 text-gray-400 shrink-0" />
                      <div>
                        <span className="font-medium text-gray-900 dark:text-white">{log.service_key}</span>
                        <span className="text-gray-500 dark:text-gray-400"> &mdash; {log.action}</span>
                      </div>
                    </div>
                    <div className="text-right text-xs text-gray-500 dark:text-gray-400">
                      <div>{log.performed_by}</div>
                      <div>{new Date(log.performed_at).toLocaleString('en-IN')}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">No changes recorded yet.</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirmation Dialog */}
      <AnimatePresence>
        {confirmDialog.open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.9 }}
              className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg">
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">{confirmDialog.title}</h3>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">{confirmDialog.message}</p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setConfirmDialog(prev => ({ ...prev, open: false }))}
                  className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDialog.onConfirm}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  Confirm
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
