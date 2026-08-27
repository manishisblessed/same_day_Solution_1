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

/**
 * Assignable finance portal tabs (Home is always accessible and not listed here).
 *
 * TODO (finance parity with sub-admins): we must be able to assign ANY tab to a
 * finance executive, just like sub-admins get any admin section. Today this list
 * is limited to the 5 pages that exist in the separate finance portal
 * (/finance-same/*). Per the agreed Option B (keep the separate finance portal),
 * enabling a new tab requires, for each section:
 *   1) add its { id, label } here,
 *   2) build the page at app/finance-same/<id>/page.tsx (reuse the admin section
 *      component; gate with financeHasTab),
 *   3) add it to FinanceSidebar items + layout mobileLinks,
 *   4) expose a finance-accessible API under /api/finance/* (admin /api/admin/*
 *      is IP-allowlisted, so don't rely on it) gated with isAdminOrFinance.
 * FINANCE_TAB_IDS / sanitizeTabs in app/api/admin/finance-users/route.ts already
 * derive from this list, so validation + persistence pick up new ids for free.
 */
export const FINANCE_TABS: Array<{ id: string; label: string }> = [
  { id: 'reconciliation', label: 'Reconciliation' },
  { id: 'reports', label: 'Service reports' },
  { id: 'settlement', label: 'T+1 settlement' },
  { id: 'wallet-ledger', label: 'Wallet ledger' },
  { id: 'settings', label: 'Settings' },
]

export const FINANCE_TAB_IDS = FINANCE_TABS.map((t) => t.id)

/**
 * Whether a finance_executive may access a given portal tab.
 * Home is always allowed. 'all' in the user's tabs grants everything.
 */
export function financeHasTab(user: AuthUser | null | undefined, tab: string): boolean {
  if (user?.role !== 'finance_executive') return false
  if (tab === 'home') return true
  const tabs = user.finance_tabs || []
  return tabs.includes('all') || tabs.includes(tab)
}
