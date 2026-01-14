'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { AuthUser } from '@/types/database.types'
import { getCurrentUser, signIn, signOut as authSignOut } from '@/lib/auth'

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

  useEffect(() => {
    checkUser()
  }, [])

  const checkUser = async () => {
    try {
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((resolve) => 
        setTimeout(() => resolve(null), 10000)
      )
      
      const currentUser = await Promise.race([
        getCurrentUser(),
        timeoutPromise
      ]) as AuthUser | null
      
      setUser(currentUser)
    } catch (error) {
      console.error('Error checking user:', error)
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
    } catch (error: any) {
      throw error
    } finally {
      setLoading(false)
    }
  }

  const logout = async () => {
    setLoading(true)
    try {
      await authSignOut()
      setUser(null)
    } catch (error) {
      console.error('Error signing out:', error)
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
      const response = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        await fetch(`/api/admin/impersonate?session_id=${sessionId}`, {
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

