'use client'

import { createBrowserClient } from '@supabase/ssr'

/**
 * Get the current session's access token
 */
export async function getAuthToken(): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  
  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[Upload Helper] Supabase env vars not configured')
    return null
  }

  const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey)
  const { data: { session } } = await supabase.auth.getSession()
  
  return session?.access_token || null
}

/**
 * Upload a document with proper authentication (includes auth token as fallback)
 */
export async function uploadDocument(
  file: File,
  documentType: string,
  partnerId?: string
): Promise<{ success: boolean; url?: string; error?: string; action?: string }> {
  try {
    // Get auth token for fallback authentication
    const token = await getAuthToken()
    
    if (!token) {
      return {
        success: false,
        error: 'Session expired. Please log in again.',
        action: 'RELOGIN'
      }
    }

    const formData = new FormData()
    formData.append('file', file)
    formData.append('documentType', documentType)
    if (partnerId) {
      formData.append('partnerId', partnerId)
    }

    const response = await fetch('/api/admin/upload-document', {
      method: 'POST',
      body: formData,
      headers: {
        // Include Authorization header as fallback for cookie issues
        'Authorization': `Bearer ${token}`
      },
      credentials: 'include' // Include cookies
    })

    if (!response.ok) {
      const contentType = response.headers.get('content-type')
      let errorData: any = { error: `HTTP ${response.status}` }
      
      if (contentType?.includes('application/json')) {
        try {
          errorData = await response.json()
        } catch (e) {
          // Ignore JSON parse errors
        }
      }

      // Handle specific error codes
      if (errorData.code === 'SESSION_EXPIRED' || errorData.action === 'RELOGIN') {
        return {
          success: false,
          error: errorData.message || 'Session expired. Please log in again.',
          action: 'RELOGIN'
        }
      }

      return {
        success: false,
        error: errorData.message || errorData.error || `Upload failed (${response.status})`
      }
    }

    const result = await response.json()
    return {
      success: true,
      url: result.url
    }
  } catch (error: any) {
    console.error('[Upload Helper] Error:', error)
    return {
      success: false,
      error: error?.message || 'Upload failed due to network error'
    }
  }
}

/**
 * Check if user session is valid before attempting uploads
 */
export async function checkSessionValid(): Promise<boolean> {
  const token = await getAuthToken()
  return !!token
}

/**
 * Handle session expired - redirect to login
 */
export function handleSessionExpired() {
  // Clear any cached user data
  if (typeof window !== 'undefined') {
    localStorage.removeItem('cached_user')
    // Redirect to login
    window.location.href = '/login?reason=session_expired'
  }
}

