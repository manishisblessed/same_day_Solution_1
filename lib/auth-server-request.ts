/**
 * Authentication helper for API routes.
 * Delegates to getCurrentUserWithFallback so Bearer tokens (sent by apiFetch)
 * and cookies both work — cookie-only auth caused false 401s and forced logouts.
 *
 * Re-throws AuthNetworkError so route catch blocks return 503 (not 401).
 */

import { NextRequest } from 'next/server'
import { AuthUser } from '@/types/database.types'
import { getCurrentUserWithFallback, AuthNetworkError } from '@/lib/auth-server'

export { AuthNetworkError }

export async function getCurrentUserFromRequest(
  request: NextRequest,
  opts?: { skipSessionCheck?: boolean }
): Promise<AuthUser | null> {
  // AuthNetworkError propagates to caller (route returns 503, not 401)
  const { user, method } = await getCurrentUserWithFallback(request, opts)
  if (!user) {
    console.warn('[Auth] getCurrentUserFromRequest: no user (method:', method, ')')
  }
  return user
}

