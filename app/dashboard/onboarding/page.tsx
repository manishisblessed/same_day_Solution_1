'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import InviteManager from '@/components/onboarding/InviteManager'
import DashboardChrome from '@/components/DashboardChrome'

export default function DashboardOnboardingPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && user && !['master_distributor', 'distributor'].includes(user.role)) {
      router.replace('/business-login')
    }
  }, [user, loading, router])

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>
  if (!user) return null

  return (
    <DashboardChrome>
      <div className="p-4 sm:p-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Onboard Partners</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Invite {user.role === 'master_distributor' ? 'distributors' : 'retailers'} to join your network.
            </p>
          </div>
          <InviteManager />
        </div>
      </div>
    </DashboardChrome>
  )
}
