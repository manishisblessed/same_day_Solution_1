'use client'

import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { AuthUser } from '@/types/database.types'
import { getCurrentUser, signIn, signOut as authSignOut } from '@/lib/auth'
import { apiFetch } from '@/lib/api-client'
import { getGeoLocation } from '@/hooks/useGeolocation'

interface AuthContextType {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string, role: string) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  impersonate: (userId: string, userRole: 'retailer' | 'distributor' | 'master_distributor') => Promise<void>
  endImpersonation: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const geoRequestedRef = useRef(false)

  useEffect(() => {
    checkUser()
  }, [])

  // Request geolocation once user is authenticated (all roles).
  // This caches the position in sessionStorage so every subsequent
  // apiFetch call automatically attaches the X-Geo-Location header.
  useEffect(() => {
    if (!user || geoRequestedRef.current) return
    geoRequestedRef.current = true
    getGeoLocation(10_000).catch(() => {})
  }, [user])

  const checkUser = async () => {
    try {
      // First, check if we have a cached user from recent login
      // This is important because Supabase session might not be immediately available
      if (typeof window !== 'undefined') {
        try {
          const cachedUser = localStorage.getItem('auth_user')
          const cacheTimestamp = localStorage.getItem('auth_user_timestamp')
          
          if (cachedUser) {
            const parsedUser = JSON.parse(cachedUser) as AuthUser
            setUser(parsedUser)
            setLoading(false)
            
            // Check if this is a recent login (within 5 minutes)
            // If recent, trust the cache and don't verify immediately
            const isRecentLogin = cacheTimestamp && 
              (Date.now() - parseInt(cacheTimestamp)) < 5 * 60 * 1000
            
            if (isRecentLogin) {
              return
            }
            
            // For older sessions, verify in background but DON'T clear on failure
            // Only update if we get valid data
            getCurrentUser().then((verifiedUser) => {
              if (verifiedUser) {
                // Update cache with fresh data
                localStorage.setItem('auth_user', JSON.stringify(verifiedUser))
                localStorage.setItem('auth_user_timestamp', Date.now().toString())
                setUser(verifiedUser)
              }
              // Don't clear user on verification failure - keep cached user
              // User will be properly logged out when they try to access protected resources
            }).catch(() => {
              // On error, keep cached user
            })
            return
          }
        } catch (e) {
          // Ignore parse errors
        }
        
        // Clear corrupted storage entries
        try {
          const localStorageKeys = Object.keys(localStorage)
          for (const key of localStorageKeys) {
            const value = localStorage.getItem(key)
            if (value && value.startsWith('base64-')) {
              localStorage.removeItem(key)
            }
          }
          
          const sessionStorageKeys = Object.keys(sessionStorage)
          for (const key of sessionStorageKeys) {
            const value = sessionStorage.getItem(key)
            if (value && value.startsWith('base64-')) {
              sessionStorage.removeItem(key)
            }
          }
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      
      // Add shorter timeout to prevent hanging (2 seconds for logged out state)
      const timeoutPromise = new Promise((resolve) => 
        setTimeout(() => resolve(null), 2000)
      )
      
      const currentUser = await Promise.race([
        getCurrentUser(),
        timeoutPromise
      ]) as AuthUser | null
      
      setUser(currentUser)
      
      // Cache the user if found
      if (typeof window !== 'undefined' && currentUser) {
        localStorage.setItem('auth_user', JSON.stringify(currentUser))
        localStorage.setItem('auth_user_timestamp', Date.now().toString())
      }
    } catch (error: any) {
      const errorMessage = error?.message || error?.toString() || ''
      const isCorruptedSessionError = errorMessage.includes("Cannot create property 'user' on string") || 
                                      errorMessage.includes('base64-')
      
      if (!isCorruptedSessionError) {
        console.error('Error checking user:', error)
      }
      
      if (isCorruptedSessionError) {
        if (typeof window !== 'undefined') {
          try {
            const allKeys = [...Object.keys(localStorage), ...Object.keys(sessionStorage)]
            allKeys.forEach(key => {
              if (key.includes('supabase') || key.includes('sb-') || key.startsWith('auth-token')) {
                localStorage.removeItem(key)
                sessionStorage.removeItem(key)
              }
            })
          } catch (e) {
            // Ignore cleanup errors
          }
        }
      }
      
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  const login = async (email: string, password: string, role: string) => {
    setLoading(true)
    try {
      const result = await signIn(email, password, role as any)
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
      throw error
    } finally {
      setLoading(false)
    }
  }

  const logout = async () => {
    setLoading(true)
    try {
      // Log logout activity before clearing session (non-blocking)
      apiFetch('/api/activity/log', {
        method: 'POST',
        body: JSON.stringify({
          activity_type: 'logout',
          activity_category: 'auth',
          activity_description: `${user?.role || 'user'} logged out: ${user?.email || 'unknown'}`,
        }),
      }).catch(() => {})

      // Sign out from Supabase first
      await authSignOut()
      
      // Clear all auth-related data
      if (typeof window !== 'undefined') {
        // Clear cached user
        localStorage.removeItem('auth_user')
        localStorage.removeItem('auth_user_timestamp')
        
        // Clear all Supabase related items from localStorage
        const localStorageKeys: string[] = []
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key && (key.includes('supabase') || key.includes('sb-'))) {
            localStorageKeys.push(key)
          }
        }
        localStorageKeys.forEach(key => localStorage.removeItem(key))
        
        // Clear all Supabase related items from sessionStorage
        const sessionStorageKeys: string[] = []
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i)
          if (key && (key.includes('supabase') || key.includes('sb-'))) {
            sessionStorageKeys.push(key)
          }
        }
        sessionStorageKeys.forEach(key => sessionStorage.removeItem(key))
        
        // Clear impersonation data if any
        localStorage.removeItem('impersonation_token')
        localStorage.removeItem('impersonation_session_id')
        sessionStorage.removeItem('impersonated_user')
      }
      
      setUser(null)
    } catch (error) {
      console.error('Error signing out:', error)
      // Even if signOut fails, clear local state
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
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser, impersonate, endImpersonation }}>
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

