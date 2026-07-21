'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'
import { AuthUser, SubPartner } from '@/types/database.types'
import {
  Users2, Plus, Edit2, Trash2, Shield, Eye, EyeOff,
  Loader2, AlertCircle, CheckCircle, X, KeyRound,
  UserPlus, Search, ToggleLeft, ToggleRight, Crown
} from 'lucide-react'

const PERMISSION_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  wallet: 'Wallet',
  transactions: 'Transactions',
  ledger: 'Ledger',
  services: 'API Integrations',
  bbps: 'BBPS-1',
  'bbps-2': 'BBPS-2',
  'credit-card': 'Credit Card',
  'credit-card-2': 'Credit Card-2',
  payout: 'Settlement-1',
  'settlement-2': 'Settlement-2',
  aeps: 'AEPS',
  'aeps-ledger': 'AEPS Ledger',
  'pos-machines': 'POS Machines',
  subscriptions: 'Subscriptions',
  'mdr-schemes': 'MDR Schemes',
  reports: 'Reports',
  'api-dashboard': 'API Dashboard',
  analytics: 'Business Analytics',
  reconciliation: 'Reconciliation',
  'api-management': 'API Management',
  settings: 'Settings',
  'sub-partners': 'Manage Team',
}

const PERMISSION_GROUPS: { label: string; keys: string[] }[] = [
  { label: 'Core', keys: ['dashboard', 'wallet', 'transactions', 'ledger'] },
  { label: 'Services', keys: ['services', 'bbps', 'bbps-2', 'credit-card', 'credit-card-2', 'payout', 'settlement-2', 'aeps', 'aeps-ledger'] },
  { label: 'POS & Subscriptions', keys: ['pos-machines', 'subscriptions', 'mdr-schemes'] },
  { label: 'Reports & Analytics', keys: ['reports', 'api-dashboard', 'analytics', 'reconciliation'] },
  { label: 'Administration', keys: ['api-management', 'settings', 'sub-partners'] },
]

const DESIGNATION_OPTIONS = ['Manager', 'Accountant', 'Operator', 'Support', 'Custom']

interface Props {
  user: AuthUser
}

