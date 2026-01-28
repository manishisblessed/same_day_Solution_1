'use client'

import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import SessionTimer from '@/components/SessionTimer'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const { user, loading } = useAuth()
  
  // Determine user role from pathname
  const getUserRole = (): 'retailer' | 'distributor' | 'master_distributor' => {
    if (pathname?.includes('/distributor')) return 'distributor'
    if (pathname?.includes('/master-distributor')) return 'master_distributor'
    return 'retailer'
  }

  // Don't show timer while loading auth
  const showTimer = !loading && user

  return (
    <>
      {showTimer && (
        <SessionTimer 
          sessionDuration={10} 
          warningTime={30} 
          userRole={getUserRole()}
          loginPath="/business-login"
          showBadge={false}
        />
      )}
      {children}
    </>
  )
}

