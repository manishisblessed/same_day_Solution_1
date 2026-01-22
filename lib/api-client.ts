/**
 * API Client Utility
 * Handles API base URL configuration for different environments
 * 
 * IMPORTANT: In production, set NEXT_PUBLIC_API_BASE_URL to your domain
 * (e.g., https://www.samedaysolution.in), NOT to EC2 IP/port.
 * 
 * The backend should be proxied through Nginx on the same domain.
 */

/**
 * Get the API base URL for frontend requests
 * - In localhost: Uses relative URLs (calls Next.js API routes locally)
 * - In production: Uses NEXT_PUBLIC_API_BASE_URL if set (should be domain, not EC2 IP)
 * - Falls back to relative URLs (recommended for same-domain setup)
 * - Works seamlessly for both localhost and production
 */
export function getApiBaseUrl(): string {
  // Always use relative URLs on localhost (calls Next.js API routes)
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      // Local development: use relative URLs to call Next.js API routes
      return ''
    }
    
    // Production: use NEXT_PUBLIC_API_BASE_URL if set
    if (process.env.NEXT_PUBLIC_API_BASE_URL) {
      let baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL.trim()
      // Remove trailing slash if present
      baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
      
      // Ensure HTTP for IP addresses (not HTTPS) - port 3000 is HTTP only
      const ipAddressPattern = /\d+\.\d+\.\d+\.\d+/
      if (ipAddressPattern.test(baseUrl)) {
        // IP address detected - ensure HTTP protocol (not HTTPS)
        if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
          baseUrl = `http://${baseUrl}`
        } else if (baseUrl.startsWith('https://')) {
          // Replace HTTPS with HTTP for IP addresses (EC2 backend on port 3000 is HTTP only)
          baseUrl = baseUrl.replace('https://', 'http://')
        }
      }
      
      return baseUrl
    }
  }
  
  // Return empty string for relative URLs (same origin - recommended)
  return ''
}

/**
 * Build a full API URL from a path
 * @param path - API path (e.g., '/api/bbps/categories')
 * @returns Full URL or relative path depending on configuration
 */
export function getApiUrl(path: string): string {
  const baseUrl = getApiBaseUrl()
  // Ensure path starts with /
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath
}

/**
 * Centralized API fetch function with automatic credentials inclusion
 * This ensures all API calls send Supabase auth cookies
 * 
 * @param path - API path (e.g., '/api/wallet/balance')
 * @param options - Fetch options (credentials will be automatically added)
 * @returns Promise<Response>
 */
export async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = getApiUrl(path)
  
  // Merge options, ensuring credentials: 'include' is always set
  const fetchOptions: RequestInit = {
    ...options,
    credentials: 'include', // Always include cookies for authentication
    headers: {
      'Content-Type': 'application/json',
      ...options.headers, // Allow overriding headers
    },
  }

  const response = await fetch(url, fetchOptions)

  // Handle 401 Unauthorized errors gracefully
  if (response.status === 401) {
    // Don't throw here - let the caller handle it
    // But we can log for debugging
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

