'use client'

import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '@/lib/api-client'
import { Users, Plus, CheckCircle2, XCircle } from 'lucide-react'
import { getPosCompanies } from '@/lib/merchant-companies'

interface PartnerScheme {
  id: string
  partner_id: string
  mode: string
  card_type: string | null
  brand_type: string | null
  merchant_slug: string | null
  partner_mdr_t0: number
  partner_mdr_t1: number
  status: string
  effective_date: string
}

interface PartnerOption {
  partner_id: string
  name: string
  business_name?: string | null
  email?: string | null
}

export default function PartnerMdrSchemesCard({
  partners = [],
  readOnly = false,
}: {
  partners?: PartnerOption[]
  readOnly?: boolean
}) {
  const [schemes, setSchemes] = useState<PartnerScheme[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [newScheme, setNewScheme] = useState({
    partner_id: '',
    mode: 'CARD',
    card_type: '',
    brand_type: '',
    merchant_slug: '',
    partner_mdr_t0: 1.5,
    partner_mdr_t1: 0.5,
  })

  const posCompanies = getPosCompanies()
  const companyLabel = (slug: string | null) => {
    if (!slug) return 'All Brands'
    return posCompanies.find(c => c.slug === slug)?.shortName || slug
  }

  const showMessage = (type: 'success' | 'error', text: string) => {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 5000)
  }

  const partnerLabel = (id: string) => {
    const p = partners.find(x => x.partner_id === id)
    return p ? (p.business_name || p.name) : `${id.substring(0, 8)}...`
  }

  const fetchSchemes = useCallback(async () => {
    try {
      const res = await apiFetch('/api/admin/partner-schemes?status=active')
      const data = await res.json()
      if (data.data) setSchemes(data.data)
    } catch (err: any) {
      console.error('Failed to fetch partner schemes:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSchemes()
  }, [fetchSchemes])

  const handleCreate = async () => {
    if (!newScheme.partner_id) {
      showMessage('error', 'Select a partner')
      return
    }
    setSaving(true)
    try {
      const res = await apiFetch('/api/admin/partner-schemes', {
        method: 'POST',
        body: JSON.stringify({
          ...newScheme,
          card_type: newScheme.card_type || null,
          brand_type: newScheme.brand_type || null,
          merchant_slug: newScheme.merchant_slug || null,
        }),
      })
      const data = await res.json()
      if (data.data) {
        await fetchSchemes()
        setShowForm(false)
        setNewScheme({ partner_id: '', mode: 'CARD', card_type: '', brand_type: '', merchant_slug: '', partner_mdr_t0: 1.5, partner_mdr_t1: 0.5 })
        showMessage('success', 'Partner MDR scheme created')
      } else {
        showMessage('error', data.error || 'Failed to create scheme')
      }
    } catch (err: any) {
      showMessage('error', err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDeactivate = async (id: string) => {
    if (!confirm('Deactivate this partner MDR scheme? T+1 settlement will fail for this partner until a new scheme is assigned.')) return
    setTogglingId(id)
    try {
      const res = await apiFetch('/api/admin/partner-schemes', {
        method: 'PUT',
        body: JSON.stringify({ id, status: 'inactive' }),
      })
      const data = await res.json()
      if (data.data) {
        setSchemes(prev => prev.filter(s => s.id !== id))
        showMessage('success', 'Scheme deactivated')
      } else {
        showMessage('error', data.error || 'Failed to deactivate')
      }
    } catch (err: any) {
      showMessage('error', err.message)
    } finally {
      setTogglingId(null)
    }
  }

  const inputClass = 'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-1 focus:ring-primary-500'

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-md border border-gray-200 dark:border-gray-700">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <Users className="w-4 h-4 text-purple-600" />
            Partner MDR Schemes
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            MDR deducted on every partner settlement (Instant, Pulse Pay, T+1). Brand-specific schemes override &quot;All Brands&quot;. One active scheme per partner / brand / mode / card.
          </p>
        </div>
        {!readOnly && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-medium hover:bg-purple-700 transition-colors"
          >
            <Plus className="w-4 h-4" /> New Scheme
          </button>
        )}
      </div>

      {message && (
        <div className={`mx-4 mt-3 p-2.5 rounded-lg text-sm font-medium ${
          message.type === 'success'
            ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
            : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
        }`}>
          {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 inline mr-1.5" /> : <XCircle className="w-4 h-4 inline mr-1.5" />}
          {message.text}
        </div>
      )}

      {showForm && !readOnly && (
        <div className="m-4 p-4 bg-gray-50 dark:bg-gray-700/40 rounded-lg space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Partner</label>
            <select
              value={newScheme.partner_id}
              onChange={(e) => setNewScheme({ ...newScheme, partner_id: e.target.value })}
              className={inputClass}
            >
              <option value="">Select partner...</option>
              {partners.map(p => (
                <option key={p.partner_id} value={p.partner_id}>
                  {(p.business_name || p.name)}{p.email ? ` — ${p.email}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Brand (Company)</label>
              <select value={newScheme.merchant_slug} onChange={(e) => setNewScheme({ ...newScheme, merchant_slug: e.target.value })} className={inputClass}>
                <option value="">All Brands</option>
                {posCompanies.map(c => (
                  <option key={c.slug} value={c.slug}>{c.shortName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Mode</label>
              <select value={newScheme.mode} onChange={(e) => setNewScheme({ ...newScheme, mode: e.target.value })} className={inputClass}>
                <option value="CARD">CARD</option>
                <option value="UPI">UPI</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Card Type</label>
              <select value={newScheme.card_type} onChange={(e) => setNewScheme({ ...newScheme, card_type: e.target.value })} className={inputClass}>
                <option value="">Any</option>
                <option value="CREDIT">CREDIT</option>
                <option value="DEBIT">DEBIT</option>
                <option value="PREPAID">PREPAID</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Brand</label>
              <select value={newScheme.brand_type} onChange={(e) => setNewScheme({ ...newScheme, brand_type: e.target.value })} className={inputClass}>
                <option value="">Any</option>
                <option value="VISA">VISA</option>
                <option value="MASTERCARD">MASTERCARD</option>
                <option value="RUPAY">RUPAY</option>
                <option value="AMEX">AMEX</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">MDR T+0 (%)</label>
              <input
                type="number" step="0.01" min="0" max="100"
                value={newScheme.partner_mdr_t0}
                onChange={(e) => setNewScheme({ ...newScheme, partner_mdr_t0: Number(e.target.value) })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">MDR T+1 (%)</label>
              <input
                type="number" step="0.01" min="0" max="100"
                value={newScheme.partner_mdr_t1}
                onChange={(e) => setNewScheme({ ...newScheme, partner_mdr_t1: Number(e.target.value) })}
                className={inputClass}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={saving}
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Creating...' : 'Create Scheme'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-medium hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        {loading ? (
          <div className="px-4 py-8 text-center text-gray-400 text-sm">Loading partner schemes...</div>
        ) : schemes.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-400 text-sm">
            No partner schemes configured yet. Create one to enable partner T+1 auto settlement.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Partner</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Brand</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Mode</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Card Type</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Brand</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">MDR T+0</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">MDR T+1</th>
                {!readOnly && (
                  <th className="px-4 py-2.5 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {schemes.map(scheme => (
                <tr key={scheme.id} className="hover:bg-gray-50 dark:hover:bg-gray-750">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-gray-900 dark:text-white">{partnerLabel(scheme.partner_id)}</div>
                    <div className="font-mono text-xs text-gray-500">{scheme.partner_id.substring(0, 8)}...</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                      scheme.merchant_slug
                        ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400'
                        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                    }`}>
                      {companyLabel(scheme.merchant_slug)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300">{scheme.mode}</td>
                  <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300">{scheme.card_type || 'Any'}</td>
                  <td className="px-4 py-2.5 text-gray-700 dark:text-gray-300">{scheme.brand_type || 'Any'}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-900 dark:text-white">{scheme.partner_mdr_t0}%</td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-900 dark:text-white">{scheme.partner_mdr_t1}%</td>
                  {!readOnly && (
                    <td className="px-4 py-2.5 text-center">
                      <button
                        onClick={() => handleDeactivate(scheme.id)}
                        disabled={togglingId === scheme.id}
                        className="px-3 py-1 rounded-lg text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 disabled:opacity-50 transition-colors"
                      >
                        {togglingId === scheme.id ? '...' : 'Deactivate'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
