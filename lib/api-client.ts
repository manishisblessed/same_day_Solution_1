/**
 * API Client Utility
 * Handles API base URL configuration for different environments
 * 
 * Architecture:
 * - Frontend: Hosted on AWS Amplify (samedaysolution.co.in)
 * - BBPS Backend: Hosted on EC2 with whitelisted IP for BBPS API
 * - Other APIs: Handled by Amplify's Next.js API routes
 * 
 * Set NEXT_PUBLIC_BBPS_BACKEND_URL to your EC2 backend URL (e.g., http://api.samedaysolution.co.in)
 */

/**
 * Get the BBPS Backend API base URL (EC2)
 * - In localhost: Uses localhost:3000 (same as Next.js dev server)
 * - In production: Uses NEXT_PUBLIC_BBPS_BACKEND_URL (EC2 backend)
 * - If NEXT_PUBLIC_BBPS_BACKEND_URL is not set, falls back to relative URLs (same-origin)
 */
export function getBBPSBackendUrl(): string {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname
    
    // Local development - use local Next.js API routes
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return '' // Use relative URLs in development
    }
  }
  
  // Production: EC2 backend URL for BBPS (if configured)
  // If NEXT_PUBLIC_BBPS_BACKEND_URL is empty or not set, use Amplify API routes
  const backendUrl = process.env.NEXT_PUBLIC_BBPS_BACKEND_URL
  if (backendUrl && backendUrl.trim() !== '') {
    return backendUrl.endsWith('/') ? backendUrl.slice(0, -1) : backendUrl
  }
  
  // Fallback: Use relative URLs (Amplify API routes on same origin)
  // This works when BBPS credentials are configured in Amplify environment
  return ''
}

/**
 * Check if a path is a route that needs EC2 backend
 * These routes require:
 * - Whitelisted IP for Sparkup API access (BBPS/Payout)
 * - Server-side environment variables (Admin APIs with Supabase)
 */
function isEC2Route(path: string): boolean {
  return path.includes('/api/bbps/') || 
         path.includes('/api/payout/') ||
         path.includes('/api/admin/sparkup-balance') ||
         path.includes('/api/admin/sub-admins') ||
         path.includes('/api/admin/create-user') ||
         path.includes('/api/admin/approve-partner') ||
         path.includes('/api/admin/pending-verifications') ||
         path.includes('/api/admin/reset-password') ||
         path.includes('/api/admin/upload-document')
}

/**
 * Get the API base URL for a specific path
 * - EC2 routes: Use EC2 backend (whitelisted IP + server env vars)
 * - Other routes: Use relative URLs (Amplify API routes)
 */
export function getApiBaseUrl(path: string = ''): string {
  if (isEC2Route(path)) {
    return getBBPSBackendUrl()
  }
  // All other routes use Amplify API routes (relative URLs)
  return ''
}

/**
 * Build a full API URL from a path
 * @param path - API path (e.g., '/api/bbps/categories')
 * @returns Full URL or relative path depending on route type
 * 
 * - EC2 routes (BBPS, Payout, Admin APIs) → EC2 backend 
 * - Other routes → Amplify API routes (relative URLs)
 */
export function getApiUrl(path: string): string {
  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const baseUrl = getApiBaseUrl(normalizedPath)
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath
}

/**
 * Centralized API fetch function
 * - EC2 routes → EC2 backend (whitelisted IP + server env vars)
 * - Other routes → Amplify API routes (uses cookies for auth)
 * 
 * @param path - API path (e.g., '/api/wallet/balance')
 * @param options - Fetch options
 * @returns Promise<Response>
 */
export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = getApiUrl(path)
  
  // Build headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  }
  
  const fetchOptions: RequestInit = {
    ...options,
    credentials: 'include', // Include cookies for Amplify API routes
    headers,
  }

  const response = await fetch(url, fetchOptions)

  // Handle 401 Unauthorized errors gracefully
  if (response.status === 401) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('API call returned 401 Unauthorized:', path)
    }
  }

  return response
}

/**
 * Centralized API fetch with JSON parsing and error handling
 * 
 * @param path - API path
 * @param options - Fetch options
 * @returns Promise with parsed JSON data
 */
export async function apiFetchJson<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await apiFetch(path, options)
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
    
    // Provide user-friendly error messages
    if (response.status === 401) {
      throw new Error('Session expired, please login again')
    } else if (response.status === 403) {
      throw new Error('You do not have permission to access this resource')
    } else if (response.status === 404) {
      throw new Error('Resource not found')
    } else if (response.status >= 500) {
      throw new Error('Server error, please try again later')
    } else {
      throw new Error(errorData.error || errorData.message || 'Request failed')
    }
  }
  
  return response.json()
}

