'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { 
  LayoutDashboard, Users, Package, Crown, 
  BarChart3, Settings, FileText,
  Activity, X, Menu, CreditCard, Receipt, CheckCircle2,
  Building2, FileBarChart, Layers, Key
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
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/admin?tab=dashboard' },
  { id: 'retailers', label: 'Retailers', icon: Users, href: '/admin?tab=retailers' },
  { id: 'distributors', label: 'Distributors', icon: Package, href: '/admin?tab=distributors' },
  { id: 'master-distributors', label: 'Master Distributors', icon: Crown, href: '/admin?tab=master-distributors' },
  { id: 'scheme-management', label: 'Scheme Management', icon: Layers, href: '/admin/scheme-management' },
  { id: 'partners', label: 'Partners', icon: Building2, href: '/admin?tab=partners', badge: undefined },
  { id: 'pos-machines', label: 'POS Machines', icon: CreditCard, href: '/admin?tab=pos-machines' },
  { id: 'pos-partner-api', label: 'POS Partner API', icon: Key, href: '/admin?tab=pos-partner-api' },
  { id: 'razorpay-transactions', label: 'Razorpay Transactions', icon: Receipt, href: '/admin/razorpay-transactions' },
  { id: 'services', label: 'Services', icon: Activity, href: '/admin?tab=services' },
  { id: 'service-txn-report', label: 'Service Txn Report', icon: FileText, href: '/admin/service-transaction-report' },
  { id: 'reports', label: 'Reports', icon: FileBarChart, href: '/admin?tab=reports' },
  { id: 'settings', label: 'Settings', icon: Settings, href: '/admin/settings' },
]

export default function AdminSidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const pathname = usePathname()
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)

  const isActive = (href: string) => {
    // Handle query param based tabs
    if (typeof window !== 'undefined') {
      const currentUrl = window.location.href
      if (href.includes('?tab=')) {
        return currentUrl.includes(href)
      }
    }
    // Handle page-based routes
    if (href === '/admin?tab=dashboard') return pathname === '/admin' && !pathname.includes('tab=')
    return pathname.includes(href.split('?')[0].split('#')[0])
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
  isActive, 
  hoveredItem, 
  setHoveredItem,
  onClose 
}: { 
  pathname: string
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
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary-500 to-secondary-500 flex items-center justify-center">
            <Activity className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-sm text-gray-900 dark:text-white">Admin</span>
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
                  ? 'bg-gradient-to-r from-primary-500 to-secondary-500 text-white shadow-md shadow-primary-500/30'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {active && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute inset-0 bg-gradient-to-r from-primary-500 to-secondary-500 rounded-lg"
                  initial={false}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
              <div className={`relative z-10 ${active ? 'text-white' : 'text-gray-600 dark:text-gray-400 group-hover:text-primary-600 dark:group-hover:text-primary-400'}`}>
                <Icon className="w-4 h-4" />
              </div>
              <span className={`relative z-10 font-medium text-sm ${active ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                {item.label}
              </span>
              {item.badge && (
                <span className={`relative z-10 ml-auto px-2 py-0.5 text-xs rounded-full ${
                  active 
                    ? 'bg-white/20 text-white' 
                    : 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
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