export default function SubPartnersManagement({ user }: Props) {
  const [subPartners, setSubPartners] = useState<SubPartner[]>([])
  const [limit, setLimit] = useState(5)
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingPartner, setEditingPartner] = useState<SubPartner | null>(null)
  const [showPasswordModal, setShowPasswordModal] = useState<SubPartner | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const isMainPartner = user.role === 'partner'

  const fetchSubPartners = useCallback(async () => {
    try {
      setLoading(true)
      const res = await apiFetch('/api/partner/sub-partners')
      const data = await res.json()
      if (data.success) {
        setSubPartners(data.data || [])
        setLimit(data.limit || 5)
        setEnabled(data.enabled === true)
      } else {
        setError(data.error || 'Failed to load team members')
      }
    } catch {
      setError('Failed to load team members')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSubPartners() }, [fetchSubPartners])

  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(''), 4000)
      return () => clearTimeout(t)
    }
  }, [success])

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to remove this team member? This will also delete their login account.')) return
    setDeletingId(id)
    setError('')
    try {
      const res = await apiFetch('/api/partner/sub-partners', {
        method: 'DELETE',
        body: JSON.stringify({ id }),
      })
      const data = await res.json()
      if (data.success) {
        setSubPartners(prev => prev.filter(sp => sp.id !== id))
        setSuccess('Team member removed successfully')
      } else {
        setError(data.error || 'Failed to remove team member')
      }
    } catch {
      setError('Failed to remove team member')
    } finally {
      setDeletingId(null)
    }
  }

  const handleToggleStatus = async (sp: SubPartner) => {
    const newStatus = sp.status === 'active' ? 'inactive' : 'active'
    try {
      const res = await apiFetch('/api/partner/sub-partners', {
        method: 'PUT',
        body: JSON.stringify({ id: sp.id, status: newStatus }),
      })
      const data = await res.json()
      if (data.success) {
        setSubPartners(prev => prev.map(p => p.id === sp.id ? { ...p, status: newStatus } : p))
        setSuccess(`Team member ${newStatus === 'active' ? 'activated' : 'deactivated'}`)
      } else {
        setError(data.error || 'Failed to update status')
      }
    } catch {
      setError('Failed to update status')
    }
  }

  const filtered = subPartners.filter(sp =>
    !search || sp.name.toLowerCase().includes(search.toLowerCase()) ||
    sp.email.toLowerCase().includes(search.toLowerCase()) ||
    (sp.designation || '').toLowerCase().includes(search.toLowerCase())
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
      </div>
    )
  }

  if (!enabled) {
    return (
      <div className="space-y-6">
        <div className="text-center py-16 bg-gray-50 rounded-xl border border-dashed border-gray-300">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gray-100 flex items-center justify-center">
            <Shield className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-700 mb-2">Team Members Not Enabled</h3>
          <p className="text-gray-500 text-sm max-w-md mx-auto mb-4">
            The team members (sub-partners) feature is not enabled for your account.
            Please contact your administrator to enable this feature.
          </p>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-lg text-sm text-gray-600">
            <AlertCircle className="w-4 h-4" />
            Admin must enable this from the Partners Management panel
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users2 className="w-6 h-6 text-purple-600" />
            Team Members
          </h2>
          <p className="text-gray-500 text-sm mt-1">
            {subPartners.length} / {limit} members
            {!isMainPartner && ' (view only)'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search members..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none w-48"
            />
          </div>
          {isMainPartner && (
            <button
              onClick={() => setShowCreateModal(true)}
              disabled={subPartners.length >= limit}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:from-purple-600 hover:to-pink-600 transition-all text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-purple-500/20"
            >
              <UserPlus className="w-4 h-4" />
              Add Member
            </button>
          )}
        </div>
      </div>

      {/* Alerts */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
          <button onClick={() => setError('')} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}
      {success && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2 text-green-700 text-sm">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}

      {/* Members List */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 rounded-xl border border-dashed border-gray-300">
          <Users2 className="w-12 h-12 mx-auto text-gray-300 mb-4" />
          <h3 className="text-lg font-semibold text-gray-600 mb-2">
            {search ? 'No members found' : 'No Team Members Yet'}
          </h3>
          <p className="text-gray-400 text-sm mb-6 max-w-md mx-auto">
            {search
              ? 'Try a different search term'
              : 'Add team members to allow multiple logins with different roles and permissions'}
          </p>
          {isMainPartner && !search && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg hover:from-purple-600 hover:to-pink-600 text-sm font-medium shadow-md"
            >
              <UserPlus className="w-4 h-4" />
              Add Your First Team Member
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map((sp) => (
            <div
              key={sp.id}
              className={`bg-white rounded-xl border p-5 transition-all hover:shadow-md ${
                sp.status === 'active' ? 'border-gray-200' : 'border-red-200 bg-red-50/30'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4 min-w-0">
                  <div className={`w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0 ${
                    sp.status === 'active'
                      ? 'bg-gradient-to-br from-purple-500 to-pink-500'
                      : 'bg-gray-400'
                  }`}>
                    {sp.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900 truncate">{sp.name}</h3>
                      <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
                        sp.status === 'active'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        {sp.status}
                      </span>
                      {sp.designation && (
                        <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-700">
                          {sp.designation}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 truncate">{sp.email}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{sp.phone}</p>
                    {/* Permission badges */}
                    <div className="flex flex-wrap gap-1 mt-2">
                      {Object.entries(sp.permissions || {})
                        .filter(([, v]) => v)
                        .slice(0, 6)
                        .map(([key]) => (
                          <span key={key} className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-gray-100 text-gray-600">
                            {PERMISSION_LABELS[key] || key}
                          </span>
                        ))}
                      {Object.values(sp.permissions || {}).filter(Boolean).length > 6 && (
                        <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-gray-100 text-gray-600">
                          +{Object.values(sp.permissions || {}).filter(Boolean).length - 6} more
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                {isMainPartner && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleToggleStatus(sp)}
                      className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                      title={sp.status === 'active' ? 'Deactivate' : 'Activate'}
                    >
                      {sp.status === 'active'
                        ? <ToggleRight className="w-5 h-5 text-green-500" />
                        : <ToggleLeft className="w-5 h-5 text-gray-400" />}
                    </button>
                    <button
                      onClick={() => setEditingPartner(sp)}
                      className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                      title="Edit permissions"
                    >
                      <Edit2 className="w-4 h-4 text-gray-500" />
                    </button>
                    <button
                      onClick={() => setShowPasswordModal(sp)}
                      className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
                      title="Reset password"
                    >
                      <KeyRound className="w-4 h-4 text-gray-500" />
                    </button>
                    <button
                      onClick={() => handleDelete(sp.id)}
                      disabled={deletingId === sp.id}
                      className="p-2 rounded-lg hover:bg-red-50 transition-colors"
                      title="Remove member"
                    >
                      {deletingId === sp.id
                        ? <Loader2 className="w-4 h-4 animate-spin text-red-500" />
                        : <Trash2 className="w-4 h-4 text-red-400" />}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info card */}
      <div className="bg-purple-50/50 border border-purple-200/50 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-purple-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-purple-700">
            <p className="font-medium mb-1">How Team Members Work</p>
            <ul className="space-y-1 text-purple-600/80 text-xs">
              <li>Each team member gets their own login credentials (email + password)</li>
              <li>They log in via the <strong>Partner</strong> option on the Business Login page</li>
              <li>Each member can only be logged in on one device at a time (single-session security)</li>
              <li>You control which tabs and features each member can access</li>
              <li>All actions are tracked under their individual account for audit purposes</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <CreateSubPartnerModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(sp) => {
            setSubPartners(prev => [sp, ...prev])
            setShowCreateModal(false)
            setSuccess('Team member created successfully! They can now login.')
          }}
        />
      )}

      {/* Edit Modal */}
      {editingPartner && (
        <EditSubPartnerModal
          subPartner={editingPartner}
          onClose={() => setEditingPartner(null)}
          onUpdated={() => {
            setEditingPartner(null)
            fetchSubPartners()
            setSuccess('Team member updated successfully')
          }}
        />
      )}

      {/* Password Modal */}
      {showPasswordModal && (
        <SetPasswordModal
          subPartner={showPasswordModal}
          onClose={() => setShowPasswordModal(null)}
          onSuccess={() => {
            setShowPasswordModal(null)
            setSuccess('Password updated successfully')
          }}
        />
      )}
    </div>
  )
}

/* ──────────── Create Modal ──────────── */
function CreateSubPartnerModal({ onClose, onCreated }: { onClose: () => void; onCreated: (sp: SubPartner) => void }) {
  const [form, setForm] = useState({
    name: '', email: '', phone: '', password: '', designation: 'Operator',
  })
  const [permissions, setPermissions] = useState<Record<string, boolean>>({
    dashboard: true, wallet: false, transactions: true, ledger: false,
    services: false, bbps: false, 'bbps-2': false, 'credit-card': false, 'credit-card-2': false,
    payout: false, 'settlement-2': false, aeps: false, 'aeps-ledger': false,
    'pos-machines': false, subscriptions: false, 'mdr-schemes': false,
    reports: false, 'api-dashboard': false, analytics: false, reconciliation: false,
    'api-management': false, settings: false, 'sub-partners': false,
  })
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!form.name || !form.email || !form.phone || !form.password) {
      setError('All fields are required')
      return
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setLoading(true)
    try {
      const res = await apiFetch('/api/partner/sub-partners', {
        method: 'POST',
        body: JSON.stringify({ ...form, permissions }),
      })
      const data = await res.json()
      if (data.success) {
        onCreated(data.data)
      } else {
        setError(data.error || 'Failed to create team member')
      }
    } catch {
      setError('Failed to create team member')
    } finally {
      setLoading(false)
    }
  }

  const toggleAll = (groupKeys: string[], value: boolean) => {
    setPermissions(prev => {
      const updated = { ...prev }
      groupKeys.forEach(k => { updated[k] = value })
      return updated
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b p-5 rounded-t-2xl z-10">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-purple-600" />
              Add Team Member
            </h3>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-5 h-5 text-gray-400" /></button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
              <AlertCircle className="w-4 h-4" />{error}
            </div>
          )}

          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
              <input
                type="text" required value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                placeholder="John Doe"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Designation</label>
              <select
                value={form.designation}
                onChange={e => setForm(f => ({ ...f, designation: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
              >
                {DESIGNATION_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email Address *</label>
            <input
              type="email" required value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
              placeholder="member@company.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number *</label>
            <input
              type="tel" required value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
              placeholder="+91 9876543210"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'} required
                value={form.password} minLength={8}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                placeholder="Min. 8 characters"
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Permissions */}
          <div className="border-t pt-4">
            <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Shield className="w-4 h-4 text-purple-500" />
              Permissions
            </h4>
            <div className="space-y-4">
              {PERMISSION_GROUPS.map(group => (
                <div key={group.label}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{group.label}</span>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => toggleAll(group.keys, true)} className="text-[10px] text-purple-600 hover:underline">All</button>
                      <button type="button" onClick={() => toggleAll(group.keys, false)} className="text-[10px] text-gray-400 hover:underline">None</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {group.keys.map(key => (
                      <label key={key} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 p-1.5 rounded">
                        <input
                          type="checkbox"
                          checked={permissions[key] || false}
                          onChange={e => setPermissions(p => ({ ...p, [key]: e.target.checked }))}
                          className="w-3.5 h-3.5 text-purple-600 rounded focus:ring-purple-500 border-gray-300"
                        />
                        <span className="text-gray-700 text-xs">{PERMISSION_LABELS[key] || key}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="submit" disabled={loading}
              className="flex-1 px-4 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg text-sm font-medium hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</> : <><UserPlus className="w-4 h-4" /> Create Member</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ──────────── Edit Modal ──────────── */
function EditSubPartnerModal({ subPartner, onClose, onUpdated }: { subPartner: SubPartner; onClose: () => void; onUpdated: () => void }) {
  const [form, setForm] = useState({
    name: subPartner.name,
    phone: subPartner.phone,
    designation: subPartner.designation || 'Operator',
  })
  const [permissions, setPermissions] = useState<Record<string, boolean>>(subPartner.permissions || {})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await apiFetch('/api/partner/sub-partners', {
        method: 'PUT',
        body: JSON.stringify({ id: subPartner.id, ...form, permissions }),
      })
      const data = await res.json()
      if (data.success) {
        onUpdated()
      } else {
        setError(data.error || 'Failed to update')
      }
    } catch {
      setError('Failed to update')
    } finally {
      setLoading(false)
    }
  }

  const toggleAll = (groupKeys: string[], value: boolean) => {
    setPermissions(prev => {
      const updated = { ...prev }
      groupKeys.forEach(k => { updated[k] = value })
      return updated
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b p-5 rounded-t-2xl z-10">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <Edit2 className="w-5 h-5 text-purple-600" />
              Edit {subPartner.name}
            </h3>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-5 h-5 text-gray-400" /></button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
              <AlertCircle className="w-4 h-4" />{error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <input
                type="text" required value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Designation</label>
              <select
                value={form.designation}
                onChange={e => setForm(f => ({ ...f, designation: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
              >
                {DESIGNATION_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email (cannot be changed)</label>
            <input type="email" value={subPartner.email} disabled className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="tel" required value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
            />
          </div>

          {/* Permissions */}
          <div className="border-t pt-4">
            <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
              <Shield className="w-4 h-4 text-purple-500" />
              Permissions
            </h4>
            <div className="space-y-4">
              {PERMISSION_GROUPS.map(group => (
                <div key={group.label}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{group.label}</span>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => toggleAll(group.keys, true)} className="text-[10px] text-purple-600 hover:underline">All</button>
                      <button type="button" onClick={() => toggleAll(group.keys, false)} className="text-[10px] text-gray-400 hover:underline">None</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {group.keys.map(key => (
                      <label key={key} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 p-1.5 rounded">
                        <input
                          type="checkbox"
                          checked={permissions[key] || false}
                          onChange={e => setPermissions(p => ({ ...p, [key]: e.target.checked }))}
                          className="w-3.5 h-3.5 text-purple-600 rounded focus:ring-purple-500 border-gray-300"
                        />
                        <span className="text-gray-700 text-xs">{PERMISSION_LABELS[key] || key}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="submit" disabled={loading}
              className="flex-1 px-4 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg text-sm font-medium hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ──────────── Set Password Modal ──────────── */
function SetPasswordModal({ subPartner, onClose, onSuccess }: { subPartner: SubPartner; onClose: () => void; onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setError('')
    setLoading(true)
    try {
      const res = await apiFetch('/api/partner/sub-partners/set-password', {
        method: 'POST',
        body: JSON.stringify({ sub_partner_id: subPartner.id, password }),
      })
      const data = await res.json()
      if (data.success) {
        onSuccess()
      } else {
        setError(data.error || 'Failed to update password')
      }
    } catch {
      setError('Failed to update password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-purple-600" />
              Reset Password
            </h3>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-5 h-5 text-gray-400" /></button>
          </div>
          <p className="text-sm text-gray-500 mt-1">Set a new password for {subPartner.name}</p>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
              <AlertCircle className="w-4 h-4" />{error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password} required minLength={8}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none"
                placeholder="Min. 8 characters"
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="submit" disabled={loading}
              className="flex-1 px-4 py-2.5 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
