'use client'

import { useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'

export default function DistributorSchemeManagementPage() {
  const { user } = useAuth()
  const router = useRouter()

  useEffect(() => {
    router.replace('/dashboard/distributor?tab=scheme-management')
  }, [router])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
      <p className="text-gray-600 dark:text-gray-400">Redirecting to Scheme Management...</p>
    </div>
  )
}
