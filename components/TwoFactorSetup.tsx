'use client'

import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { apiFetch } from '@/lib/api-client'
import { ShieldCheck, ShieldOff, Loader2, AlertCircle, Copy, Check, KeyRound } from 'lucide-react'

type SetupStep = 'idle' | 'scanning' | 'verifying' | 'done'

export default function TwoFactorSetup() {
  const { user } = useAuth()
  const [step, setStep] = useState<SetupStep>('idle')
  const [is2FAEnabled, setIs2FAEnabled] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [qrCode, setQrCode] = useState('')
  const [secret, setSecret] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [verifyCode, setVerifyCode] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [showDisable, setShowDisable] = useState(false)
  const [copied, setCopied] = useState(false)

  // Check 2FA status on first render
  useState(() => {
    if (!user) return
    fetch('/api/auth/2fa/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email }),
    })
      .then(r => r.json())
      .then(d => setIs2FAEnabled(d.enabled))
      .catch(() => setIs2FAEnabled(false))
  })

  const startSetup = async () => {
    setError('')
    setLoading(true)
    try {
      const res = await apiFetch('/api/auth/2fa/setup', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Setup failed')
      setQrCode(data.qr_code)
      setSecret(data.secret)
      setBackupCodes(data.backup_codes)
      setStep('scanning')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const verifySetup = async () => {
    setError('')
    if (!verifyCode.trim()) { setError('Enter the 6-digit code'); return }
    setLoading(true)
    try {
      const res = await apiFetch('/api/auth/2fa/verify-setup', {
        method: 'POST',
        body: JSON.stringify({ code: verifyCode.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Verification failed')
      setStep('done')
      setIs2FAEnabled(true)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const disable2FA = async () => {
    setError('')
    if (!disableCode.trim()) { setError('Enter your current authenticator code'); return }
    setLoading(true)
    try {
      const res = await apiFetch('/api/auth/2fa/disable', {
        method: 'POST',
        body: JSON.stringify({ code: disableCode.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to disable')
      setIs2FAEnabled(false)
      setShowDisable(false)
      setDisableCode('')
      setStep('idle')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const copyBackupCodes = () => {
    navigator.clipboard.writeText(backupCodes.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (is2FAEnabled === null) {
    return (
      <div className="flex items-center gap-2 text-gray-500 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" /> Checking 2FA status...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${is2FAEnabled ? 'bg-green-50' : 'bg-gray-100'}`}>
            <KeyRound className={`w-5 h-5 ${is2FAEnabled ? 'text-green-600' : 'text-gray-400'}`} />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Two-Factor Authentication</h3>
            <p className="text-sm text-gray-500">
              {is2FAEnabled ? 'Enabled — your account is protected' : 'Not enabled — add extra security to your account'}
            </p>
          </div>
        </div>
        <div className={`px-2.5 py-1 rounded-full text-xs font-medium ${is2FAEnabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
          {is2FAEnabled ? 'Active' : 'Off'}
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {/* ENABLED STATE — show disable option */}
      {is2FAEnabled && !showDisable && step === 'idle' && (
        <button
          onClick={() => { setShowDisable(true); setError('') }}
          className="text-sm text-red-600 hover:text-red-700 flex items-center gap-1.5"
        >
          <ShieldOff className="w-4 h-4" /> Disable 2FA
        </button>
      )}

      {showDisable && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg space-y-3">
          <p className="text-sm text-red-700 font-medium">Enter your current authenticator code to disable 2FA:</p>
          <input
            type="text"
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value.replace(/\s/g, ''))}
            className="w-full px-3 py-2 border border-red-300 rounded-lg text-center font-mono text-lg tracking-widest"
            placeholder="000000"
            maxLength={6}
          />
          <div className="flex gap-2">
            <button onClick={disable2FA} disabled={loading} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-60">
              {loading ? 'Disabling...' : 'Confirm Disable'}
            </button>
            <button onClick={() => { setShowDisable(false); setDisableCode(''); setError('') }} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* NOT ENABLED — setup flow */}
      {!is2FAEnabled && step === 'idle' && (
        <button
          onClick={startSetup}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-60"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
          Enable 2FA
        </button>
      )}

      {/* STEP 1: Scan QR */}
      {step === 'scanning' && (
        <div className="space-y-4 p-4 bg-gray-50 rounded-lg border">
          <div>
            <h4 className="font-medium text-gray-900 mb-1">Step 1: Scan QR Code</h4>
            <p className="text-sm text-gray-600">Open your authenticator app (Google Authenticator, Microsoft Authenticator, Authy, etc.) and scan this QR code:</p>
          </div>
          {qrCode && (
            <div className="flex justify-center">
              <img src={qrCode} alt="2FA QR Code" className="w-48 h-48 rounded-lg border bg-white p-2" />
            </div>
          )}
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">Or enter this key manually:</p>
            <code className="text-sm bg-white px-3 py-1.5 rounded border font-mono select-all">{secret}</code>
          </div>

          <div>
            <h4 className="font-medium text-gray-900 mb-1">Step 2: Save Backup Codes</h4>
            <p className="text-sm text-gray-600 mb-2">Save these codes in a safe place. You can use them if you lose access to your authenticator app.</p>
            <div className="bg-white rounded-lg border p-3 grid grid-cols-2 gap-1.5">
              {backupCodes.map((code, i) => (
                <code key={i} className="text-sm font-mono text-gray-800 text-center py-0.5">{code}</code>
              ))}
            </div>
            <button onClick={copyBackupCodes} className="mt-2 flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-700">
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied!' : 'Copy all codes'}
            </button>
          </div>

          <div>
            <h4 className="font-medium text-gray-900 mb-1">Step 3: Verify</h4>
            <p className="text-sm text-gray-600 mb-2">Enter the 6-digit code from your authenticator app to confirm setup:</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value.replace(/\s/g, ''))}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-center font-mono text-lg tracking-widest"
                placeholder="000000"
                maxLength={6}
                autoComplete="one-time-code"
              />
              <button
                onClick={verifySetup}
                disabled={loading || verifyCode.length < 6}
                className="px-5 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-60"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Verify'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUCCESS */}
      {step === 'done' && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-2 text-green-700 font-medium mb-1">
            <ShieldCheck className="w-5 h-5" /> 2FA Enabled Successfully
          </div>
          <p className="text-sm text-green-600">Your account is now protected with two-factor authentication. You&apos;ll need your authenticator app code every time you sign in.</p>
        </div>
      )}
    </div>
  )
}
