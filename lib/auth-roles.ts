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
 * Assignable sections for a finance executive.
 *
 * Finance execs get full sub-admin parity: any admin section can be granted
 * EXCEPT Settings (and the catch-all "all"). Ids/labels mirror the admin
 * portal navigation (see AdminSidebar) and the sub-admin `departments`
 * vocabulary, so a granted tab maps 1:1 to the admin_users.departments entry
 * that gates the corresponding admin page + sidebar item.
 */
export const FINANCE_TABS: Array<{ id: string; label: string }> = [
  // Finance-specific sections (distinct from their admin-portal equivalents),
  // rendered by dedicated /admin/finance-* routes that reuse the finance components.
  { id: 'finance-reconciliation', label: 'Reconciliation' },
  { id: 'finance-reports', label: 'Service reports' },
  { id: 'finance-settlement', label: 'T+1 settlement' },
  { id: 'finance-wallet-ledger', label: 'Wallet ledger (Finance)' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'onboarding', label: 'Onboarding & Invites' },
  { id: 'daily-report', label: 'Daily Report' },
  { id: 'business-analytics', label: 'Business Analytics' },
  { id: 'pos-transactions', label: 'POS Transactions' },
  { id: 'pos-reconciliation', label: 'POS Reconciliation' },
  { id: 'retailers', label: 'Retailers' },
  { id: 'distributors', label: 'Distributors' },
  { id: 'master-distributors', label: 'Master Distributors' },
  { id: 'scheme-management', label: 'Scheme Management' },
  { id: 'partners', label: 'Partners' },
  { id: 'pos-machines', label: 'POS Machines' },
  { id: 'pos-history', label: 'POS History' },
  { id: 'pos-tracking-report', label: 'POS Tracking Report' },
  { id: 'pos-rental-report', label: 'POS Rental Report' },
  { id: 'partner-invoices', label: 'Partner Invoices' },
  { id: 'pos-partner-api', label: 'POS Partner API' },
  { id: 'master-partners', label: 'Master Partners' },
  { id: 'services', label: 'Services' },
  { id: 'aeps', label: 'AEPS Management' },
  { id: 'reports', label: 'Reports & Analytics' },
  { id: 'service-transaction-report', label: 'Service Transaction Report' },
  { id: 'pos-report', label: 'POS Report' },
  { id: 'bill-payment-report', label: 'Bill Payment Report' },
  { id: 'aeps-report', label: 'AEPS Report' },
  { id: 'settlement-report', label: 'Settlement Report' },
  { id: 'settlement', label: 'Settlement' },
  { id: 'settlement-2-approvals', label: 'Settlement-2 Approvals' },
  { id: 'revenue-wallet', label: 'Revenue Wallet' },
  { id: 'wallet-ledger', label: 'Wallet ledger' },
  { id: 'push-pull-report', label: 'Push/Pull Report' },
  { id: 'performance', label: 'Performance' },
  { id: 'subscriptions', label: 'Subscriptions' },
  { id: 'portal-management', label: 'Portal Management' },
  { id: 'legal-agreements', label: 'Legal Agreements' },
  { id: 'reversals', label: 'Reversals' },
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
