import type { OnboardingInvite } from '@/types/database.types'

/**
 * Multi-role identity reuse (one PAN across MD / DT / RT).
 *
 * PAN is the sole identity key — DigiLocker only returns a masked Aadhaar, so
 * Aadhaar can't be a reliable uniqueness key. The onboarding name-match gate
 * already ties Aadhaar to the same person as the PAN.
 */

/** Sub-admin department key that gates the "Identity Reuse Approvals" tab. */
export const IDENTITY_REUSE_DEPARTMENT = 'identity-reuse-approvals'

/**
 * Whether an admin_users row (by email) may action identity-reuse requests:
 * a super_admin, or a sub-admin granted the department (or "all").
 */
export async function isReuseApprover(
  supabase: any,
  email: string
): Promise<{ ok: boolean; adminId?: string }> {
  const { data } = await supabase
    .from('admin_users')
    .select('id, admin_type, department, departments, is_active')
    .eq('email', email)
    .maybeSingle()
  if (!data || data.is_active === false) return { ok: false }
  const depts: string[] = Array.isArray(data.departments) ? data.departments : []
  const ok =
    data.admin_type === 'super_admin' ||
    data.department === 'all' ||
    data.department === IDENTITY_REUSE_DEPARTMENT ||
    depts.includes('all') ||
    depts.includes(IDENTITY_REUSE_DEPARTMENT)
  return { ok, adminId: data.id }
}

export const MDRT_ROLE_TABLES = {
  master_distributor: 'master_distributors',
  distributor: 'distributors',
  retailer: 'retailers',
} as const

export type MdrtRole = keyof typeof MDRT_ROLE_TABLES

export function isMdrtRole(role: string | null | undefined): role is MdrtRole {
  return role === 'master_distributor' || role === 'distributor' || role === 'retailer'
}

export interface PanConflict {
  role: MdrtRole
  table: string
  partner_id: string | null
  name: string | null
  status: string | null
}

/** Every MD/DT/RT account that already holds this PAN. */
export async function detectPanConflicts(supabase: any, pan: string): Promise<PanConflict[]> {
  const out: PanConflict[] = []
  for (const role of Object.keys(MDRT_ROLE_TABLES) as MdrtRole[]) {
    const table = MDRT_ROLE_TABLES[role]
    const { data } = await supabase
      .from(table)
      .select('partner_id, name, status')
      .eq('pan_number', pan)
    for (const row of data || []) {
      out.push({ role, table, partner_id: row.partner_id ?? null, name: row.name ?? null, status: row.status ?? null })
    }
  }
  return out
}

export interface IdentityReuseRequest {
  id: string
  invite_id: string
  pan_number: string
  aadhaar_uid: string | null
  target_role: MdrtRole
  conflicting_accounts: Array<{ role: string; partner_id: string | null; name: string | null; status: string | null }>
  status: 'pending' | 'approved' | 'rejected'
  assigned_to: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  reason: string | null
  created_at: string
  updated_at: string
}

export async function getReuseRequest(
  supabase: any,
  inviteId: string
): Promise<IdentityReuseRequest | null> {
  const { data } = await supabase
    .from('identity_reuse_requests')
    .select('*')
    .eq('invite_id', inviteId)
    .maybeSingle()
  return (data as IdentityReuseRequest) || null
}

/**
 * Create (or refresh) the reuse request for this invite. An existing admin
 * decision (approved/rejected) is preserved — we only refresh the PAN snapshot.
 */
export async function upsertReuseRequest(
  supabase: any,
  args: { invite: OnboardingInvite; pan: string; aadhaarUid?: string | null; conflicts: PanConflict[] }
): Promise<IdentityReuseRequest | null> {
  const now = new Date().toISOString()
  const conflicting_accounts = args.conflicts.map((c) => ({
    role: c.role,
    partner_id: c.partner_id,
    name: c.name,
    status: c.status,
  }))

  const existing = await getReuseRequest(supabase, args.invite.id)
  if (existing) {
    await supabase
      .from('identity_reuse_requests')
      .update({
        pan_number: args.pan,
        aadhaar_uid: args.aadhaarUid ?? existing.aadhaar_uid,
        target_role: args.invite.target_role,
        conflicting_accounts,
        updated_at: now,
      })
      .eq('id', existing.id)
    return existing
  }

  const { data: created } = await supabase
    .from('identity_reuse_requests')
    .insert({
      invite_id: args.invite.id,
      pan_number: args.pan,
      aadhaar_uid: args.aadhaarUid ?? null,
      target_role: args.invite.target_role,
      conflicting_accounts,
      status: 'pending',
    })
    .select()
    .maybeSingle()
  return (created as IdentityReuseRequest) || null
}
