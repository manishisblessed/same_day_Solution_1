'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'
import {
  Clock, Play, Pause, Power, RefreshCw, Plus,
  CheckCircle2, XCircle, AlertTriangle, Zap,
  Users, Settings, Calendar, Timer, Trash2
} from 'lucide-react'
import { motion } from 'framer-motion'

interface PartnerCronSettings {
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
  updated_at: string
}

interface PartnerScheme {
  id: string
  partner_id: string
  mode: string
  card_type: string | null
  brand_type: string | null
  partner_mdr_t0: number
  partner_mdr_t1: number
  status: string
  effective_date: string
}

export default function PartnerT1SettlementControl({ readOnly = false }: { readOnly?: boolean }) {
  const [settings, setSettings] = useState<PartnerCronSettings | null>(null)
  const [schemes, setSchemes] = useState<PartnerScheme[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [editHour, setEditHour] = useState(4)
  const [editMinute, setEditMinute] = useState(0)
  const [showSchemeForm, setShowSchemeForm] = useState(false)
  const [newScheme, setNewScheme] = useState({
    partner_id: '',
    mode: 'CARD',
    card_type: 'CREDIT',
    brand_type: 'VISA',
    partner_mdr_t0: 1.5,
    partner_mdr_t1: 0.5,
  })
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  const pad = (n: number) => String(n).padStart(2, '0')

  const fetchSettings = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/settlement/partner-t1-cron-settings')
      const data = await res.json()
      if (data.data) {
        setSettings(data.data)
        setEditHour(data.data.schedule_hour)
        setEditMinute(data.data.schedule_minute)
      }
    } catch (err: any) {
      console.error('Failed to fetch partner cron settings:', err)
    }
  }, [])

  const fetchSchemes = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/partner-schemes?status=active')
      const data = await res.json()
      if (data.data) {
        setSchemes(data.data)
      }
    } catch (err: any) {
      console.error('Failed to fetch partner schemes:', err)
    }
  }, [])

  useEffect(() => {
    const loadAll = async () => {
      setLoading(true)
      await Promise.all([fetchSettings(), fetchSchemes()])
      setLoading(false)
    }
    loadAll()
  }, [fetchSettings, fetchSchemes])

  const handleToggleEnabled = async () => {
    if (!settings) return
    setSaving(true)
    try {
      const res = await apiFetch('/api/admin/settlement/partner-t1-cron-settings', {
        method: 'POST',
        body: JSON.stringify({ is_enabled: !settings.is_enabled }),
      })
      const data = await res.json()
      if (data.data) {
        setSettings(data.data)
        showMessage('success', data.data.is_enabled ? 'Partner T+1 Cron enabled' : 'Partner T+1 Cron paused')
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
      const res = await apiFetch('/api/admin/settlement/partner-t1-cron-settings', {
        method: 'POST',
        body: JSON.stringify({ schedule_hour: editHour, schedule_minute: editMinute }),
      })
      const data = await res.json()
      if (data.data) {
        setSettings(data.data)
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
    if (!confirm('Run Partner T+1 settlement now? This will process all pending partner transactions.')) return
    setRunning(true)
    try {
      const res = await apiFetch('/api/admin/settlement/partner-t1-run-now', { method: 'POST' })
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

  const handleCreateScheme = async () => {
    if (!newScheme.partner_id) {
      showMessage('error', 'Partner ID is required')
      return
    }
    setSaving(true)
    try {
      const res = await apiFetch('/api/admin/partner-schemes', {
        method: 'POST',
        body: JSON.stringify(newScheme),
      })
      const data = await res.json()
      if (data.data) {
        setSchemes([...schemes, data.data])
        setNewScheme({
          partner_id: '',
          mode: 'CARD',
          card_type: 'CREDIT',
          brand_type: 'VISA',
          partner_mdr_t0: 1.5,
          partner_mdr_t1: 0.5,
        })
        setShowSchemeForm(false)
        showMessage('success', 'Partner scheme created')
      } else {
        showMessage('error', data.error || 'Failed to create scheme')
      }
    } catch (err: any) {
      showMessage('error', err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-6">Loading...</div>
  }

  return (
    <div className="space-y-6">
      {/* Message Toast */}
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className={`p-4 rounded-lg ${
            message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
          }`}
        >
          {message.text}
        </motion.div>
      )}

      {/* Cron Settings Card */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Clock className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-bold">Partner T+1 Settlement Cron</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${settings?.is_enabled ? 'text-green-600' : 'text-red-600'}`}>
              {settings?.is_enabled ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>

        {/* Schedule Info */}
        {settings && (
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-blue-50 p-4 rounded">
              <div className="text-sm text-gray-600">Scheduled Time</div>
              <div className="text-2xl font-bold text-blue-600">
                {pad(settings.schedule_hour)}:{pad(settings.schedule_minute)} IST
              </div>
            </div>
            <div className="bg-purple-50 p-4 rounded">
              <div className="text-sm text-gray-600">Last Run</div>
              <div className="text-sm font-mono">
                {settings.last_run_at ? new Date(settings.last_run_at).toLocaleString() : 'Never'}
              </div>
            </div>
          </div>
        )}

        {/* Last Run Status */}
        {settings?.last_run_status && (
          <div className={`p-3 rounded mb-6 flex items-center gap-2 ${
            settings.last_run_status === 'success' ? 'bg-green-50 text-green-800' :
            settings.last_run_status === 'failed' ? 'bg-red-50 text-red-800' :
            'bg-yellow-50 text-yellow-800'
          }`}>
            {settings.last_run_status === 'success' && <CheckCircle2 className="w-4 h-4" />}
            {settings.last_run_status === 'failed' && <XCircle className="w-4 h-4" />}
            {settings.last_run_status === 'partial' && <AlertTriangle className="w-4 h-4" />}
            <div>
              <div className="font-medium">{settings.last_run_message}</div>
              <div className="text-sm">Processed: {settings.last_run_processed} | Failed: {settings.last_run_failed}</div>
            </div>
          </div>
        )}

        {/* Schedule Editor */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium mb-2">Hour (0-23)</label>
            <input
              type="number"
              min="0"
              max="23"
              value={editHour}
              onChange={(e) => setEditHour(Number(e.target.value))}
              className="w-full px-3 py-2 border rounded"
              disabled={readOnly}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Minute (0-59)</label>
            <input
              type="number"
              min="0"
              max="59"
              value={editMinute}
              onChange={(e) => setEditMinute(Number(e.target.value))}
              className="w-full px-3 py-2 border rounded"
              disabled={readOnly}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Timezone</label>
            <input
              type="text"
              value={settings?.timezone || 'Asia/Kolkata'}
              className="w-full px-3 py-2 border rounded bg-gray-50"
              disabled
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleToggleEnabled}
            disabled={saving || readOnly}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {settings?.is_enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {settings?.is_enabled ? 'Pause' : 'Enable'}
          </button>
          <button
            onClick={handleUpdateSchedule}
            disabled={saving || readOnly}
            className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50"
          >
            <Settings className="w-4 h-4" />
            Update Schedule
          </button>
          <button
            onClick={handleRunNow}
            disabled={running || readOnly}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          >
            <Zap className="w-4 h-4" />
            {running ? 'Running...' : 'Run Now'}
          </button>
        </div>
      </div>

      {/* Partner Schemes Card */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Users className="w-6 h-6 text-purple-600" />
            <h2 className="text-xl font-bold">Partner MDR Schemes</h2>
          </div>
          <button
            onClick={() => setShowSchemeForm(!showSchemeForm)}
            className="flex items-center gap-2 px-3 py-1 bg-purple-600 text-white rounded text-sm hover:bg-purple-700"
            disabled={readOnly}
          >
            <Plus className="w-4 h-4" />
            New Scheme
          </button>
        </div>

        {/* New Scheme Form */}
        {showSchemeForm && (
          <div className="bg-gray-50 p-4 rounded mb-6 space-y-3">
            <input
              type="text"
              placeholder="Partner ID"
              value={newScheme.partner_id}
              onChange={(e) => setNewScheme({ ...newScheme, partner_id: e.target.value })}
              className="w-full px-3 py-2 border rounded text-sm"
            />
            <div className="grid grid-cols-3 gap-3">
              <select
                value={newScheme.mode}
                onChange={(e) => setNewScheme({ ...newScheme, mode: e.target.value })}
                className="px-3 py-2 border rounded text-sm"
              >
                <option value="CARD">CARD</option>
                <option value="UPI">UPI</option>
              </select>
              <select
                value={newScheme.card_type || ''}
                onChange={(e) => setNewScheme({ ...newScheme, card_type: e.target.value })}
                className="px-3 py-2 border rounded text-sm"
              >
                <option value="">Any</option>
                <option value="CREDIT">CREDIT</option>
                <option value="DEBIT">DEBIT</option>
              </select>
              <select
                value={newScheme.brand_type || ''}
                onChange={(e) => setNewScheme({ ...newScheme, brand_type: e.target.value })}
                className="px-3 py-2 border rounded text-sm"
              >
                <option value="">Any</option>
                <option value="VISA">VISA</option>
                <option value="MASTERCARD">MASTERCARD</option>
                <option value="RUPAY">RUPAY</option>
                <option value="AMEX">AMEX</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="number"
                step="0.01"
                placeholder="MDR T0 %"
                value={newScheme.partner_mdr_t0}
                onChange={(e) => setNewScheme({ ...newScheme, partner_mdr_t0: Number(e.target.value) })}
                className="px-3 py-2 border rounded text-sm"
              />
              <input
                type="number"
                step="0.01"
                placeholder="MDR T1 %"
                value={newScheme.partner_mdr_t1}
                onChange={(e) => setNewScheme({ ...newScheme, partner_mdr_t1: Number(e.target.value) })}
                className="px-3 py-2 border rounded text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreateScheme}
                disabled={saving || readOnly}
                className="flex-1 px-3 py-2 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
              >
                Create
              </button>
              <button
                onClick={() => setShowSchemeForm(false)}
                className="flex-1 px-3 py-2 bg-gray-300 text-gray-700 rounded text-sm hover:bg-gray-400"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Schemes List */}
        {schemes.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-4 py-2 text-left">Partner ID</th>
                  <th className="px-4 py-2 text-left">Mode</th>
                  <th className="px-4 py-2 text-left">Card Type</th>
                  <th className="px-4 py-2 text-left">Brand</th>
                  <th className="px-4 py-2 text-right">MDR T0</th>
                  <th className="px-4 py-2 text-right">MDR T1</th>
                  <th className="px-4 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {schemes.map((scheme) => (
                  <tr key={scheme.id} className="border-b hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-xs">{scheme.partner_id.substring(0, 8)}...</td>
                    <td className="px-4 py-2">{scheme.mode}</td>
                    <td className="px-4 py-2">{scheme.card_type || 'Any'}</td>
                    <td className="px-4 py-2">{scheme.brand_type || 'Any'}</td>
                    <td className="px-4 py-2 text-right font-mono">{scheme.partner_mdr_t0}%</td>
                    <td className="px-4 py-2 text-right font-mono">{scheme.partner_mdr_t1}%</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        scheme.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {scheme.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            No partner schemes configured yet. Create one to get started.
          </div>
        )}
      </div>
    </div>
  )
}
