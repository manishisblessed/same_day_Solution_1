'use client'

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { AuthUser } from '@/types/database.types'
import { getCurrentUser, signIn, signOut as authSignOut, getStoredSessionToken, clearStoredSessionToken, complete2FALogin, TwoFactorRequiredError } from '@/lib/auth'
import { apiFetch, getApiUrl, getAccessToken } from '@/lib/api-client'
import { getGeoLocation, clearGeoCache } from '@/hooks/useGeolocation'
import { supabase } from '@/lib/supabase/client'

export type LogoutReason = 'manual' | 'inactivity' | 'replaced' | 'expired' | 'ended'
// 'logout' = signed out in another tab of the same browser — handled silently
// (no scary "session expired" overlay/banner, just a clean redirect to login).
export type KickReason = 'replaced' | 'expired' | 'logout' | null

interface AuthContextType {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string, role: string, captchaToken?: string) => Promise<void>
  login2FA: (email: string, password: string, role: string, totpCode: string, isBackup?: boolean) => Promise<void>
  logout: (reason?: LogoutReason) => Promise<void>
  refreshUser: () => Promise<void>
  impersonate: (userId: string, userRole: 'retailer' | 'distributor' | 'master_distributor') => Promise<void>
  endImpersonation: () => Promise<void>
  sessionKicked: boolean
  kickReason: KickReason
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionKicked, setSessionKicked] = useState(false)
  const [kickReason, setKickReason] = useState<KickReason>(null)
  const geoRequestedRef = useRef(false)
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const kickingRef = useRef(false)
  const manualLogoutRef = useRef(false)
  const userRef = useRef<AuthUser | null>(null)

  useEffect(() => { userRef.current = user }, [user])

  useEffect(() => {
    checkUser()
  }, [])

  // Centralized "session is dead" handler. Shows the kicked overlay and
  // clears local auth WITHOUT re-triggering server-side sign-out (avoids loops).
  const triggerKick = useCallback((reason: Exclude<KickReason, null>) => {
    if (kickingRef.current || manualLogoutRef.current) return
    kickingRef.current = true

    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }

    setKickReason(reason)
    setSessionKicked(true)
    clearStoredSessionToken()
    clearGeoCache()
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_user')
      localStorage.removeItem('auth_user_timestamp')
    }
    setUser(null)
  }, [])

  const triggerKickRef = useRef(triggerKick)
  useEffect(() => { triggerKickRef.current = triggerKick }, [triggerKick])

  // Detect session death from any source and react immediately instead of
  // leaving a stale dashboard that later fails mid-action with a 401.
  useEffect(() => {
    if (typeof window === 'undefined') return

    // 1. Supabase auth state — SIGNED_OUT here means supabase.auth.signOut()
    // ran (this browser, another tab), i.e. a deliberate logout → silent kick.
    const { data: authSub } = supabase.auth.onAuthStateChange((event: string) => {
      if (event === 'SIGNED_OUT' && userRef.current && !manualLogoutRef.current) {
        triggerKickRef.current('logout')
      }
    })

    // 2. Hard 401 from an API call (token gone/revoked) dispatches this event
    const onSessionExpired = () => {
      if (userRef.current) triggerKickRef.current('expired')
    }
    window.addEventListener('session-expired', onSessionExpired)

    // 3. Cross-tab: another tab cleared the shared auth cache (logout elsewhere)
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'auth_user' && e.newValue === null && userRef.current && !manualLogoutRef.current) {
        triggerKickRef.current('logout')
      }
    }
    window.addEventListener('storage', onStorage)

    return () => {
      authSub?.subscription?.unsubscribe()
      window.removeEventListener('session-expired', onSessionExpired)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  // Request geolocation once user is authenticated (all roles).
  useEffect(() => {
    if (!user || geoRequestedRef.current) return
    geoRequestedRef.current = true
    getGeoLocation(10_000).catch(() => {})
  }, [user])

  // Session heartbeat — validates session_token every 30s
  const startHeartbeat = useCallback(() => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current)

    const validate = async () => {
      const token = getStoredSessionToken()
      if (!token || kickingRef.current) return

      try {
        // Runs on the EC2 backend (getApiUrl), not Amplify SSR — the route uses
        // the Supabase service-role key, which Amplify's runtime doesn't expose.
        const accessToken = await getAccessToken()
        const res = await fetch(getApiUrl('/api/auth/validate-session'), {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({ session_token: token }),
        })
        const data = await res.json()

        if (!data.valid) {
          // Pass the real reason through: 'logout' (signed out elsewhere) ends
          // this tab silently; only genuine expiry/replacement shows a message.
          const reason: Exclude<KickReason, null> =
            data.reason === 'replaced' ? 'replaced'
            : data.reason === 'logout' ? 'logout'
            : 'expired'
          triggerKickRef.current(reason)
          try { await authSignOut() } catch {}
        }
      } catch {
        // Network error — don't kick user
      }
    }

    validate()
    heartbeatRef.current = setInterval(validate, 15_000)
  }, [])

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current)
      heartbeatRef.current = null
    }
  }, [])

  // Start/stop heartbeat based on user state
  useEffect(() => {
    if (user && !sessionKicked) {
      startHeartbeat()
    } else {
      stopHeartbeat()
    }
    return stopHeartbeat
  }, [user, sessionKicked, startHeartbeat, stopHeartbeat])

  const checkUser = async () => {
    try {
      if (typeof window !== 'undefined') {
        // Clear corrupted storage entries
        try {
          for (const key of Object.keys(localStorage)) {
            const value = localStorage.getItem(key)
            if (value && value.startsWith('base64-')) localStorage.removeItem(key)
          }
          for (const key of Object.keys(sessionStorage)) {
            const value = sessionStorage.getItem(key)
            if (value && value.startsWith('base64-')) sessionStorage.removeItem(key)
          }
        } catch { /* ignore */ }
      }

      // Use a short timeout to avoid hanging when no session exists
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))
      const currentUser = await Promise.race([getCurrentUser(), timeoutPromise])

      if (currentUser) {
        setUser(currentUser)
        if (typeof window !== 'undefined') {
          localStorage.setItem('auth_user', JSON.stringify(currentUser))
          localStorage.setItem('auth_user_timestamp', Date.now().toString())
        }
      } else {
        // getCurrentUser returned null — check if we have a RECENT cache
        // (covers the rare case where the Supabase token refresh hangs/times out
        //  right after login, but the user just authenticated moments ago)
        if (typeof window !== 'undefined') {
          try {
            const cachedUser = localStorage.getItem('auth_user')
            const cacheTs = localStorage.getItem('auth_user_timestamp')
            const isVeryRecent = cacheTs && (Date.now() - parseInt(cacheTs)) < 60_000
            if (cachedUser && isVeryRecent) {
              setUser(JSON.parse(cachedUser) as AuthUser)
              return
            }
          } catch { /* ignore */ }
          // Session is truly gone — clear stale cache
          localStorage.removeItem('auth_user')
          localStorage.removeItem('auth_user_timestamp')
        }
        setUser(null)
      }
    } catch (error: any) {
      const msg = error?.message || ''
      if (msg.includes("Cannot create property 'user' on string") || msg.includes('base64-')) {
        if (typeof window !== 'undefined') {
          try {
            [...Object.keys(localStorage), ...Object.keys(sessionStorage)].forEach(key => {
              if (key.includes('supabase') || key.includes('sb-') || key.startsWith('auth-token')) {
                localStorage.removeItem(key)
                sessionStorage.removeItem(key)
              }
            })
          } catch { /* ignore */ }
        }
      } else {
        console.error('Error checking user:', error)
      }
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  const login = async (email: string, password: string, role: string, captchaToken?: string) => {
    setLoading(true)
    manualLogoutRef.current = false
    kickingRef.current = false
    setSessionKicked(false)
    setKickReason(null)
    try {
      const result = await signIn(email, password, role as any, captchaToken)
      setUser(result.user)
      // Store user in localStorage to persist across page navigations
      // This is critical because the session may not be immediately available after login
      if (typeof window !== 'undefined' && result.user) {
        localStorage.setItem('auth_user', JSON.stringify(result.user))
        localStorage.setItem('auth_user_timestamp', Date.now().toString())

        // Log login activity with best-effort geolocation.
        // Try a quick geo lookup (cached value); if unavailable, log
        // without geo immediately and update the record once geo arrives.
        const logLogin = async () => {
          try {
            const quickGeo = await getGeoLocation(3000)
            const geoBody = quickGeo ? {
              latitude: quickGeo.latitude,
              longitude: quickGeo.longitude,
              accuracy: quickGeo.accuracy,
              source: quickGeo.source,
            } : null

            const res = await apiFetch('/api/activity/log', {
              method: 'POST',
              body: JSON.stringify({
                activity_type: 'login',
                activity_category: 'auth',
                activity_description: `${result.user.role} logged in: ${result.user.email}`,
                geo: geoBody,
              }),
            })

            const data = await res.json().catch(() => ({}))

            // If logged without geo, retry once geo becomes available
            if (!quickGeo && data.log_id) {
              getGeoLocation(10_000).then((laterGeo) => {
                if (laterGeo) {
                  apiFetch('/api/activity/log/update-geo', {
                    method: 'POST',
                    body: JSON.stringify({
                      log_id: data.log_id,
                      geo: {
                        latitude: laterGeo.latitude,
                        longitude: laterGeo.longitude,
                        accuracy: laterGeo.accuracy,
                        source: laterGeo.source,
                      },
                    }),
                  }).catch(() => {})
                }
              }).catch(() => {})
            }
          } catch (err: any) {
            console.warn('[ActivityLog] Login log error:', err?.message || err)
          }
        }
        logLogin()
      }
    } catch (error: any) {
      if (error instanceof TwoFactorRequiredError) {
        setLoading(false)
        throw error
      }
      throw error
    } finally {
      setLoading(false)
    }
  }

  const login2FA = async (email: string, password: string, role: string, totpCode: string, isBackup?: boolean) => {
    setLoading(true)
    manualLogoutRef.current = false
    kickingRef.current = false
    setSessionKicked(false)
    setKickReason(null)
    try {
      const result = await complete2FALogin(email, password, role as any, totpCode, isBackup)
      setUser(result.user)
      if (typeof window !== 'undefined' && result.user) {
        localStorage.setItem('auth_user', JSON.stringify(result.user))
        localStorage.setItem('auth_user_timestamp', Date.now().toString())

        const logLogin = async () => {
          try {
            const quickGeo = await getGeoLocation(3000)
            const geoBody = quickGeo ? {
              latitude: quickGeo.latitude,
              longitude: quickGeo.longitude,
              accuracy: quickGeo.accuracy,
              source: quickGeo.source,
            } : null
            await apiFetch('/api/activity/log', {
              method: 'POST',
              body: JSON.stringify({
                activity_type: 'login',
                activity_category: 'auth',
                activity_description: `${result.user.role} logged in (2FA): ${result.user.email}`,
                geo: geoBody,
              }),
            })
          } catch {}
        }
        logLogin()
      }
    } catch (error: any) {
      throw error
    } finally {
      setLoading(false)
    }
  }

  const logout = async (reason: LogoutReason = 'manual') => {
    manualLogoutRef.current = true
    stopHeartbeat()
    setLoading(true)
    try {
      // Log logout activity before clearing session (non-blocking)
      apiFetch('/api/activity/log', {
        method: 'POST',
        body: JSON.stringify({
          activity_type: 'logout',
          activity_category: 'auth',
          activity_description: `${user?.role || 'user'} logged out (${reason}): ${user?.email || 'unknown'}`,
        }),
      }).catch(() => {})

      // Sign out from Supabase (also ends session token via lib/auth signOut)
      await authSignOut()
      
      // Clear geo cache so next login requires fresh location permission
      clearGeoCache()

      // Clear all auth-related data
      if (typeof window !== 'undefined') {
        localStorage.removeItem('auth_user')
        localStorage.removeItem('auth_user_timestamp')
        
        const localStorageKeys: string[] = []
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key && (key.includes('supabase') || key.includes('sb-'))) {
            localStorageKeys.push(key)
          }
        }
        localStorageKeys.forEach(key => localStorage.removeItem(key))
        
        const sessionStorageKeys: string[] = []
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i)
          if (key && (key.includes('supabase') || key.includes('sb-'))) {
            sessionStorageKeys.push(key)
          }
        }
        sessionStorageKeys.forEach(key => sessionStorage.removeItem(key))
        
        localStorage.removeItem('impersonation_token')
        localStorage.removeItem('impersonation_session_id')
        sessionStorage.removeItem('impersonated_user')
      }
      
      setUser(null)
    } catch (error) {
      console.error('Error signing out:', error)
      setUser(null)
      if (typeof window !== 'undefined') {
        localStorage.removeItem('auth_user')
        localStorage.removeItem('auth_user_timestamp')
      }
    } finally {
      setLoading(false)
    }
  }

  const refreshUser = async () => {
    const currentUser = await getCurrentUser()
    setUser(currentUser)
  }

  const impersonate = async (userId: string, userRole: 'retailer' | 'distributor' | 'master_distributor') => {
    setLoading(true)
    try {
      const response = await apiFetch('/api/admin/impersonate', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, user_role: userRole })
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Failed to impersonate user')
      }

      if (data.success && data.user) {
        // Store impersonation token in localStorage
        if (data.impersonation_token) {
          localStorage.setItem('impersonation_token', data.impersonation_token)
          localStorage.setItem('impersonation_session_id', data.user.impersonation_session_id || '')
        }
        // Store user data in sessionStorage for the new tab
        sessionStorage.setItem('impersonated_user', JSON.stringify(data.user))
        // Open dashboard in a new tab
        if (data.redirect_url) {
          window.open(data.redirect_url, '_blank')
        }
      }
    } catch (error: any) {
      throw error
    } finally {
      setLoading(false)
    }
  }

  const endImpersonation = async () => {
    setLoading(true)
    try {
      const sessionId = localStorage.getItem('impersonation_session_id')
      if (sessionId) {
        await apiFetch(`/api/admin/impersonate?session_id=${sessionId}`, {
          method: 'DELETE'
        })
        localStorage.removeItem('impersonation_token')
        localStorage.removeItem('impersonation_session_id')
      }
      // Refresh to get back to admin
      await refreshUser()
      window.location.href = '/admin'
    } catch (error) {
      console.error('Error ending impersonation:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, login2FA, logout, refreshUser, impersonate, endImpersonation, sessionKicked, kickReason }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

