'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Key, Shield, Globe, RefreshCw, Plus, Copy, Eye, EyeOff,
  CheckCircle, XCircle, AlertCircle, X, Trash2, Download,
  Lock, Unlock, Server, Clock, FileText, Settings, Check
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { apiFetch } from '@/lib/api-client'

interface PartnerKey {
  id: string
  api_key: string
  api_secret_masked: string
  label: string
  permissions: string[] | string
  is_active: boolean
  expires_at: string | null
  last_used_at: string | null
  created_at: string
}

interface Partner {
  id: string
  name: string
  business_name: string
  email: string
  phone: string
  status: string
  ip_whitelist: string[] | null
  webhook_url: string | null
  created_at: string
  api_keys: PartnerKey[]
  export_limit: number
}

export default function POSPartnerAPIManagement() {
  const [partners, setPartners] = useState<Partner[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [expandedPartner, setExpandedPartner] = useState<string | null>(null)
  
  // Modals
  const [showKeyModal, setShowKeyModal] = useState(false)
  const [showWhitelistModal, setShowWhitelistModal] = useState(false)
  const [showNewKeyResult, setShowNewKeyResult] = useState<any>(null)
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null)
  
  // Whitelist form
  const [whitelistIps, setWhitelistIps] = useState('')
  const [exportLimitValue, setExportLimitValue] = useState(10)
  const [actionLoading, setActionLoading] = useState(false)

  const fetchPartners = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/admin/pos-partner-api')
      
      // Read response as text first to handle HTML error pages gracefully
      const text = await res.text()
      let result: any
      try {
        result = JSON.parse(text)
      } catch {
        // Response is not JSON (likely HTML 404 page from server)
        console.error('Error fetching partners: Non-JSON response received (status ' + res.status + ')')
        if (res.status === 404) {
          setError('POS Partner API endpoint not found. The server may need redeployment.')
        } else {
          setError(`Server returned an unexpected response (${res.status}). Please try again later.`)
        }
        return
      }
      
      if (!res.ok) {
        // Handle HTTP error status codes
        if (res.status === 401) {
          setError('Authentication required. Please log out and log back in.')
        } else if (res.status === 403) {
          setError(result.error || 'Admin access required. Please ensure your account has admin privileges.')
        } else {
          setError(result.error || `Failed to fetch partners (${res.status})`)
        }
        return
      }
      
      if (result.success) {
        setPartners(result.data || [])
      } else {
        setError(result.error || 'Failed to fetch partners')
      }
    } catch (err: any) {
      console.error('Error fetching partners:', err)
      setError(err.message || 'Failed to load partners. Please check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPartners()
  }, [fetchPartners])

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg)
    setTimeout(() => setSuccessMsg(null), 5000)
  }

  const doAction = async (body: any) => {
    setActionLoading(true)
    try {
      const res = await apiFetch('/api/admin/pos-partner-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      // Read response as text first to handle HTML error pages
      const text = await res.text()
      let result: any
      try {
        result = JSON.parse(text)
      } catch {
        throw new Error(res.status === 404
          ? 'POS Partner API endpoint not found. The server may need redeployment.'
          : `Server returned an unexpected response (${res.status})`)
      }
      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Action failed')
      }
      return result
    } catch (err: any) {
      setError(err.message)
      return null
    } finally {
      setActionLoading(false)
    }
  }

  // ─── Generate API Key ──────────────────────────────────
  const handleGenerateKey = async (partner: Partner) => {
    const result = await doAction({
      action: 'generate_key',
      partner_id: partner.id,
      label: 'Production Key',
      permissions: ['read', 'export'],
    })
    if (result) {
      setShowNewKeyResult(result.data)
      fetchPartners()
    }
  }

  // ─── Update IP Whitelist ───────────────────────────────
  const handleUpdateWhitelist = async () => {
    if (!selectedPartner) return
    const ips = whitelistIps
      .split(/[\n,;]+/)
      .map(ip => ip.trim())
      .filter(ip => ip.length > 0)

    const result = await doAction({
      action: 'update_whitelist',
      partner_id: selectedPartner.id,
      ip_whitelist: ips,
    })
    if (result) {
      setShowWhitelistModal(false)
      showSuccess(`IP whitelist updated for ${selectedPartner.name}`)
      fetchPartners()
    }
  }

  // ─── Update Export Limit ───────────────────────────────
  const handleUpdateExportLimit = async (partner: Partner) => {
    const result = await doAction({
      action: 'update_export_limit',
      partner_id: partner.id,
      daily_limit: exportLimitValue,
    })
    if (result) {
      showSuccess(`Export limit updated for ${partner.name}`)
      fetchPartners()
    }
  }

  // ─── Toggle Partner Status ─────────────────────────────
  const handleToggleStatus = async (partner: Partner) => {
    const newStatus = partner.status === 'active' ? 'suspended' : 'active'
    const result = await doAction({
      action: 'update_status',
      partner_id: partner.id,
      status: newStatus,
    })
    if (result) {
      showSuccess(`${partner.name} status changed to ${newStatus}`)
      fetchPartners()
    }
  }

  // ─── Revoke API Key ────────────────────────────────────
  const handleRevokeKey = async (keyId: string) => {
    if (!confirm('Are you sure you want to revoke this API key? This cannot be undone.')) return
    const result = await doAction({ action: 'revoke_key', key_id: keyId })
    if (result) {
      showSuccess('API key revoked')
      fetchPartners()
    }
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    showSuccess(`${label} copied to clipboard`)
  }

  const formatDate = (d: string | null) => {
    if (!d) return 'Never'
    return new Date(d).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true,
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <Key className="w-6 h-6 text-primary-600" />
              POS Partner API Management
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Generate API credentials, manage IP whitelists, and control partner access
            </p>
          </div>
          <button
            onClick={fetchPartners}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <RefreshCw className={`w-5 h-5 text-gray-600 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Success / Error Messages */}
      <AnimatePresence>
        {successMsg && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 flex items-center gap-2"
          >
            <CheckCircle className="w-5 h-5 text-green-600" />
            <p className="text-sm text-green-800 dark:text-green-400">{successMsg}</p>
          </motion.div>
        )}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-center gap-2"
          >
            <AlertCircle className="w-5 h-5 text-red-600" />
            <p className="text-sm text-red-800 dark:text-red-400">{error}</p>
            <button onClick={() => setError(null)} className="ml-auto"><X className="w-4 h-4" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Security Info Banner */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
        <h3 className="font-semibold text-blue-800 dark:text-blue-300 flex items-center gap-2 mb-2">
          <Shield className="w-5 h-5" />
          Partner API Security Flow
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm text-blue-700 dark:text-blue-400">
          <div className="flex items-start gap-2">
            <span className="bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold flex-shrink-0">1</span>
            <span>Create partner & set status to <strong>Active</strong></span>
          </div>
          <div className="flex items-start gap-2">
            <span className="bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold flex-shrink-0">2</span>
            <span>Generate <strong>API Key + Secret</strong> and share securely</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold flex-shrink-0">3</span>
            <span><strong>Whitelist partner IP</strong> — API is BLOCKED until IPs are added</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold flex-shrink-0">4</span>
            <span>Share <strong>API Integration Guide</strong> with partner</span>
          </div>
        </div>
      </div>

      {/* Partners List */}
      {partners.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-12 text-center">
          <Key className="w-16 h-16 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
          <p className="text-lg font-semibold text-gray-900 dark:text-white mb-2">No POS API Partners</p>
          <p className="text-gray-500 dark:text-gray-400">Partners created in the POS Partner API system will appear here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {partners.map((partner) => (
            <div key={partner.id} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
              {/* Partner Header */}
              <div
                className="p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors"
                onClick={() => setExpandedPartner(expandedPartner === partner.id ? null : partner.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      partner.status === 'active' 
                        ? 'bg-green-100 dark:bg-green-900/30' 
                        : 'bg-red-100 dark:bg-red-900/30'
                    }`}>
                      <Server className={`w-6 h-6 ${
                        partner.status === 'active' ? 'text-green-600' : 'text-red-600'
                      }`} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 dark:text-white">{partner.name}</h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{partner.email} • {partner.business_name}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Status Badge */}
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      partner.status === 'active' 
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' 
                        : partner.status === 'suspended'
                        ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-400'
                    }`}>
                      {partner.status?.toUpperCase()}
                    </span>
                    {/* Key count badge */}
                    <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-full text-xs font-semibold">
                      {partner.api_keys?.filter(k => k.is_active).length || 0} key(s)
                    </span>
                    {/* IP count badge */}
                    <span className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 rounded-full text-xs font-semibold">
                      {partner.ip_whitelist?.length || 0} IP(s)
                    </span>
                  </div>
                </div>
              </div>

              {/* Expanded Content */}
              <AnimatePresence>
                {expandedPartner === partner.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-gray-200 dark:border-gray-700 overflow-hidden"
                  >
                    <div className="p-5 space-y-5">
                      {/* Actions Bar */}
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => handleGenerateKey(partner)}
                          disabled={actionLoading}
                          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm disabled:opacity-50"
                        >
                          <Plus className="w-4 h-4" />
                          Generate API Key
                        </button>
                        <button
                          onClick={() => {
                            setSelectedPartner(partner)
                            setWhitelistIps((partner.ip_whitelist || []).join('\n'))
                            setShowWhitelistModal(true)
                          }}
                          className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
                        >
                          <Globe className="w-4 h-4" />
                          Manage IP Whitelist
                        </button>
                        <button
                          onClick={() => handleToggleStatus(partner)}
                          disabled={actionLoading}
                          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm transition-colors disabled:opacity-50 ${
                            partner.status === 'active'
                              ? 'bg-red-600 hover:bg-red-700'
                              : 'bg-green-600 hover:bg-green-700'
                          }`}
                        >
                          {partner.status === 'active' ? (
                            <><Lock className="w-4 h-4" /> Suspend</>
                          ) : (
                            <><Unlock className="w-4 h-4" /> Activate</>
                          )}
                        </button>
                      </div>

                      {/* API Keys Section */}
                      <div>
                        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                          <Key className="w-4 h-4" />
                          API Keys
                        </h4>
                        {partner.api_keys?.length === 0 ? (
                          <p className="text-sm text-gray-500 dark:text-gray-400 italic">No API keys generated yet</p>
                        ) : (
                          <div className="space-y-2">
                            {partner.api_keys?.map((key) => (
                              <div
                                key={key.id}
                                className={`p-3 rounded-lg border ${
                                  key.is_active
                                    ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/10'
                                    : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10 opacity-60'
                                }`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                      <code className="text-sm font-mono bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">
                                        {key.api_key}
                                      </code>
                                      <button
                                        onClick={() => copyToClipboard(key.api_key, 'API Key')}
                                        className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded"
                                        title="Copy API Key"
                                      >
                                        <Copy className="w-3.5 h-3.5 text-gray-500" />
                                      </button>
                                      {key.is_active ? (
                                        <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                                          <CheckCircle className="w-3 h-3" /> Active
                                        </span>
                                      ) : (
                                        <span className="text-xs text-red-600 font-medium flex items-center gap-1">
                                          <XCircle className="w-3 h-3" /> Revoked
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                                      <span>Label: {key.label}</span>
                                      <span>Secret: {key.api_secret_masked}</span>
                                      <span className="flex items-center gap-1">
                                        <Clock className="w-3 h-3" />
                                        Last used: {formatDate(key.last_used_at)}
                                      </span>
                                      <span>Created: {formatDate(key.created_at)}</span>
                                    </div>
                                  </div>
                                  {key.is_active && (
                                    <button
                                      onClick={() => handleRevokeKey(key.id)}
                                      className="p-2 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                                      title="Revoke Key"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Security Settings */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* IP Whitelist */}
                        <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
                          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                            <Shield className="w-4 h-4" />
                            IP Whitelist
                          </h4>
                          {partner.ip_whitelist && partner.ip_whitelist.length > 0 ? (
                            <div className="space-y-1">
                              {partner.ip_whitelist.map((ip, idx) => (
                                <div key={idx} className="flex items-center gap-2">
                                  <CheckCircle className="w-3 h-3 text-green-500 flex-shrink-0" />
                                  <code className="text-sm font-mono text-gray-700 dark:text-gray-300">{ip}</code>
                                </div>
                              ))}
                              <p className="text-xs text-green-600 dark:text-green-400 mt-2 font-medium">
                                ✅ API access enabled for whitelisted IPs
                              </p>
                            </div>
                          ) : (
                            <div>
                              <p className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1 font-semibold">
                                <XCircle className="w-4 h-4" />
                                API BLOCKED — No IPs whitelisted
                              </p>
                              <p className="text-xs text-red-500 dark:text-red-400 mt-1">
                                Partner cannot access the API until at least one IP is whitelisted.
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Export Limits */}
                        <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
                          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                            <Download className="w-4 h-4" />
                            Daily Export Limit
                          </h4>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={1}
                              max={100}
                              defaultValue={partner.export_limit}
                              onChange={(e) => setExportLimitValue(parseInt(e.target.value) || 10)}
                              className="w-20 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800"
                            />
                            <span className="text-sm text-gray-500">exports/day</span>
                            <button
                              onClick={() => handleUpdateExportLimit(partner)}
                              disabled={actionLoading}
                              className="px-3 py-2 bg-gray-600 text-white text-sm rounded-lg hover:bg-gray-700 disabled:opacity-50"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Partner Details */}
                      <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
                        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Partner Details</h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                          <div><span className="text-gray-500">ID:</span> <code className="text-xs">{partner.id.substring(0, 8)}...</code></div>
                          <div><span className="text-gray-500">Phone:</span> {partner.phone}</div>
                          <div><span className="text-gray-500">Created:</span> {formatDate(partner.created_at)}</div>
                          <div><span className="text-gray-500">Webhook:</span> {partner.webhook_url || 'Not set'}</div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      )}

      {/* ─── New Key Result Modal ─────────────────────────── */}
      <AnimatePresence>
        {showNewKeyResult && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-lg shadow-2xl"
            >
              <div className="px-6 py-4 bg-gradient-to-r from-green-500 to-emerald-600 rounded-t-2xl flex items-center justify-between">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <CheckCircle className="w-5 h-5" />
                  API Key Generated
                </h3>
                <button onClick={() => setShowNewKeyResult(null)} className="p-1 hover:bg-white/20 rounded-lg">
                  <X className="w-5 h-5 text-white" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                  <p className="text-sm text-red-800 dark:text-red-300 font-semibold flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    SAVE THE API SECRET NOW! It cannot be retrieved again.
                  </p>
                </div>

                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Partner</label>
                  <p className="font-semibold text-gray-900 dark:text-white">{showNewKeyResult.partner_name}</p>
                </div>

                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">API Key (Public)</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-sm font-mono break-all">
                      {showNewKeyResult.api_key}
                    </code>
                    <button
                      onClick={() => copyToClipboard(showNewKeyResult.api_key, 'API Key')}
                      className="p-2 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded-lg hover:bg-blue-200"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-gray-500 mb-1 block">API Secret (Private — SAVE NOW)</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-3 py-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg text-sm font-mono break-all text-yellow-900 dark:text-yellow-200">
                      {showNewKeyResult.api_secret}
                    </code>
                    <button
                      onClick={() => copyToClipboard(showNewKeyResult.api_secret, 'API Secret')}
                      className="p-2 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 rounded-lg hover:bg-yellow-200"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <button
                  onClick={() => {
                    const text = `POS Partner API Credentials\n\nPartner: ${showNewKeyResult.partner_name}\nAPI Key: ${showNewKeyResult.api_key}\nAPI Secret: ${showNewKeyResult.api_secret}\n\nBase URL: https://api.samedaysolution.in\n\nKeep the API Secret safe. Do not share via insecure channels.`
                    copyToClipboard(text, 'Full credentials')
                  }}
                  className="w-full py-2 bg-gray-900 dark:bg-gray-700 text-white rounded-lg hover:bg-gray-800 text-sm font-medium flex items-center justify-center gap-2"
                >
                  <Copy className="w-4 h-4" />
                  Copy All Credentials
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ─── IP Whitelist Modal ───────────────────────────── */}
      <AnimatePresence>
        {showWhitelistModal && selectedPartner && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-2xl"
            >
              <div className="px-6 py-4 bg-gradient-to-r from-purple-500 to-indigo-600 rounded-t-2xl flex items-center justify-between">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Shield className="w-5 h-5" />
                  IP Whitelist — {selectedPartner.name}
                </h3>
                <button onClick={() => setShowWhitelistModal(false)} className="p-1 hover:bg-white/20 rounded-lg">
                  <X className="w-5 h-5 text-white" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Enter partner&apos;s server IP addresses (one per line). Only these IPs will be allowed to call the API.
                  Leave empty to allow all IPs.
                </p>
                <textarea
                  rows={6}
                  value={whitelistIps}
                  onChange={(e) => setWhitelistIps(e.target.value)}
                  placeholder="203.0.113.50&#10;198.51.100.25&#10;192.168.1.100"
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 font-mono text-sm"
                />
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowWhitelistModal(false)}
                    className="flex-1 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpdateWhitelist}
                    disabled={actionLoading}
                    className="flex-1 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {actionLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Save Whitelist
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}

