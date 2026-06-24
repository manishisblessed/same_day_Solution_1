// Server-only module: never import from a 'use client' component.
// (The `server-only` npm guard is not installed in this project.)
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getClientIp } from '@/lib/rate-limit'
import type { AuthUser } from '@/types/database.types'

export interface GuardSuccess {
  ok: true
  user: AuthUser
  ip: string
}
export interface GuardFailure {
  ok: false
  response: NextResponse
}
export type GuardResult = GuardSuccess | GuardFailure

/**
 * Parse the optional admin IP allowlist from env.
 * ADMIN_IP_ALLOWLIST="1.2.3.4,5.6.7.8" — if unset/empty, allowlisting is OFF
 * (so you never accidentally lock yourself out).
 */
function getAdminIpAllowlist(): string[] {
  return (process.env.ADMIN_IP_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Require an authenticated user with one of the allowed roles.
 * Optionally enforces an IP allowlist (admin endpoints).
 *
 * Usage:
 *   const guard = await requireRole(request, ['admin'])
 *   if (!guard.ok) return guard.response
 *   const admin = guard.user
 */
export async function requireRole(
  request: NextRequest,
  allowedRoles: string[],
  opts: { enforceIpAllowlist?: boolean } = {}
): Promise<GuardResult> {
  const ip = getClientIp(request)

  const { user } = await getCurrentUserWithFallback(request)
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Authentication required', code: 'SESSION_EXPIRED' },
        { status: 401 }
      ),
    }
  }

  if (!allowedRoles.includes(user.role as string)) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Forbidden: insufficient privileges' },
        { status: 403 }
      ),
    }
  }

  if (opts.enforceIpAllowlist) {
    const allowlist = getAdminIpAllowlist()
    if (allowlist.length > 0 && !allowlist.includes(ip)) {
      console.warn(`[admin-guard] Blocked ${user.email} from non-allowlisted IP ${ip}`)
      return {
        ok: false,
        response: NextResponse.json(
          { success: false, error: 'Access denied from this network' },
          { status: 403 }
        ),
      }
    }
  }

  return { ok: true, user, ip }
}

/**
 * Convenience wrapper for admin-only endpoints.
 * Enforces the IP allowlist by default (only active when ADMIN_IP_ALLOWLIST is set).
 */
export function requireAdmin(request: NextRequest): Promise<GuardResult> {
  return requireRole(request, ['admin'], { enforceIpAllowlist: true })
}
