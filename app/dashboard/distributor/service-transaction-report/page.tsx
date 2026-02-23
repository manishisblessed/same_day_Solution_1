'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import DistributorSidebar from '@/components/DistributorSidebar'
import ServiceTransactionReport from '@/components/ServiceTransactionReport'
import { Menu } from 'lucide-react'

export default function DistributorServiceTransactionReportPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'distributor')) {
      router.push('/business-login')
    }
  }, [user, authLoading, router])

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <DistributorSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="lg:ml-56">
        <div className="lg:hidden p-4">
          <button onClick={() => setSidebarOpen(true)} className="p-2 rounded-lg bg-white dark:bg-gray-800 shadow">
            <Menu className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          <ServiceTransactionReport userRole="distributor" userName={user.name || user.email} />
        </div>
      </div>
    </div>
  )
}
