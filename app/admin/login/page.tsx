'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import { Lock, Mail, AlertCircle, Loader2, MapPin, ShieldCheck, Clock } from 'lucide-react'
import AnimatedSection from '@/components/AnimatedSection'
import { getGeoLocationForLogin, clearGeoCache } from '@/hooks/useGeolocation'

export default function AdminLogin() {
  const { user, login } = useAuth()
  const router = useRouter()
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [locationVerified, setLocationVerified] = useState(false)
  const [locationLoading, setLocationLoading] = useState(false)
  const [showExpiredBanner, setShowExpiredBanner] = useState(false)

  useEffect(() => {
    clearGeoCache()
    setLocationVerified(false)
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      if (params.get('session') === 'expired') setShowExpiredBanner(true)
    }
  }, [])

  useEffect(() => {
    if (showExpiredBanner) {
      const timer = setTimeout(() => setShowExpiredBanner(false), 8000)
      return () => clearTimeout(timer)
    }
  }, [showExpiredBanner])

  useEffect(() => {
    if (user?.role === 'admin') {
      router.push('/admin')
    }
  }, [user, router])

  const handleVerifyLocation = async () => {
    setError('')
    setLocationLoading(true)
    const geo = await getGeoLocationForLogin(15000)
    setLocationLoading(false)
    if (geo) {
      setLocationVerified(true)
    } else {
      setLocationVerified(false)
      setError('Location access was denied or unavailable. Please allow location to sign in.')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!locationVerified) {
      setError('Please verify your location before signing in.')
      return
    }

    setLoading(true)

    try {
      await login(formData.email, formData.password, 'admin')
      router.push('/admin')
    } catch (err: any) {
      setError(err.message || 'Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 via-secondary-50 to-accent-50 flex items-center justify-center p-4">
      <AnimatedSection>
        <div className="max-w-md w-full">
          <div className="card">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Admin Login</h1>
              <p className="text-gray-600">Access the admin dashboard</p>
            </div>

            {showExpiredBanner && (
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
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="email"
                    id="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="admin@example.com"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="password"
                    id="password"
                    required
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder="Enter your password"
                  />
                </div>
              </div>

              {!locationVerified ? (
                <button
                  type="button"
                  onClick={handleVerifyLocation}
                  disabled={locationLoading}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold text-white bg-amber-500 hover:bg-amber-600 transition-colors disabled:opacity-60"
                >
                  {locationLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Verifying location...
                    </>
                  ) : (
                    <>
                      <MapPin className="w-4 h-4" />
                      Verify Location to Continue
                    </>
                  )}
                </button>
              ) : (
                <>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
                    <ShieldCheck className="w-4 h-4 flex-shrink-0" />
                    <span>Location verified</span>
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full btn-primary"
                  >
                    {loading ? 'Signing in...' : 'Sign In'}
                  </button>
                </>
              )}
            </form>
          </div>
        </div>
      </AnimatedSection>
    </div>
  )
}
