/**
 * Authentication helper for API routes.
 * Delegates to getCurrentUserWithFallback so Bearer tokens (sent by apiFetch)
 * and cookies both work — cookie-only auth caused false 401s and forced logouts.
 */

import { NextRequest } from 'next/server'
import { AuthUser } from '@/types/database.types'
import { getCurrentUserWithFallback } from '@/lib/auth-server'

export async function getCurrentUserFromRequest(
  request: NextRequest
): Promise<AuthUser | null> {
  const { user, method } = await getCurrentUserWithFallback(request)
  if (!user) {
    console.warn('[Auth] getCurrentUserFromRequest: no user (method:', method, ')')
  }
  return user
}

