'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import FinanceHeader from '@/components/FinanceHeader'
import FinanceSidebar from '@/components/FinanceSidebar'
import SessionTimer from '@/components/SessionTimer'

const mobileLinks = [
  { href: '/finance-same', label: 'Home' },
  { href: '/finance-same/reconciliation', label: 'Recon' },
  { href: '/finance-same/reports', label: 'Reports' },
  { href: '/finance-same/settlement', label: 'T+1' },
  { href: '/finance-same/wallet-ledger', label: 'Ledger' },
]

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user, loading } = useAuth()
  const isLoginPage = pathname === '/finance-same/login'
  const showChrome = !isLoginPage && !loading && user?.role === 'finance_executive'

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      {showChrome && <FinanceHeader />}
      {showChrome && (
        <SessionTimer
          sessionDuration={30}
          warningTime={60}
          userRole="finance_executive"
          loginPath="/finance-same/login"
          showBadge={false}
        />
      )}
      {showChrome ? (
        <div className="pt-16 flex flex-col md:flex-row min-h-[calc(100vh-4rem)]">
          <div className="md:hidden flex flex-wrap gap-1.5 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-900/90">
            {mobileLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`text-xs px-2.5 py-1 rounded-full border ${
                  pathname === l.href
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
                    : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'
                }`}
              >
                {l.label}
              </Link>
            ))}
          </div>
          <FinanceSidebar />
          <main className="flex-1 min-w-0 overflow-x-auto p-4 md:p-6">{children}</main>
        </div>
      ) : (
        <main className="min-h-screen">{children}</main>
      )}
    </div>
  )
}
