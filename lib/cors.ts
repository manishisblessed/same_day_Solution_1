/**
 * CORS Utility
 * Handles CORS headers for API routes
 */

import { NextRequest, NextResponse } from 'next/server'

/**
 * Get allowed origin for CORS
 * In production, only allow requests from the domain
 * In development, allow localhost
 */
function getAllowedOrigin(request: NextRequest): string | null {
  const origin = request.headers.get('origin')
  
  if (!origin) {
    // No origin header means same-origin request, no CORS needed
    return null
  }
  
  // In production, check against allowed domains
  if (process.env.NODE_ENV === 'production') {
    const allowedDomains = [
      process.env.NEXT_PUBLIC_APP_URL,
      'https://www.samedaysolution.in',
      'https://samedaysolution.in',
    ].filter(Boolean) as string[]
    
    // Normalize domains (remove trailing slashes, ensure https)
    const normalizedDomains = allowedDomains.map(domain => {
      let normalized = domain.trim()
      if (normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1)
      }
      return normalized
    })
    
    // If origin matches allowed domain, return it
    if (normalizedDomains.some(domain => origin === domain || origin.startsWith(domain + '/'))) {
      return origin
    }
    
    // Origin doesn't match, return null (will not add CORS headers)
    return null
  }
  
  // In development, allow localhost
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
    return origin
  }
  
  return null
}

/**
 * Add CORS headers to response
 * Only adds CORS headers if origin is different (cross-origin request)
 */
export function addCorsHeaders(
  request: NextRequest,
  response: NextResponse
): NextResponse {
  const allowedOrigin = getAllowedOrigin(request)
  
  // Only add CORS headers for cross-origin requests
  if (allowedOrigin) {
    response.headers.set('Access-Control-Allow-Origin', allowedOrigin)
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    response.headers.set('Access-Control-Allow-Credentials', 'true')
  }
  
  return response
}

/**
 * Handle OPTIONS request for CORS preflight
 */
export function handleCorsPreflight(request: NextRequest): NextResponse | null {
  const allowedOrigin = getAllowedOrigin(request)
  
  if (allowedOrigin) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true',
      },
    })
  }
  
  return null
}

