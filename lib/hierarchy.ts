/**
 * Onboarding hierarchy rules (single source of truth).
 *
 * Ported/trimmed from NEXTGEN's src/lib/hierarchy.ts. This project has NO Super
 * Distributor, so the network chain is:
 *
 *   admin -> master_distributor -> distributor -> retailer
 *
 * Roles are stored lowercase snake_case here (unlike NEXTGEN's SCREAMING_SNAKE).
 *
 * TODO (requested hierarchy parity with NEXTGEN — SEPARATE LARGE EFFORT):
 * The target org structure is  master_admin -> admin -> super_distributor (SD)
 * -> master_distributor (MD) -> distributor (DT) -> retailer (RT).
 * That is NOT a small edit — it requires, across the whole app:
 *   1) a new `super_distributor` role + `super_distributors` table (schema +
 *      RLS + wallet/commission/settlement wiring like the other tiers),
 *   2) splitting admin into master_admin vs admin (auth, admin_users.admin_type,
 *      login + gating), and letting admin only onboard SDs (like NEXTGEN's
 *      getAllowedRoles),
 *   3) updating NETWORK_TIERS / canOnboard / defaultChildRole / parentRoleOf
 *      here + the invite parent-picker + create-partner APIs,
 *   4) migrating existing MD/DT/RT parent links to sit under an SD.
 * Do this as a dedicated, well-tested migration — do not bolt it on piecemeal.
 */

export type NetworkRole = 'retailer' | 'distributor' | 'master_distributor'
export type OnboardRole = NetworkRole
export type CreatorRole = NetworkRole | 'admin' | 'finance_executive'

// Bottom -> top of the network tree.
export const NETWORK_TIERS: NetworkRole[] = [
  'retailer',
  'distributor',
  'master_distributor',
]

// Roles that are allowed to create onboarding invites.
export const ONBOARD_CAPABLE_ROLES = [
  'admin',
  'master_distributor',
  'distributor',
]

const ROLE_LABELS: Record<string, string> = {
  master_distributor: 'Master Distributor',
  distributor: 'Distributor',
  retailer: 'Retailer',
  partner: 'Partner',
  master_partner: 'Master Partner',
  admin: 'Admin',
  finance_executive: 'Finance',
}

/**
 * Independent (non-network) roles that admin can onboard through the invite
 * wizard. These live in the `partners` table and have NO MD/DT/RT parent — a
 * plain partner is later linked to a Master Partner in /admin/master-partners.
 */
export const INDEPENDENT_ONBOARD_ROLES = ['partner', 'master_partner']

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] || role
}

/**
 * Can a user with `creatorRole` onboard someone with `targetRole`?
 *
 *   admin              -> any network role (MD / DT / RT)
 *   master_distributor -> distributor
 *   distributor        -> retailer
 *   retailer           -> nobody
 */
export function canOnboard(creatorRole: string, targetRole: string): boolean {
  // Only admin may onboard independent partners / master partners.
  if (INDEPENDENT_ONBOARD_ROLES.includes(targetRole)) {
    return creatorRole === 'admin'
  }

  if (!NETWORK_TIERS.includes(targetRole as NetworkRole)) return false

  if (creatorRole === 'admin' || creatorRole === 'finance_executive') {
    return true // admin can create any network role
  }

  const cIdx = NETWORK_TIERS.indexOf(creatorRole as NetworkRole)
  const tIdx = NETWORK_TIERS.indexOf(targetRole as NetworkRole)
  // Creator must be exactly one tier above the target.
  return cIdx > 0 && tIdx >= 0 && cIdx === tIdx + 1
}

/**
 * The default child role a creator onboards when no explicit role is chosen.
 *   admin  -> master_distributor
 *   MD     -> distributor
 *   DT     -> retailer
 */
export function defaultChildRole(creatorRole: string): NetworkRole | null {
  if (creatorRole === 'admin' || creatorRole === 'finance_executive') {
    return 'master_distributor'
  }
  const cIdx = NETWORK_TIERS.indexOf(creatorRole as NetworkRole)
  if (cIdx > 0) return NETWORK_TIERS[cIdx - 1]
  return null
}

/**
 * The role of the parent that a target role must be linked to.
 *   retailer           -> distributor
 *   distributor        -> master_distributor
 *   master_distributor -> null (top of tree)
 */
export function parentRoleOf(targetRole: string): NetworkRole | null {
  const tIdx = NETWORK_TIERS.indexOf(targetRole as NetworkRole)
  if (tIdx < 0 || tIdx + 1 >= NETWORK_TIERS.length) return null
  return NETWORK_TIERS[tIdx + 1]
}

/**
 * Upline declaration approval is required only when the INVITER is a network
 * role (MD or DT). Admin / finance created invites skip approval, mirroring
 * NEXTGEN's needsSuccessorApproval().
 */
export function needsUplineApproval(inviterRole: string): boolean {
  return inviterRole === 'master_distributor' || inviterRole === 'distributor'
}
