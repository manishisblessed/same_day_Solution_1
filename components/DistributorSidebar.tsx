'use client'

import { useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { 
  LayoutDashboard, Package, Activity, 
  Settings, TrendingUp, Users, Network, X, Menu, Layers, CreditCard, FileText
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface SidebarItem {
  id: string
  label: string
  icon: any
  href: string
  badge?: number
}

const sidebarItems: SidebarItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard/distributor' },
  { id: 'services', label: 'Services', icon: Activity, href: '/dashboard/distributor?tab=services' },
  { id: 'retailers', label: 'Retailers', icon: Users, href: '/dashboard/distributor?tab=retailers' },
  { id: 'pos-machines', label: 'POS Machines', icon: CreditCard, href: '/dashboard/distributor?tab=pos-machines' },
  { id: 'scheme-management', label: 'Scheme Management', icon: Layers, href: '/dashboard/distributor?tab=scheme-management' },
  { id: 'network', label: 'Network', icon: Network, href: '/dashboard/distributor?tab=network' },
  { id: 'service-txn-report', label: 'Service Txn Report', icon: FileText, href: '/dashboard/distributor/service-transaction-report' },
  { id: 'reports', label: 'Reports', icon: TrendingUp, href: '/dashboard/distributor?tab=reports' },
  { id: 'settings', label: 'Settings', icon: Settings, href: '/dashboard/distributor?tab=settings' },
]

export default function DistributorSidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)

  const isActive = (href: string) => {
    if (href === '/dashboard/distributor') {
      return pathname === '/dashboard/distributor' || pathname === '/dashboard/distributor/' && !searchParams.get('tab')
    }
    if (href.includes('?tab=')) {
      const tabParam = href.split('?tab=')[1]
      return pathname === '/dashboard/distributor' && searchParams.get('tab') === tabParam
    }
    return pathname.includes(href.split('?')[0])
  }

  return (
    <>
      {/* Mobile Overlay */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/50 z-40 lg:hidden"
              onClick={onClose}
            />
            <motion.div
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed left-0 top-0 bottom-0 w-64 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 z-50 lg:hidden overflow-y-auto"
            >
              <SidebarContent 
                pathname={pathname}
                searchParams={searchParams}
                isActive={isActive} 
                hoveredItem={hoveredItem}
                setHoveredItem={setHoveredItem}
                onClose={onClose}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-56 bg-gradient-to-b from-white to-gray-50 dark:from-gray-900 dark:to-gray-800 border-r border-gray-200 dark:border-gray-800 h-[calc(100vh-4rem)] fixed left-0 top-16 overflow-y-auto">
        <SidebarContent 
          pathname={pathname}
          searchParams={searchParams}
          isActive={isActive} 
          hoveredItem={hoveredItem}
          setHoveredItem={setHoveredItem}
        />
      </aside>
    </>
  )
}

function SidebarContent({ 
  pathname,
  searchParams,
  isActive, 
  hoveredItem, 
  setHoveredItem,
  onClose 
}: { 
  pathname: string
  searchParams: any
  isActive: (href: string) => boolean
  hoveredItem: string | null
  setHoveredItem: (id: string | null) => void
  onClose?: () => void
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Logo/Header - Compact */}
      <div className="p-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="relative w-7 h-7 flex-shrink-0">
            <Image
              src="/LOGO_Same_Day.jpeg"
              alt="Same Day Solution"
              width={28}
              height={28}
              className="object-contain"
              priority
            />
          </div>
          <span className="font-bold text-sm text-gray-900 dark:text-white">Distributor</span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="lg:hidden p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X className="w-4 h-4 text-gray-500" />
          </button>
        )}
      </div>

      {/* Navigation - Compact */}
      <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
        {sidebarItems.map((item) => {
          const active = isActive(item.href)
          const Icon = item.icon
          
          return (
            <Link
              key={item.id}
              href={item.href}
              onClick={onClose}
              onMouseEnter={() => setHoveredItem(item.id)}
              onMouseLeave={() => setHoveredItem(null)}
              className={`relative flex items-center space-x-2 px-3 py-2 rounded-lg transition-all duration-200 group ${
                active
                  ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-md shadow-purple-500/30'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {active && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute inset-0 bg-gradient-to-r from-purple-500 to-purple-600 rounded-lg"
                  initial={false}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
              <div className={`relative z-10 ${active ? 'text-white' : 'text-gray-600 dark:text-gray-400 group-hover:text-purple-600 dark:group-hover:text-purple-400'}`}>
                <Icon className="w-4 h-4" />
              </div>
              <span className={`relative z-10 font-medium text-sm ${active ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                {item.label}
              </span>
              {item.badge && (
                <span className={`relative z-10 ml-auto px-2 py-0.5 text-xs rounded-full ${
                  active 
                    ? 'bg-white/20 text-white' 
                    : 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
                }`}>
                  {item.badge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

