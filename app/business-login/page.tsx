'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import AnimatedSection from '@/components/AnimatedSection'
import AnimatedCard from '@/components/AnimatedCard'
import Link from 'next/link'
import { AlertCircle, Loader2, MapPin, ShieldCheck, Clock, Eye, EyeOff, Monitor, KeyRound } from 'lucide-react'
import { getGeoLocationForLogin } from '@/hooks/useGeolocation'
import TurnstileWidget, { TurnstileHandle, isCaptchaEnabled } from '@/components/TurnstileWidget'
import { TwoFactorRequiredError } from '@/lib/auth'

type BannerType = 'expired' | 'replaced' | null

export default function BusinessLogin() {
  const { user, login, login2FA, loading: authLoading } = useAuth()
  const router = useRouter()
  const [userType, setUserType] = useState<'retailer' | 'distributor' | 'master-distributor' | 'partner' | null>(null)
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    rememberMe: false,
  })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [locationStatus, setLocationStatus] = useState<'pending' | 'capturing' | 'done' | 'failed'>('pending')
  const [banner, setBanner] = useState<BannerType>(null)
  const [captchaToken, setCaptchaToken] = useState('')
  const [captchaError, setCaptchaError] = useState(false)
  const [show2FA, setShow2FA] = useState(false)
  const [totpCode, setTotpCode] = useState('')
  const [useBackupCode, setUseBackupCode] = useState(false)
  const turnstileRef = useRef<TurnstileHandle>(null)
  const geoTriggered = useRef(false)

  useEffect(() => {
    setMounted(true)
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      if (params.get('reason') === 'replaced') {
        setBanner('replaced')
      } else if (params.get('session') === 'expired') {
        setBanner('expired')
      }
      // Clean the URL params after reading
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

  // Auto-capture geolocation on mount (location is required to sign in)
  useEffect(() => {
    if (!mounted || geoTriggered.current) return
    geoTriggered.current = true
    captureLocation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted])

  useEffect(() => {
    if (banner) {
      const timer = setTimeout(() => setBanner(null), 8000)
      return () => clearTimeout(timer)
    }
  }, [banner])

  // Timeout to prevent infinite loading (max 2 seconds wait)
  const [forceShow, setForceShow] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => {
      setForceShow(true)
    }, 1500) // Show page after 1.5 seconds even if still loading
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    // Only redirect if auth is done loading and user exists
    if (!authLoading && user) {
      const params = new URLSearchParams(window.location.search)
      const redirectTo = params.get('redirect')
      let dest = ''
      if (redirectTo?.startsWith('/dashboard/')) {
        dest = redirectTo
      } else if (user.role === 'retailer') dest = '/dashboard/retailer'
      else if (user.role === 'distributor') dest = '/dashboard/distributor'
      else if (user.role === 'master_distributor') dest = '/dashboard/master-distributor'
      else if (user.role === 'partner' || user.role === 'sub_partner') dest = '/dashboard/partner'
      if (dest) router.push(dest)
    }
  }, [user, authLoading])

  // Show loading while auth is initializing (max 1.5 seconds)
  if (!mounted || (authLoading && !forceShow)) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target
    setFormData({
      ...formData,
      [name]: type === 'checkbox' ? checked : value,
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Location and CAPTCHA are REQUIRED — block sign-in until both succeed.
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
      let role: string = userType === 'master-distributor' ? 'master_distributor' : userType!
      await login(formData.email, formData.password, role as any, captchaToken)
      
      await new Promise(resolve => setTimeout(resolve, 500))

      const params = new URLSearchParams(window.location.search)
      const redirectTo = params.get('redirect')
      let dest = ''
      if (redirectTo?.startsWith('/dashboard/')) {
        dest = redirectTo
      } else if (userType === 'retailer') {
        dest = '/dashboard/retailer'
      } else if (userType === 'distributor') {
        dest = '/dashboard/distributor'
      } else if (userType === 'master-distributor') {
        dest = '/dashboard/master-distributor'
      } else if (userType === 'partner') {
        dest = '/dashboard/partner'
      }
      if (dest) {
        router.push(dest)
        setTimeout(() => setLoading(false), 3000)
      } else {
        setLoading(false)
      }
    } catch (err: any) {
      if (err instanceof TwoFactorRequiredError) {
        setShow2FA(true)
        setLoading(false)
        return
      }
      setError(err.message || 'Invalid credentials')
      setCaptchaToken('')
      turnstileRef.current?.reset()
      setLoading(false)
    }
  }

  const handle2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!totpCode.trim()) {
      setError('Please enter the verification code.')
      return
    }
    setLoading(true)
    try {
      let role: string = userType === 'master-distributor' ? 'master_distributor' : userType!
      await login2FA(formData.email, formData.password, role, totpCode.trim(), useBackupCode)

      await new Promise(resolve => setTimeout(resolve, 500))
      const params = new URLSearchParams(window.location.search)
      const redirectTo = params.get('redirect')
      let dest = ''
      if (redirectTo?.startsWith('/dashboard/')) dest = redirectTo
      else if (userType === 'retailer') dest = '/dashboard/retailer'
      else if (userType === 'distributor') dest = '/dashboard/distributor'
      else if (userType === 'master-distributor') dest = '/dashboard/master-distributor'
      else if (userType === 'partner') dest = '/dashboard/partner'
      if (dest) {
        router.push(dest)
        setTimeout(() => setLoading(false), 3000)
      } else {
        setLoading(false)
      }
    } catch (err: any) {
      setError(err.message || 'Verification failed')
      setLoading(false)
    }
  }

  const userTypes = [
    {
      id: 'retailer',
      title: 'Retailer',
      icon: '🏪',
      description: 'Login to access your retailer dashboard and manage transactions',
    },
    {
      id: 'distributor',
      title: 'Distributor',
      icon: '📦',
      description: 'Access distributor portal to manage your retailer network',
    },
    {
      id: 'master-distributor',
      title: 'Master Distributor',
      icon: '🌟',
      description: 'Login to master distributor dashboard for advanced analytics',
    },
    {
      id: 'partner',
      title: 'Partner',
      icon: '🤝',
      description: 'VIP Partner Portal - Access premium features and advanced tools',
    },
  ]

  return (
    <div className="bg-white min-h-screen">
      <AnimatedSection>
        <section className="section-padding bg-gradient-to-br from-primary-50/30 via-secondary-50/20 to-accent-50/20">
          <div className="max-w-7xl mx-auto">
            <div className="text-center max-w-4xl mx-auto">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 mb-6 leading-tight">
                Business Login
                <span className="block text-3xl md:text-4xl mt-2 bg-gradient-to-r from-primary-600 to-secondary-600 bg-clip-text text-transparent">
                  Partner Portal Access
                </span>
              </h1>
              <p className="text-xl text-gray-700 mb-8 leading-relaxed">
                Access your partner dashboard to manage transactions, view reports, and grow your business
              </p>
            </div>
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection delay={0.2}>
        <section className="section-padding">
          <div className="max-w-5xl mx-auto">
            {!userType ? (
              <div>
                <div className="text-center mb-12">
                  <h2 className="text-3xl font-bold text-gray-900 mb-4">Select Your Account Type</h2>
                  <p className="text-gray-600">Choose your partner type to continue</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {userTypes.map((type, index) => (
                    <AnimatedCard key={type.id} delay={index * 0.1}>
                      <button
                        onClick={() => setUserType(type.id as any)}
                        className="card w-full text-center h-full hover:shadow-xl transition-all duration-300 group"
                      >
                        <div className="text-6xl mb-4">{type.icon}</div>
                        <h3 className="text-2xl font-bold text-gray-900 mb-3">{type.title}</h3>
                        <p className="text-gray-600 mb-4">{type.description}</p>
                        <div className="text-primary-600 font-semibold group-hover:text-primary-700">
                          Continue →
                        </div>
                      </button>
                    </AnimatedCard>
                  ))}
                </div>
              </div>
            ) : (
              <AnimatedCard>
                <div className="max-w-md mx-auto">
                  <div className="card">
                    {show2FA ? (
                      <>
                        <div className="text-center mb-6">
                          <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-primary-50 flex items-center justify-center">
                            <KeyRound className="w-7 h-7 text-primary-600" />
                          </div>
                          <h2 className="text-2xl font-bold text-gray-900">Two-Factor Authentication</h2>
                          <p className="text-gray-600 text-sm mt-1">
                            Enter the 6-digit code from your authenticator app
                          </p>
                        </div>

                        {error && (
                          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
                            <AlertCircle className="w-5 h-5" />
                            <span className="text-sm">{error}</span>
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
                              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all text-center text-2xl tracking-[0.3em] font-mono"
                              placeholder={useBackupCode ? 'XXXX-XXXX' : '000000'}
                              maxLength={useBackupCode ? 9 : 6}
                              autoFocus
                              autoComplete="one-time-code"
                            />
                          </div>

                          <button
                            type="submit"
                            disabled={loading}
                            className="w-full btn-primary disabled:opacity-60"
                          >
                            {loading ? 'Verifying...' : 'Verify & Sign In'}
                          </button>

                          <div className="flex items-center justify-between text-sm">
                            <button
                              type="button"
                              onClick={() => { setUseBackupCode(!useBackupCode); setTotpCode(''); setError('') }}
                              className="text-primary-600 hover:text-primary-700"
                            >
                              {useBackupCode ? 'Use authenticator code' : 'Use backup code'}
                            </button>
                            <button
                              type="button"
                              onClick={() => { setShow2FA(false); setTotpCode(''); setError('') }}
                              className="text-gray-500 hover:text-gray-700"
                            >
                              Back to login
                            </button>
                          </div>
                        </form>
                      </>
                    ) : (
                    <>
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-2xl font-bold text-gray-900">
                        {userTypes.find(t => t.id === userType)?.title} Login
                      </h2>
                      <button
                        onClick={() => setUserType(null)}
                        className="text-gray-500 hover:text-gray-700"
                        aria-label="Change account type"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    {banner === 'replaced' && (
                      <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
                        <Monitor className="w-5 h-5 flex-shrink-0" />
                        <span className="text-sm">Your account was signed in from another device. This session was ended for security.</span>
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

                    <form onSubmit={handleSubmit} className="space-y-6">
                      <div>
                        <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                          Email Address
                        </label>
                        <input
                          type="email"
                          id="email"
                          name="email"
                          required
                          value={formData.email}
                          onChange={handleChange}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                          placeholder="Enter your email address"
                        />
                      </div>

                      <div>
                        <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                          Password
                        </label>
                        <div className="relative">
                          <input
                            type={showPassword ? 'text' : 'password'}
                            id="password"
                            name="password"
                            required
                            value={formData.password}
                            onChange={handleChange}
                            className="w-full px-4 py-3 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                            placeholder="Enter your password"
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

                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <input
                            id="rememberMe"
                            name="rememberMe"
                            type="checkbox"
                            checked={formData.rememberMe}
                            onChange={handleChange}
                            className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                          />
                          <label htmlFor="rememberMe" className="ml-2 block text-sm text-gray-700">
                            Remember me
                          </label>
                        </div>
                        <Link href="/contact" className="text-sm text-primary-600 hover:text-primary-700">
                          Forgot password?
                        </Link>
                      </div>

                      {/* Location status indicator */}
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm border">
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
                            <button type="button" onClick={captureLocation} className="ml-auto text-red-700 underline font-medium">
                              Retry
                            </button>
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
                            onVerify={(t) => { setCaptchaToken(t); setCaptchaError(false) }}
                            onExpire={() => setCaptchaToken('')}
                            onError={() => setCaptchaError(true)}
                          />
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={loading || locationStatus !== 'done' || (isCaptchaEnabled() && !captchaToken)}
                        className="w-full btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
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

                    <div className="mt-6 pt-6 border-t border-gray-200">
                      <p className="text-center text-sm text-gray-600">
                        Not a partner yet?{' '}
                        <Link href="/partner" className="text-primary-600 hover:text-primary-700 font-semibold">
                          Become a Partner
                        </Link>
                      </p>
                    </div>
                    </>
                    )}
                  </div>
                </div>
              </AnimatedCard>
            )}
          </div>
        </section>
      </AnimatedSection>

      <AnimatedSection delay={0.3}>
        <section className="section-padding bg-gray-50">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Need Help?</h2>
              <p className="text-gray-600 mb-6">
                If you're having trouble accessing your account, our support team is here to help
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link href="/contact" className="btn-secondary">
                  Contact Support
                </Link>
                <Link href="/faq" className="btn-secondary">
                  View FAQs
                </Link>
              </div>
            </div>
          </div>
        </section>
      </AnimatedSection>
    </div>
  )
}

