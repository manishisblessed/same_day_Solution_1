/**
 * CORS Utility
 * 
 * IMPORTANT: CORS is now handled CENTRALLY in middleware.ts for ALL API routes.
 * These functions are kept as no-op pass-throughs for backward compatibility
 * with existing route handlers that call them. They do NOT add any headers.
 * 
 * This prevents duplicate Access-Control-Allow-Origin headers which browsers reject.
 * All CORS logic lives in middleware.ts only.
 */

import { NextRequest, NextResponse } from 'next/server'

/**
 * Add CORS headers to response - NO-OP (handled by middleware)
 * 
 * CORS headers are now added centrally in middleware.ts to ensure
 * ALL API routes get CORS headers automatically, including error responses.
 * This function is kept for backward compatibility but does nothing.
 */
export function addCorsHeaders(
  request: NextRequest,
  response: NextResponse
): NextResponse {
  // No-op: CORS is handled by middleware.ts
  // Do NOT add headers here - it would cause duplicate Access-Control-Allow-Origin
  return response
}

/**
 * Handle OPTIONS request for CORS preflight - NO-OP (handled by middleware)
 * 
 * OPTIONS preflight is handled in middleware.ts (lines 56-59).
 * Route handlers never receive OPTIONS requests because middleware
 * short-circuits them. This function is kept for backward compatibility.
 */
export function handleCorsPreflight(request: NextRequest): NextResponse | null {
  // No-op: OPTIONS preflight is handled by middleware.ts
  // Returning null means the route handler continues normally (which won't happen
  // in practice because middleware already handles OPTIONS and returns 204)
  return null
}

