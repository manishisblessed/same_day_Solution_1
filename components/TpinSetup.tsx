'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { apiFetchJson } from '@/lib/api-client'
import { motion } from 'framer-motion'
import { Shield, Key, Lock, Check, AlertCircle, Eye, EyeOff, RefreshCw } from 'lucide-react'

interface TpinStatus {
  tpin_enabled: boolean
  is_locked: boolean
  locked_until: string | null
}

/**
 * Reusable TPIN setup/change card.
 * Works for any role — the /api/tpin endpoint resolves the correct table
 * (retailers/distributors/partners) from the authenticated user's role.
 */
export default function TpinSetup() {
  const { user } = useAuth()
  const [tpinStatus, setTpinStatus] = useState<TpinStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [showTpinSetup, setShowTpinSetup] = useState(false)
  const [currentTpin, setCurrentTpin] = useState('')
  const [newTpin, setNewTpin] = useState('')
  const [confirmTpin, setConfirmTpin] = useState('')
  const [showCurrentTpin, setShowCurrentTpin] = useState(false)
  const [showNewTpin, setShowNewTpin] = useState(false)
  const [showConfirmTpin, setShowConfirmTpin] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (user?.partner_id) fetchTpinStatus()
  }, [user?.partner_id])

  const fetchTpinStatus = async () => {
    if (!user?.partner_id) return
    setLoading(true)
    try {
      const response = await apiFetchJson<any>(`/api/tpin?user_id=${user.partner_id}`)
      if (response.success) {
        setTpinStatus({
          tpin_enabled: response.tpin_enabled,
          is_locked: response.is_locked,
          locked_until: response.locked_until,
        })
      }
    } catch (error: any) {
      console.error('Error fetching TPIN status:', error)
      if (error.message?.includes('Session expired') || error.message?.includes('Authentication')) {
        setMessage({ type: 'error', text: 'Session expired. Please refresh the page or login again.' })
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSetTpin = async () => {
    setMessage(null)
    if (newTpin.length !== 4) {
      setMessage({ type: 'error', text: 'TPIN must be exactly 4 digits' })
      return
    }
    if (newTpin !== confirmTpin) {
      setMessage({ type: 'error', text: 'New TPIN and confirmation do not match' })
      return
    }
    if (tpinStatus?.tpin_enabled && !currentTpin) {
      setMessage({ type: 'error', text: 'Current TPIN is required to change TPIN' })
      return
    }

    setSaving(true)
    try {
      const response = await apiFetchJson<any>('/api/tpin', {
        method: 'POST',
        body: JSON.stringify({
          tpin: newTpin,
          current_tpin: tpinStatus?.tpin_enabled ? currentTpin : undefined,
          user_id: user?.partner_id,
        }),
      })

      if (response.success) {
        setMessage({ type: 'success', text: response.message || 'TPIN set successfully!' })
        setShowTpinSetup(false)
        setCurrentTpin('')
        setNewTpin('')
        setConfirmTpin('')
        fetchTpinStatus()
      } else {
        setMessage({ type: 'error', text: response.error || 'Failed to set TPIN' })
      }
    } catch (error: any) {
      const msg = error.message || 'Failed to set TPIN'
      setMessage({ type: 'error', text: msg.includes('Session expired') ? 'Session expired. Please refresh the page or login again.' : msg })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6"
    >
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
          <Shield className="w-6 h-6 text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Transaction PIN (TPIN)</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">Secure your settlements with a 4-digit PIN</p>
        </div>
      </div>

      {message && (
        <div className={`mb-4 p-3 rounded-lg flex items-center gap-2 ${
          message.type === 'success'
            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
            : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
        }`}>
          {message.type === 'success' ? <Check className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          {message.text}
        </div>
      )}

      <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Key className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            <div>
              <p className="font-medium text-gray-900 dark:text-white">TPIN Status</p>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {tpinStatus?.tpin_enabled ? 'Your TPIN is set and active' : 'TPIN not configured'}
              </p>
            </div>
          </div>
          <span className={`px-3 py-1 text-sm rounded-full ${
            tpinStatus?.tpin_enabled
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
          }`}>
            {tpinStatus?.tpin_enabled ? 'Active' : 'Not Set'}
          </span>
        </div>

        {tpinStatus?.is_locked && (
          <div className="mt-3 p-2 bg-red-50 dark:bg-red-900/20 rounded text-red-700 dark:text-red-400 text-sm flex items-center gap-2">
            <Lock className="w-4 h-4" />
            Account locked due to failed attempts. Try again after {new Date(tpinStatus.locked_until!).toLocaleTimeString()}
          </div>
        )}
      </div>

      {!showTpinSetup ? (
        <button
          onClick={() => setShowTpinSetup(true)}
          disabled={tpinStatus?.is_locked}
          className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Key className="w-5 h-5" />
          {tpinStatus?.tpin_enabled ? 'Change TPIN' : 'Set Up TPIN'}
        </button>
      ) : (
        <div className="space-y-4">
          {tpinStatus?.tpin_enabled && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Current TPIN</label>
              <div className="relative">
                <input
                  type={showCurrentTpin ? 'text' : 'password'}
                  value={currentTpin}
                  onChange={(e) => setCurrentTpin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="Enter current TPIN"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white pr-10"
                  maxLength={4}
                />
                <button type="button" onClick={() => setShowCurrentTpin(!showCurrentTpin)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                  {showCurrentTpin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">New TPIN (4 digits)</label>
            <div className="relative">
              <input
                type={showNewTpin ? 'text' : 'password'}
                value={newTpin}
                onChange={(e) => setNewTpin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="Enter new 4-digit TPIN"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white pr-10"
                maxLength={4}
              />
              <button type="button" onClick={() => setShowNewTpin(!showNewTpin)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                {showNewTpin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirm TPIN</label>
            <div className="relative">
              <input
                type={showConfirmTpin ? 'text' : 'password'}
                value={confirmTpin}
                onChange={(e) => setConfirmTpin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="Re-enter new TPIN"
                className="w-full px-4 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                maxLength={4}
              />
              <button type="button" onClick={() => setShowConfirmTpin(!showConfirmTpin)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                {showConfirmTpin ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => {
                setShowTpinSetup(false)
                setCurrentTpin('')
                setNewTpin('')
                setConfirmTpin('')
                setMessage(null)
              }}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSetTpin}
              disabled={saving || newTpin.length !== 4 || newTpin !== confirmTpin}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <><RefreshCw className="w-4 h-4 animate-spin" /> Saving...</>
              ) : (
                <><Check className="w-4 h-4" /> {tpinStatus?.tpin_enabled ? 'Change TPIN' : 'Set TPIN'}</>
              )}
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
        <h4 className="font-medium text-blue-800 dark:text-blue-300 mb-2">Why use TPIN?</h4>
        <ul className="text-sm text-blue-700 dark:text-blue-400 space-y-1">
          <li>• Required for all settlement/payout transactions</li>
          <li>• Adds extra security layer to your transactions</li>
          <li>• Account locks after 5 failed attempts</li>
        </ul>
      </div>
    </motion.div>
  )
}
