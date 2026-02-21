/**
 * API Client Utility
 * Handles API base URL configuration for different environments
 * 
 * Architecture:
 * - Frontend: Hosted on AWS Amplify (samedaysolution.in)
 * - BBPS Backend: Hosted on EC2 with whitelisted IP for BBPS API
 * - Other APIs: Handled by Amplify's Next.js API routes
 * 
 * Set NEXT_PUBLIC_BBPS_BACKEND_URL to your EC2 backend URL (e.g., https://api.samedaysolution.in)
 */

import { createBrowserClient } from '@supabase/ssr'

/**
 * Get Supabase access token for API calls
 * This is needed for cross-origin requests where cookies won't be sent
 */
async function getAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null
  
  try {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token || null
  } catch (error) {
    console.error('Failed to get access token:', error)
    return null
  }
}

/**
 * Get the EC2 Backend API base URL
 * - In localhost: Uses localhost:3000 (same as Next.js dev server)
 * - In production: Uses EC2 backend URL
 */
export function getBBPSBackendUrl(): string {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname
    
    // Local development - use local Next.js API routes
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return '' // Use relative URLs in development
    }
    
    // Production: Always use EC2 backend
    // Check environment variable first, then use hardcoded fallback
    const backendUrl = process.env.NEXT_PUBLIC_BBPS_BACKEND_URL
    if (backendUrl && backendUrl.trim() !== '') {
      return backendUrl.endsWith('/') ? backendUrl.slice(0, -1) : backendUrl
    }
    
    // Hardcoded fallback for production - EC2 backend URL
    // This ensures API calls go to EC2 even if env var is not set
    return 'https://api.samedaysolution.in'
  }
  
  // Server-side: Check environment variable
  const backendUrl = process.env.NEXT_PUBLIC_BBPS_BACKEND_URL
  if (backendUrl && backendUrl.trim() !== '') {
    return backendUrl.endsWith('/') ? backendUrl.slice(0, -1) : backendUrl
  }
  
  // Fallback for SSR
  return 'https://api.samedaysolution.in'
}

/**
 * Check if a path is a route that needs EC2 backend
 * ALL API routes go to EC2 because:
 * - Sparkup APIs need whitelisted IP (BBPS/Payout)
 * - Admin APIs need SUPABASE_SERVICE_ROLE_KEY
 * - User management needs Supabase admin access
 * - Payout bank list needs EC2 credentials
 */
function isEC2Route(path: string): boolean {
  // Route ALL /api/ calls to EC2 for consistency
  // EC2 has all environment variables and whitelisted IP
  return path.startsWith('/api/')
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
 * Extended fetch options with timeout support
 */
export interface ApiFetchOptions extends Omit<RequestInit, 'signal'> {
  timeout?: number // Timeout in milliseconds (default: 120000 for BBPS/Payout routes)
}

/**
 * Centralized API fetch function
 * - EC2 routes → EC2 backend (whitelisted IP + server env vars)
 * - Other routes → Amplify API routes (uses cookies for auth)
 * 
 * IMPORTANT: For cross-origin requests (to EC2 backend), cookies won't be sent
 * because they're set for a different subdomain. We include the access token
 * in the Authorization header to authenticate these requests.
 * 
 * @param path - API path (e.g., '/api/wallet/balance')
 * @param options - Fetch options with optional timeout
 * @returns Promise<Response>
 */
export async function apiFetch(
  path: string,
  options: ApiFetchOptions = {}
): Promise<Response> {
  const url = getApiUrl(path)
  const isCrossOrigin = url.startsWith('http')
  
  // Determine timeout - longer for BBPS/Payout APIs
  const isBBPSOrPayoutRoute = path.includes('/bbps/') || path.includes('/payout/')
  const defaultTimeout = isBBPSOrPayoutRoute ? 120000 : 60000 // 120s for BBPS/Payout, 60s for others
  const timeout = options.timeout ?? defaultTimeout
  
  // Create AbortController for timeout
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  
  // Build headers - don't set Content-Type for FormData (browser sets it automatically with boundary)
  const isFormData = options.body instanceof FormData
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string> || {}),
  }
  
  // Always include the access token in Authorization header
  // This is needed because:
  // 1. Cross-origin: cookies are domain-specific and won't be sent to subdomains
  // 2. Same-origin: Supabase SSR cookies can sometimes fail to be read server-side,
  //    so the Bearer token serves as a reliable fallback for getCurrentUserWithFallback()
  if (typeof window !== 'undefined') {
    const accessToken = await getAccessToken()
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`
    }
  }
  
  // Remove timeout from options before spreading (it's not a valid fetch option)
  const { timeout: _, ...restOptions } = options
  
  const fetchOptions: RequestInit = {
    ...restOptions,
    credentials: 'include', // Include cookies for same-origin requests
    headers,
    signal: controller.signal,
  }

  try {
    const response = await fetch(url, fetchOptions)
    clearTimeout(timeoutId)

    // Handle 401 Unauthorized errors gracefully
    if (response.status === 401) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('API call returned 401 Unauthorized:', path)
      }
    }

    return response
  } catch (error: any) {
    clearTimeout(timeoutId)
    
    // Handle timeout/abort errors
    if (error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout / 1000} seconds. The server is taking too long to respond.`)
    }
    throw error
  }
}

