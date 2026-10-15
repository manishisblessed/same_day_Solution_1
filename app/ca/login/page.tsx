'use client'

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import {
  Lock, Mail, AlertCircle, Loader2, MapPin, ShieldCheck,
  Clock, Eye, EyeOff, Monitor, KeyRound, Calculator,
} from 'lucide-react'
import { getGeoLocationForLogin } from '@/hooks/useGeolocation'
import TurnstileWidget, { TurnstileHandle, isCaptchaEnabled } from '@/components/TurnstileWidget'
import { TwoFactorRequiredError, waitForServerSession } from '@/lib/auth'

type BannerType = 'expired' | 'replaced' | null

export default function CALoginPage() {
  const { user, login, login2FA } = useAuth()
  const router = useRouter()
  const [formData, setFormData] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [locationStatus, setLocationStatus] = useState<'pending' | 'capturing' | 'done' | 'failed'>('pending')
  const [showPassword, setShowPassword] = useState(false)
  const [banner, setBanner] = useState<BannerType>(null)
  const [captchaToken, setCaptchaToken] = useState('')
  const [show2FA, setShow2FA] = useState(false)
  const [totpCode, setTotpCode] = useState('')
  const [useBackupCode, setUseBackupCode] = useState(false)
  const turnstileRef = useRef<TurnstileHandle>(null)
  const geoTriggered = useRef(false)
  const redirectingRef = useRef(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      if (params.get('reason') === 'replaced') setBanner('replaced')
      else if (params.get('session') === 'expired') setBanner('expired')
      if (params.get('session') || params.get('reason')) {
        const url = new URL(window.location.href)
        url.searchParams.delete('session')
        url.searchParams.delete('reason')
        window.history.replaceState({}, '', url.pathname + (url.search || ''))
      }
    }
  }, [])

  const captureLocation = () => {
    setLocationStatus('capturing')
    getGeoLocationForLogin(15000).then((geo) => {
      setLocationStatus(geo ? 'done' : 'failed')
    })
  }

  useEffect(() => {
    if (geoTriggered.current) return
    geoTriggered.current = true
    captureLocation()
  }, [])

  useEffect(() => {
    if (banner) {
      const timer = setTimeout(() => setBanner(null), 8000)
      return () => clearTimeout(timer)
    }
  }, [banner])

  useEffect(() => {
    if (user?.role === 'ca_executive' && !redirectingRef.current) {
      redirectingRef.current = true
      ;(async () => {
        await waitForServerSession()
        const params = new URLSearchParams(window.location.search)
        const redirect = params.get('redirect')
        router.push(redirect?.startsWith('/ca') ? redirect : '/ca/billing')
      })()
    }
  }, [user, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (locationStatus !== 'done') {
      if (locationStatus === 'failed') {
        setError('Location access is required to sign in. Please allow location access, then try again.')
        captureLocation()
      } else {
        setError('Please wait — capturing your location…')
      }
      return
    }
    if (isCaptchaEnabled() && !captchaToken) {
      setError('Please complete the CAPTCHA verification before signing in.')
      return
    }

    setLoading(true)
    try {
      await login(formData.email, formData.password, 'ca_executive', captchaToken)
    } catch (err: any) {
      if (err instanceof TwoFactorRequiredError) {
        setShow2FA(true)
        setLoading(false)
        return
      }
      setError(err.message || 'Invalid credentials')
      setCaptchaToken('')
      turnstileRef.current?.reset()
    } finally {
      setLoading(false)
    }
  }

  const handle2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!totpCode.trim()) { setError('Please enter the verification code.'); return }
    setLoading(true)
    try {
      await login2FA(formData.email, formData.password, 'ca_executive', totpCode.trim(), useBackupCode)
    } catch (err: any) {
      setError(err.message || 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-800 p-8">
          {show2FA ? (
            <>
              <div className="text-center mb-6">
                <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-violet-50 flex items-center justify-center">
                  <KeyRound className="w-7 h-7 text-violet-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900">Two-Factor Auth</h2>
                <p className="text-gray-600 text-sm mt-1">Enter the 6-digit code from your authenticator app</p>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
                  <AlertCircle className="w-5 h-5" /><span className="text-sm">{error}</span>
                </div>
              )}

              <form onSubmit={handle2FASubmit} className="space-y-5">
                <div>
                  <label htmlFor="totp-code" className="block text-sm font-medium text-gray-700 mb-2">
                    {useBackupCode ? 'Backup Code' : 'Verification Code'}
                  </label>
                  <input
                    type="text"
                    id="totp-code"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\s/g, ''))}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none text-center text-2xl tracking-[0.3em] font-mono"
                    placeholder={useBackupCode ? 'XXXX-XXXX' : '000000'}
                    maxLength={useBackupCode ? 9 : 6}
                    autoFocus
                    autoComplete="one-time-code"
                  />
                </div>
                <button type="submit" disabled={loading} className="w-full py-3 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white font-semibold rounded-lg transition-colors">
                  {loading ? 'Verifying...' : 'Verify & Sign In'}
                </button>
                <div className="flex items-center justify-between text-sm">
                  <button type="button" onClick={() => { setUseBackupCode(!useBackupCode); setTotpCode(''); setError('') }} className="text-violet-600 hover:text-violet-700">
                    {useBackupCode ? 'Use authenticator code' : 'Use backup code'}
                  </button>
                  <button type="button" onClick={() => { setShow2FA(false); setTotpCode(''); setError('') }} className="text-gray-500 hover:text-gray-700">
                    Back to login
                  </button>
                </div>
              </form>
            </>
          ) : (
            <>
              <div className="text-center mb-8">
                <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-violet-100 flex items-center justify-center">
                  <Calculator className="w-7 h-7 text-violet-600" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900">CA Portal Login</h1>
                <p className="text-gray-600 text-sm mt-1">Billing, MDR config &amp; GST invoices</p>
              </div>

              {banner === 'replaced' && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
                  <Monitor className="w-5 h-5 flex-shrink-0" />
                  <span className="text-sm">Your account was signed in from another device.</span>
                </div>
              )}
              {banner === 'expired' && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-amber-700">
                  <Clock className="w-5 h-5 flex-shrink-0" />
                  <span className="text-sm">Your session ended due to inactivity. Please sign in again.</span>
                </div>
              )}
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
                  <AlertCircle className="w-5 h-5" />
                  <span className="text-sm">{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                      type="email"
                      id="email"
                      required
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none"
                      placeholder="you@company.com"
                      autoComplete="email"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      id="password"
                      required
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="w-full pl-10 pr-12 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none"
                      placeholder="Password"
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                {/* Location status */}
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm border ${
                  locationStatus === 'done' ? 'border-green-200 bg-green-50' :
                  locationStatus === 'failed' ? 'border-red-200 bg-red-50' :
                  'border-gray-200 bg-gray-50'
                }`}>
                  {locationStatus === 'capturing' && (
                    <><Loader2 className="w-4 h-4 animate-spin text-amber-500" /><span className="text-amber-700">Capturing your location...</span></>
                  )}
                  {locationStatus === 'done' && (
                    <><ShieldCheck className="w-4 h-4 text-green-600" /><span className="text-green-700">Location captured</span></>
                  )}
                  {locationStatus === 'failed' && (
                    <>
                      <MapPin className="w-4 h-4 text-red-500" />
                      <span className="text-red-600">Location required — please allow access.</span>
                      <button type="button" onClick={captureLocation} className="ml-auto text-red-700 underline font-medium text-xs">Retry</button>
                    </>
                  )}
                  {locationStatus === 'pending' && (
                    <><MapPin className="w-4 h-4 text-gray-400" /><span className="text-gray-500">Preparing location check...</span></>
                  )}
                </div>

                {isCaptchaEnabled() && (
                  <div className="flex flex-col items-center">
                    <TurnstileWidget
                      ref={turnstileRef}
                      onVerify={(t) => { setCaptchaToken(t) }}
                      onExpire={() => setCaptchaToken('')}
                      onError={() => {}}
                    />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || locationStatus !== 'done' || (isCaptchaEnabled() && !captchaToken)}
                  className="w-full py-3 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
                >
                  {loading
                    ? 'Signing in...'
                    : locationStatus !== 'done'
                      ? 'Waiting for location...'
                      : isCaptchaEnabled() && !captchaToken
                        ? 'Complete CAPTCHA to continue'
                        : 'Sign In'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
