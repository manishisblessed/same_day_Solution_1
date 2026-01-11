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

