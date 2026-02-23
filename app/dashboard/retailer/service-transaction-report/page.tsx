'use client'

import { useState, useEffect, Suspense, lazy } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import ServiceTransactionReport from '@/components/ServiceTransactionReport'
import RetailerHeader from '@/components/RetailerHeader'
import { Menu } from 'lucide-react'

const RetailerSidebar = lazy(() =>
  import('@/components/RetailerSidebar').catch(() => ({
    default: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => (
      <aside className="hidden lg:flex flex-col w-56 bg-gray-50 border-r border-gray-200 h-[calc(100vh-4rem)] fixed left-0 top-16" />
    ),
  }))
)

export default function RetailerServiceTransactionReportPage() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'retailer')) {
      router.push('/business-login')
    }
  }, [user, authLoading, router])

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <Suspense fallback={null}>
        <RetailerSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      </Suspense>

      <div className="lg:ml-56">
        <div className="lg:hidden p-4">
          <button onClick={() => setSidebarOpen(true)} className="p-2 rounded-lg bg-white dark:bg-gray-800 shadow">
            <Menu className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          <ServiceTransactionReport userRole="retailer" userName={user.name || user.email} />
        </div>
      </div>
    </div>
  )
}
