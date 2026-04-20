import type { AuthUser } from '@/types/database.types'

export function isFinanceExecutive(user: AuthUser | null | undefined): boolean {
  return user?.role === 'finance_executive'
}

/** Full financial read access (same data scope as admin for reporting APIs). */
export function isAdminOrFinance(user: AuthUser | null | undefined): boolean {
  return user?.role === 'admin' || user?.role === 'finance_executive'
}

/** Destructive / configuration actions — finance cannot perform these. */
export function isAdminOnly(user: AuthUser | null | undefined): boolean {
  return user?.role === 'admin'
}
