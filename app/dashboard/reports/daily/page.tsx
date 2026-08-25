'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import DailyReport from '@/components/reports/DailyReport'
import DashboardChrome from '@/components/DashboardChrome'

export default function DashboardDailyReportPage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && user && !['master_distributor', 'distributor', 'retailer'].includes(user.role)) {
      router.replace('/business-login')
    }
  }, [user, loading, router])

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>
  if (!user) return null

  return (
    <DashboardChrome>
      <div className="p-4 sm:p-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Daily Report</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Your network&apos;s opening, push/pull, credit/debit, commission and closing for a day.</p>
          </div>
          <DailyReport />
        </div>
      </div>
    </DashboardChrome>
  )
}
