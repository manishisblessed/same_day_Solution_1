'use client'

import { usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import SessionTimer from '@/components/SessionTimer'
import SessionKickedOverlay from '@/components/SessionKickedOverlay'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const { user, loading } = useAuth()
  
  const getUserRole = (): 'retailer' | 'distributor' | 'master_distributor' | 'partner' => {
    if (pathname?.includes('/partner')) return 'partner'
    if (pathname?.includes('/master-distributor')) return 'master_distributor'
    if (pathname?.includes('/distributor')) return 'distributor'
    return 'retailer'
  }

  const showTimer = !loading && user

  return (
    <>
      <SessionKickedOverlay loginPath="/business-login" />
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

