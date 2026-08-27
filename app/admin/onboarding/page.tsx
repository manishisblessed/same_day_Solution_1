'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Menu } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import AdminSidebar from '@/components/AdminSidebar'
import InviteManager from '@/components/onboarding/InviteManager'

export default function AdminOnboardingPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    // Onboarding is admin-only. Finance has no rights to onboard any user.
    if (!loading && user && user.role !== 'admin') {
      router.replace('/admin')
    }
  }, [user, loading, router])

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>
  if (!user) return null

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 overflow-x-hidden">
      <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 lg:ml-56 min-w-0 overflow-x-hidden pt-16">
        <button
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden fixed top-20 left-2 z-30 p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700"
        >
          <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
        </button>
        <div className="p-4 sm:p-8">
          <div className="mx-auto max-w-5xl">
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Onboarding &amp; Invites</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Create invite links for any role and approve completed KYC submissions.
              </p>
            </div>
            <InviteManager adminMode />
          </div>
        </div>
      </div>
    </div>
  )
}
