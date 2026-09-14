'use client'

import { PanelLeft } from 'lucide-react'
import { toggleSidebarResponsive } from '@/hooks/useSidebar'

export default function SidebarToggle() {
  return (
    <button
      type="button"
      onClick={toggleSidebarResponsive}
      className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-gray-600 dark:text-gray-300 flex-shrink-0"
      aria-label="Toggle sidebar"
      title="Toggle sidebar"
    >
      <PanelLeft className="w-5 h-5" />
    </button>
  )
}