/**
 * Centralized API fetch with JSON parsing and error handling
 * 
 * @param path - API path
 * @param options - Fetch options
 * @returns Promise with parsed JSON data
 */
/**
 * Helper to check if a string looks like HTML (nginx error page, etc.)
 */
function isHtmlResponse(text: string): boolean {
  const trimmed = text.trim().toLowerCase()
  return trimmed.startsWith('<!doctype') || 
         trimmed.startsWith('<html') || 
         trimmed.includes('<center>') ||
         trimmed.includes('gateway time') ||
         trimmed.includes('nginx')
}

/**
 * Extract a meaningful error message from HTML or non-JSON responses
 */
function extractErrorFromHtml(html: string, status: number): string {
  // Check for specific nginx errors
  if (html.includes('504') || html.includes('Gateway Time-out') || html.includes('Gateway Timeout')) {
    return 'Request timed out. The payment may still be processing - please check your transaction history before retrying.'
  }
  if (html.includes('502') || html.includes('Bad Gateway')) {
    return 'Service temporarily unavailable. Please try again in a few moments.'
  }
  if (html.includes('503') || html.includes('Service Unavailable')) {
    return 'Service is currently unavailable. Please try again later.'
  }
  if (html.includes('500') || html.includes('Internal Server Error')) {
    return 'Server error occurred. Please try again.'
  }
  // Default based on status code
  if (status === 504) return 'Request timed out. Please check transaction history before retrying.'
  if (status === 502) return 'Service temporarily unavailable.'
  if (status === 503) return 'Service unavailable. Please try again later.'
  if (status >= 500) return 'Server error. Please try again.'
  return `Request failed with status ${status}`
}

export async function apiFetchJson<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await apiFetch(path, options)
  
  if (!response.ok) {
    // Try to get the response as text first to check if it's HTML
    let errorText: string
    try {
      errorText = await response.text()
    } catch {
      errorText = ''
    }
    
    // Check if response is HTML (e.g., nginx error page)
    if (isHtmlResponse(errorText)) {
      const friendlyError = extractErrorFromHtml(errorText, response.status)
      throw new Error(friendlyError)
    }
    
    // Try to parse as JSON
    let errorData: any = { error: 'Unknown error' }
    try {
      errorData = JSON.parse(errorText)
    } catch {
      // Not JSON, use the text as error message if it's short and readable
      if (errorText && errorText.length < 200 && !errorText.includes('<')) {
        errorData = { error: errorText }
      }
    }
    
    // Provide user-friendly error messages, but preserve backend error messages when available
    if (response.status === 401) {
      throw new Error(errorData.error || errorData.message || 'Session expired, please login again')
    } else if (response.status === 403) {
      throw new Error(errorData.error || errorData.message || 'You do not have permission to access this resource')
    } else if (response.status === 404) {
      throw new Error(errorData.error || errorData.message || 'Resource not found')
    } else if (response.status === 504) {
      throw new Error('Request timed out. The payment may still be processing - please check your transaction history before retrying.')
    } else if (response.status === 429) {
      throw new Error(errorData.error || errorData.message || 'Too many requests. Please wait a minute and try again.')
    } else if (response.status >= 500) {
      // For 500 errors, use backend error message if available, otherwise show generic message
      throw new Error(errorData.error || errorData.message || 'Server error, please try again later')
    } else {
      throw new Error(errorData.error || errorData.message || 'Request failed')
    }
  }
  
  return response.json()
}
