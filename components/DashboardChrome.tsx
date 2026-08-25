'use client'

import { useState } from 'react'
import { Menu } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import MasterDistributorHeader from '@/components/MasterDistributorHeader'
import MasterDistributorSidebar from '@/components/MasterDistributorSidebar'
import DistributorHeader from '@/components/DistributorHeader'
import DistributorSidebar from '@/components/DistributorSidebar'
import RetailerHeader from '@/components/RetailerHeader'
import RetailerSidebar from '@/components/RetailerSidebar'

export default function DashboardChrome({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const role = user?.role

  let Header: () => JSX.Element | null = () => null
  let Sidebar: (p: { isOpen: boolean; onClose: () => void }) => JSX.Element | null = () => null

  if (role === 'distributor') {
    Header = DistributorHeader
    Sidebar = DistributorSidebar
  } else if (role === 'retailer') {
    Header = RetailerHeader
    Sidebar = RetailerSidebar
  } else {
    Header = MasterDistributorHeader
    Sidebar = MasterDistributorSidebar
  }

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 overflow-x-hidden">
      <Header />
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 lg:ml-56 min-w-0 overflow-x-hidden pt-16">
        <button
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden fixed top-20 left-2 md:left-4 z-30 p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700"
        >
          <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
        </button>

        <div className="h-[calc(100vh-4rem)] overflow-y-auto overflow-x-hidden">
          {children}
        </div>
      </div>
    </div>
  )
}
