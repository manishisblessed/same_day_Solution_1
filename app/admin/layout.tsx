'use client'

import { usePathname } from 'next/navigation'
import AdminHeader from '@/components/AdminHeader'

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isLoginPage = pathname === '/admin/login'

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 overflow-hidden">
      {!isLoginPage && <AdminHeader />}
      <main className="relative w-full overflow-hidden">
        {children}
      </main>
    </div>
  )
}

