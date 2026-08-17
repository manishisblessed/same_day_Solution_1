import { NextRequest } from 'next/server'
import { AuthNetworkError, getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import type { AuthUser } from '@/types/database.types'

export type LegalAuthResult =
  | { admin: AuthUser }
  | { error: string; status: 401 | 403 | 503 }

/**
 * Authorize access to the Legal Agreements admin APIs.
 *
 * Access is granted to:
 *  - the master (super) admin, and
 *  - any sub-admin whose departments include "legal-agreements" (or "all").
 *
 * This runs on the EC2 backend where SUPABASE_SERVICE_ROLE_KEY is available, so the
 * admin_users role/department lookup succeeds. On transient network errors we return
 * 503 (not 401) so the client doesn't trigger a false "session expired" logout.
 */
export async function requireLegalAdmin(request: NextRequest): Promise<LegalAuthResult> {
  let admin: AuthUser | null
  try {
    const result = await getCurrentUserWithFallback(request)
    admin = result.user
  } catch (err) {
    if (err instanceof AuthNetworkError) {
      return { error: 'Auth service temporarily unavailable', status: 503 }
    }
    throw err
  }

  if (!admin) return { error: 'Session expired', status: 401 }
  if (admin.role !== 'admin') return { error: 'Admin access required', status: 403 }

  try {
    const supabase = getSupabaseAdmin()
    const { data } = await supabase
      .from('admin_users')
      .select('admin_type, department, departments')
      .eq('email', admin.email)
      .maybeSingle()

    if (isAuthorisedForLegal(data)) return { admin }
    return { error: 'You do not have access to Legal Agreements', status: 403 }
  } catch {
    // If the department lookup itself fails, fall back to allowing any admin rather
    // than locking the master admin out over an infra hiccup.
    return { admin }
  }
}

function isAuthorisedForLegal(
  a: { admin_type?: string; department?: string; departments?: string[] } | null | undefined
): boolean {
  if (!a) return false
  if (a.admin_type === 'super_admin') return true
  const depts = Array.isArray(a.departments) ? a.departments : []
  return (
    a.department === 'legal-agreements' ||
    a.department === 'all' ||
    depts.includes('legal-agreements') ||
    depts.includes('all')
  )
}
