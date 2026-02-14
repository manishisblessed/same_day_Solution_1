'use client'

import { useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { 
  LayoutDashboard, ShoppingCart, Activity, 
  Settings, TrendingUp, CreditCard, X, Menu, Zap,
  Wallet, Receipt, Banknote, Percent
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
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard/retailer?tab=dashboard' },
  { id: 'wallet', label: 'Wallet', icon: Wallet, href: '/dashboard/retailer?tab=wallet' },
  { id: 'services', label: 'Services', icon: Activity, href: '/dashboard/retailer?tab=services' },
  { id: 'bbps', label: 'BBPS Payments', icon: Receipt, href: '/dashboard/retailer?tab=bbps' },
  { id: 'payout', label: 'Settlement', icon: Banknote, href: '/dashboard/retailer?tab=payout' },
  { id: 'transactions', label: 'Transactions', icon: CreditCard, href: '/dashboard/retailer?tab=transactions' },
  { id: 'mdr-schemes', label: 'MDR Schemes', icon: Percent, href: '/dashboard/retailer?tab=mdr-schemes' },
  { id: 'reports', label: 'Reports', icon: TrendingUp, href: '/dashboard/retailer?tab=reports' },
]

export default function RetailerSidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)

  const isActive = (item: SidebarItem) => {
    const currentTab = searchParams.get('tab')
    // Dashboard is active when no tab param or tab=dashboard
    if (item.id === 'dashboard') {
      return pathname === '/dashboard/retailer' && (!currentTab || currentTab === 'dashboard')
    }
    // Other items match by their id against the tab query param
    return pathname === '/dashboard/retailer' && currentTab === item.id
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
          isActive={isActive} 
          hoveredItem={hoveredItem}
          setHoveredItem={setHoveredItem}
        />
      </aside>
    </>
  )
}

function SidebarContent({ 
  isActive, 
  hoveredItem, 
  setHoveredItem,
  onClose 
}: { 
  isActive: (item: SidebarItem) => boolean
  hoveredItem: string | null
  setHoveredItem: (id: string | null) => void
  onClose?: () => void
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Logo/Header - Compact */}
      <div className="p-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
            <ShoppingCart className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-sm text-gray-900 dark:text-white">Retailer</span>
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
          const active = isActive(item)
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
                  ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/30'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {active && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute inset-0 bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg"
                  initial={false}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
              <div className={`relative z-10 ${active ? 'text-white' : 'text-gray-600 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400'}`}>
                <Icon className="w-4 h-4" />
              </div>
              <span className={`relative z-10 font-medium text-sm ${active ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                {item.label}
              </span>
              {item.badge && (
                <span className={`relative z-10 ml-auto px-2 py-0.5 text-xs rounded-full ${
                  active 
                    ? 'bg-white/20 text-white' 
                    : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                }`}>
                  {item.badge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Quick Stats */}
      <div className="p-4 border-t border-gray-200 dark:border-gray-800">
        <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/10 dark:from-blue-500/20 dark:to-blue-600/20 rounded-xl p-4 border border-blue-200/50 dark:border-blue-800/50">
          <div className="flex items-center space-x-2 mb-2">
            <Zap className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Quick Stats</span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-gray-600 dark:text-gray-400">Today's Sales</span>
              <span className="font-semibold text-gray-900 dark:text-white">-</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-gray-600 dark:text-gray-400">Active Services</span>
              <span className="font-semibold text-gray-900 dark:text-white">-</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

