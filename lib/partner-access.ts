import { NextResponse } from 'next/server'
import { AuthUser } from '@/types/database.types'

export type PartnerAccessResult =
  | { ok: true }
  | { ok: false; response: NextResponse }

/**
 * Authorize a partner-scoped endpoint for both `partner` and `sub_partner` roles.
 *
 * Sub-partners share their parent partner's `partner_id`, wallet, and TPIN. Once authorized
 * they are normalized to `role = 'partner'`, so every downstream partner code path (data
 * scoping, wallet debit, TPIN verification) runs unchanged.
 *
 * The client sidebar hides tabs a sub-partner lacks, but that is NOT a security boundary.
 * Pass the permission key(s) backing this endpoint: a sub-partner is rejected with 403 unless
 * at least one of them is `true` in their `permissions` map. Omit the keys only for endpoints
 * that any authenticated partner user may call (e.g. shared read-only charge lookups).
 *
 * This is a no-op for every non `sub_partner` role, so callers keep their existing role gate.
 * Call it AFTER the endpoint's own null-user check and BEFORE its role gate.
 */
export function authorizeSubPartner(
  user: AuthUser | null,
  permissionKeys?: string | string[]
): PartnerAccessResult {
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) }
  }

  if (user.role !== 'sub_partner') return { ok: true }

  if (!user.partner_id) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 403 }) }
  }

  if (permissionKeys) {
    const keys = Array.isArray(permissionKeys) ? permissionKeys : [permissionKeys]
    const allowed = keys.some((k) => user.permissions?.[k] === true)
    if (!allowed) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'You do not have permission to access this feature' },
          { status: 403 }
        ),
      }
    }
  }

  user.role = 'partner'
  return { ok: true }
}
