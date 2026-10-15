'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import CAHeader from '@/components/ca/CAHeader'
import CASidebar from '@/components/ca/CASidebar'
import SessionTimer from '@/components/SessionTimer'
import SessionKickedOverlay from '@/components/SessionKickedOverlay'
import Link from 'next/link'
import { Landmark, Receipt, FileText } from 'lucide-react'

const mobileLinks = [
  { href: '/ca/billing', label: 'Home' },
  { href: '/ca/billing/bank-mdr', label: 'Bank MDR' },
  { href: '/ca/billing/reimbursement', label: 'Reimbursement' },
  { href: '/ca/billing/transaction-invoices', label: 'GST Invoices' },
]

export default function CALayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading } = useAuth()
  const isLoginPage = pathname === '/ca/login'
  const showChrome = !isLoginPage && !loading && user?.role === 'ca_executive'

  useEffect(() => {
    if (!loading && !isLoginPage && user?.role !== 'ca_executive') {
      router.replace('/ca/login')
    }
  }, [loading, isLoginPage, user, router])

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <SessionKickedOverlay loginPath="/ca/login" />
      {showChrome && <CAHeader />}
      {showChrome && (
        <SessionTimer
          sessionDuration={30}
          warningTime={60}
          userRole="ca_executive"
          loginPath="/ca/login"
          showBadge={false}
        />
      )}
      {showChrome ? (
        <div className="pt-16 flex flex-col md:flex-row min-h-[calc(100vh-4rem)]">
          {/* Mobile nav bar */}
          <div className="md:hidden flex flex-wrap gap-1.5 px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-white/90 dark:bg-gray-900/90">
            {mobileLinks.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`text-xs px-2.5 py-1 rounded-full border ${
                  pathname === l.href || (l.href !== '/ca/billing' && pathname?.startsWith(l.href))
                    ? 'border-violet-500 bg-violet-50 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300'
                    : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'
                }`}
              >
                {l.label}
              </Link>
            ))}
          </div>
          <CASidebar />
          <main className="flex-1 min-w-0 overflow-x-auto p-4 md:p-6">{children}</main>
        </div>
      ) : (
        <main className="min-h-screen">{children}</main>
      )}
    </div>
  )
}
