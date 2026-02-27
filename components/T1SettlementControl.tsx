'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'
import {
  Clock, Play, Pause, Power, RefreshCw, Search,
  CheckCircle2, XCircle, AlertTriangle, Zap,
  Users, Settings, Calendar, Timer
} from 'lucide-react'
import { motion } from 'framer-motion'

interface CronSettings {
  id: string
  schedule_hour: number
  schedule_minute: number
  timezone: string
  is_enabled: boolean
  last_run_at: string | null
  last_run_status: 'success' | 'partial' | 'failed' | null
  last_run_message: string | null
  last_run_processed: number
  last_run_failed: number
  updated_by: string | null
  updated_at: string
}

interface RetailerRow {
  partner_id: string
  name: string
  email: string
  phone: string
  t1_settlement_paused: boolean
  t1_settlement_paused_at: string | null
  t1_settlement_paused_by: string | null
  settlement_mode_allowed: 'T1' | 'T0_T1' | null
  status: string
}

export default function T1SettlementControl() {
  const [settings, setSettings] = useState<CronSettings | null>(null)
  const [retailers, setRetailers] = useState<RetailerRow[]>([])
  const [distributors, setDistributors] = useState<RetailerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [entityTab, setEntityTab] = useState<'retailers' | 'distributors'>('retailers')
  const [editHour, setEditHour] = useState(7)
  const [editMinute, setEditMinute] = useState(0)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  const fetchSettings = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/settlement/t1-cron-settings')
      const data = await res.json()
      if (data.success && data.settings) {
        setSettings(data.settings)
        setEditHour(data.settings.schedule_hour)
        setEditMinute(data.settings.schedule_minute)
      }
    } catch (err: any) {
      console.error('Failed to fetch cron settings:', err)
    }
  }, [])

  const fetchEntities = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/settlement/t1-pause-retailer')
      const data = await res.json()
      if (data.success) {
        setRetailers(data.retailers || [])
        setDistributors(data.distributors || [])
      }
    } catch (err: any) {
      console.error('Failed to fetch entities:', err)
    }
  }, [])

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true)
      await Promise.all([fetchSettings(), fetchEntities()])
      setLoading(false)
    }
    loadAll()
  }, [fetchSettings, fetchEntities])

  const handleToggleEnabled = async () => {
    if (!settings) return
    setSaving(true)
    try {
      const res = await apiFetch('/api/admin/settlement/t1-cron-settings', {
        method: 'PUT',
        body: JSON.stringify({ is_enabled: !settings.is_enabled }),
      })
      const data = await res.json()
      if (data.success) {
        setSettings(data.settings)
        showMessage('success', data.settings.is_enabled ? 'T+1 Cron enabled' : 'T+1 Cron paused')
      } else {
        showMessage('error', data.error || 'Failed to update')
      }
    } catch (err: any) {
      showMessage('error', err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleUpdateSchedule = async () => {
    setSaving(true)
    try {
      const res = await apiFetch('/api/admin/settlement/t1-cron-settings', {
        method: 'PUT',
        body: JSON.stringify({ schedule_hour: editHour, schedule_minute: editMinute }),
      })
      const data = await res.json()
      if (data.success) {
        setSettings(data.settings)
        showMessage('success', `Schedule updated to ${pad(editHour)}:${pad(editMinute)} IST`)
      } else {
        showMessage('error', data.error || 'Failed to update')
      }
    } catch (err: any) {
      showMessage('error', err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleRunNow = async () => {
    if (!confirm('Run T+1 settlement now? This will process all pending transactions from previous days.')) return
    setRunning(true)
    try {
      const res = await apiFetch('/api/admin/settlement/t1-run-now', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        showMessage('success', `Settlement complete — Processed: ${data.processed}, Failed: ${data.failed}`)
        await fetchSettings()
      } else {
        showMessage('error', data.error || 'Failed to run settlement')
      }
    } catch (err: any) {
      showMessage('error', err.message)
    } finally {
      setRunning(false)
    }
  }

  const handleToggleSettlementMode = async (partnerId: string, currentMode: string | null, entityType: 'retailer' | 'distributor', targetMode?: 'T1' | 'T0_T1') => {
    setTogglingId(`mode-${partnerId}`)
    const newMode = targetMode || (currentMode === 'T0_T1' ? 'T1' : 'T0_T1')
    try {
      const res = await apiFetch('/api/admin/settlement/t1-pause-retailer', {
        method: 'POST',
        body: JSON.stringify({
          partner_id: partnerId,
          settlement_mode: newMode,
          entity_type: entityType,
        }),
      })
      const data = await res.json()
      if (data.success) {
        showMessage('success', data.message)
        await fetchEntities()
      } else {
        showMessage('error', data.error || 'Failed to update')
      }
    } catch (err: any) {
      showMessage('error', err.message)
    } finally {
      setTogglingId(null)
    }
  }

  const handleTogglePause = async (partnerId: string, currentlyPaused: boolean, entityType: 'retailer' | 'distributor') => {
    setTogglingId(partnerId)
    try {
      const res = await apiFetch('/api/admin/settlement/t1-pause-retailer', {
        method: 'POST',
        body: JSON.stringify({
          partner_id: partnerId,
          paused: !currentlyPaused,
          entity_type: entityType,
        }),
      })
      const data = await res.json()
      if (data.success) {
        showMessage('success', data.message)
        await fetchEntities()
      } else {
        showMessage('error', data.error || 'Failed to update')
      }
    } catch (err: any) {
      showMessage('error', err.message)
    } finally {
      setTogglingId(null)
    }
  }

  const pad = (n: number) => String(n).padStart(2, '0')

  const filteredEntities = (entityTab === 'retailers' ? retailers : distributors).filter(e =>
    !searchTerm ||
    e.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.partner_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.phone?.includes(searchTerm)
  )

  const pausedCount = retailers.filter(r => r.t1_settlement_paused).length +
    distributors.filter(d => d.t1_settlement_paused).length

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-6 h-6 animate-spin text-primary-500" />
        <span className="ml-2 text-gray-500">Loading T+1 Settlement Control...</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Toast Message */}
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className={`p-3 rounded-lg text-sm font-medium ${
            message.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800'
              : 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800'
          }`}
        >
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 inline mr-2" /> : <XCircle className="w-4 h-4 inline mr-2" />}
          {message.text}
        </motion.div>
      )}

      {/* Top Row: Cron Status + Schedule + Manual Run */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Cron Status Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Power className="w-4 h-4" />
              Cron Status
            </h3>
            <button
              onClick={handleToggleEnabled}
              disabled={saving}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                settings?.is_enabled ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings?.is_enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${settings?.is_enabled ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
              <span className={`text-sm font-medium ${settings?.is_enabled ? 'text-green-600 dark:text-green-400' : 'text-gray-500'}`}>
                {settings?.is_enabled ? 'Active' : 'Paused'}
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {settings?.is_enabled
                ? `Runs daily at ${pad(settings.schedule_hour)}:${pad(settings.schedule_minute)} IST`
                : 'Cron is disabled. No auto-settlement will occur.'}
            </p>
            {pausedCount > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {pausedCount} entity(s) paused individually
              </p>
            )}
          </div>
        </motion.div>

        {/* Schedule Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-5"
        >
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4" />
            Schedule (IST)
          </h3>

          <div className="flex items-center gap-2 mb-3">
            <select
              value={editHour}
              onChange={e => setEditHour(Number(e.target.value))}
              className="px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm font-mono"
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>{pad(i)}</option>
              ))}
            </select>
            <span className="text-lg font-bold text-gray-500">:</span>
            <select
              value={editMinute}
              onChange={e => setEditMinute(Number(e.target.value))}
              className="px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm font-mono"
            >
              {Array.from({ length: 60 }, (_, i) => (
                <option key={i} value={i}>{pad(i)}</option>
              ))}
            </select>
            <button
              onClick={handleUpdateSchedule}
              disabled={saving || (editHour === settings?.schedule_hour && editMinute === settings?.schedule_minute)}
              className="ml-auto px-3 py-1.5 rounded-lg bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving...' : 'Update'}
            </button>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Changes apply within 60 seconds. Current: {pad(settings?.schedule_hour ?? 7)}:{pad(settings?.schedule_minute ?? 0)} IST
          </p>
        </motion.div>

        {/* Manual Run + Last Run Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-5"
        >
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4" />
            Manual Run
          </h3>

          <button
            onClick={handleRunNow}
            disabled={running}
            className="w-full px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-semibold hover:from-amber-600 hover:to-orange-600 disabled:opacity-60 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 mb-3"
          >
            {running ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Run T+1 Settlement Now
              </>
            )}
          </button>

          {settings?.last_run_at && (
            <div className="text-xs space-y-1">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3 h-3 text-gray-400" />
                <span className="text-gray-500 dark:text-gray-400">
                  Last: {new Date(settings.last_run_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {settings.last_run_status === 'success' ? (
                  <CheckCircle2 className="w-3 h-3 text-green-500" />
                ) : settings.last_run_status === 'partial' ? (
                  <AlertTriangle className="w-3 h-3 text-amber-500" />
                ) : (
                  <XCircle className="w-3 h-3 text-red-500" />
                )}
                <span className={`font-medium ${
                  settings.last_run_status === 'success' ? 'text-green-600 dark:text-green-400' :
                  settings.last_run_status === 'partial' ? 'text-amber-600 dark:text-amber-400' :
                  'text-red-600 dark:text-red-400'
                }`}>
                  {settings.last_run_processed} processed, {settings.last_run_failed} failed
                </span>
              </div>
            </div>
          )}
        </motion.div>
      </div>

      {/* Retailer / Distributor Pause Control */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700"
      >
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <Users className="w-4 h-4" />
                Per-Entity T+1 Pause Control
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Paused entities will be skipped during T+1 settlement. Their transactions remain pending.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { fetchEntities(); fetchSettings() }}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                title="Refresh"
              >
                <RefreshCw className="w-4 h-4 text-gray-500" />
              </button>
            </div>
          </div>

          {/* Entity Type Tabs + Search */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 mt-3">
            <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
              <button
                onClick={() => setEntityTab('retailers')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  entityTab === 'retailers'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                Retailers ({retailers.length})
              </button>
              <button
                onClick={() => setEntityTab('distributors')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  entityTab === 'distributors'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                Distributors ({distributors.length})
              </button>
            </div>
            <div className="flex-1 relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search by name, partner ID, email, phone..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Name</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Partner ID</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Contact</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Mode</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">T+1 Settlement</th>
                <th className="px-4 py-2.5 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filteredEntities.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-sm">
                    {searchTerm ? 'No matching entities found.' : 'No entities found.'}
                  </td>
                </tr>
              ) : (
                filteredEntities.map(entity => (
                  <tr key={entity.partner_id} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-900 dark:text-white">{entity.name}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-xs text-gray-600 dark:text-gray-400">{entity.partner_id}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="text-xs text-gray-600 dark:text-gray-400">{entity.email}</div>
                      <div className="text-xs text-gray-500">{entity.phone}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        entity.status === 'active'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                      }`}>
                        {entity.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <select
                        value={entity.settlement_mode_allowed || 'T1'}
                        onChange={(e) => {
                          const newMode = e.target.value as 'T1' | 'T0_T1'
                          if (newMode !== (entity.settlement_mode_allowed || 'T1')) {
                            handleToggleSettlementMode(entity.partner_id, entity.settlement_mode_allowed, entityTab === 'retailers' ? 'retailer' : 'distributor', newMode)
                          }
                        }}
                        disabled={togglingId === `mode-${entity.partner_id}`}
                        className={`text-xs font-medium rounded-lg border px-2 py-1.5 transition-colors cursor-pointer disabled:opacity-50 focus:ring-2 focus:ring-primary-500 focus:outline-none ${
                          entity.settlement_mode_allowed === 'T0_T1'
                            ? 'bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-900/20 dark:border-amber-700 dark:text-amber-400'
                            : 'bg-white border-gray-300 text-gray-700 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300'
                        }`}
                      >
                        <option value="T0_T1">T+0 + T+1 (Pulse Pay)</option>
                        <option value="T1">T+1 only</option>
                      </select>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {entity.t1_settlement_paused ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                          <Pause className="w-3 h-3" /> Paused
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          <CheckCircle2 className="w-3 h-3" /> Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => handleTogglePause(entity.partner_id, entity.t1_settlement_paused, entityTab === 'retailers' ? 'retailer' : 'distributor')}
                        disabled={togglingId === entity.partner_id}
                        className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                          entity.t1_settlement_paused
                            ? 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50'
                            : 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50'
                        }`}
                      >
                        {togglingId === entity.partner_id
                          ? '...'
                          : entity.t1_settlement_paused
                            ? 'Resume'
                            : 'Pause'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* Info Box */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 text-sm text-blue-700 dark:text-blue-300"
      >
        <h4 className="font-semibold mb-1 flex items-center gap-2">
          <Settings className="w-4 h-4" />
          How T+1 Settlement Works
        </h4>
        <ul className="space-y-1 text-xs mt-2">
          <li>At the scheduled time, the system finds all <strong>previous day&apos;s unsettled POS transactions</strong>.</li>
          <li>For each retailer/partner, it calculates the <strong>MDR at T+1 rates</strong> from the mapped scheme.</li>
          <li>The <strong>net amount (gross - MDR)</strong> is credited to the retailer&apos;s primary wallet.</li>
          <li>Paused retailers/partners are <strong>skipped</strong> — their transactions stay pending until resumed.</li>
          <li>Schedule changes take effect within <strong>60 seconds</strong> (no server restart needed).</li>
        </ul>
      </motion.div>
    </div>
  )
}
