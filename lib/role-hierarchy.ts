/**
 * Role-based assignment hierarchy:
 * - Admin → can assign to Master Distributor, Partner
 * - Master Distributor → can assign to Distributor
 * - Distributor → can assign to Retailer
 */

export type UserRole = 'admin' | 'master_distributor' | 'distributor' | 'retailer' | 'partner' | 'sub_partner'

export const ASSIGNABLE_ROLES: Record<string, { value: string; label: string }[]> = {
  admin: [
    { value: 'master_distributor', label: 'Master Distributor' },
    { value: 'partner', label: 'Partner' },
  ],
  partner: [
    { value: 'sub_partner', label: 'Sub-Partner' },
  ],
  master_distributor: [
    { value: 'distributor', label: 'Distributor' },
  ],
  distributor: [
    { value: 'retailer', label: 'Retailer' },
  ],
}

export function getAssignableRoles(currentUserRole: string | undefined): { value: string; label: string }[] {
  if (!currentUserRole) return []
  return ASSIGNABLE_ROLES[currentUserRole] || []
}

export function canAssignToRole(currentUserRole: string | undefined, targetRole: string): boolean {
  const assignable = getAssignableRoles(currentUserRole)
  return assignable.some(r => r.value === targetRole)
}
