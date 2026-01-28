'use client'

import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import AdminHeader from '@/components/AdminHeader'
import SessionTimer from '@/components/SessionTimer'

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const { user, loading } = useAuth()
  const isLoginPage = pathname === '/admin/login'
  
  // Don't show header/timer while loading auth or if not logged in (except on login page)
  const showHeader = !isLoginPage && !loading && user

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 overflow-hidden">
      {showHeader && <AdminHeader />}
      {showHeader && (
        <SessionTimer 
          sessionDuration={10} 
          warningTime={30} 
          userRole="admin"
          loginPath="/admin/login"
          showBadge={false}
        />
      )}
      <main className="relative w-full overflow-hidden">
        {children}
      </main>
    </div>
  )
}

