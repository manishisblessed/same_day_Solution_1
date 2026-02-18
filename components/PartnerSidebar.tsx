'use client'

import { useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { 
  LayoutDashboard, ShoppingCart, Activity, 
  Settings, TrendingUp, CreditCard, X, Menu,
  Wallet, Receipt, Banknote, Percent, BookOpen,
  Crown, Sparkles, Key, BarChart3, Zap
} from 'lucide-react'

import { motion, AnimatePresence } from 'framer-motion'

interface SidebarItem {
  id: string
  label: string
  icon: any
  href: string
  badge?: number
  vip?: boolean
}

const sidebarItems: SidebarItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/dashboard/partner?tab=dashboard' },
  { id: 'wallet', label: 'Wallet', icon: Wallet, href: '/dashboard/partner?tab=wallet' },
  { id: 'services', label: 'Services', icon: Activity, href: '/dashboard/partner?tab=services' },
  { id: 'bbps', label: 'BBPS Payments', icon: Receipt, href: '/dashboard/partner?tab=bbps' },
  { id: 'payout', label: 'Settlement', icon: Banknote, href: '/dashboard/partner?tab=payout' },
  { id: 'transactions', label: 'Transactions', icon: CreditCard, href: '/dashboard/partner?tab=transactions' },
  { id: 'ledger', label: 'Ledger', icon: BookOpen, href: '/dashboard/partner?tab=ledger' },
  { id: 'pos-machines', label: 'My POS Machines', icon: CreditCard, href: '/dashboard/partner?tab=pos-machines' },
  { id: 'mdr-schemes', label: 'MDR Schemes', icon: Percent, href: '/dashboard/partner?tab=mdr-schemes' },
  { id: 'reports', label: 'Reports', icon: TrendingUp, href: '/dashboard/partner?tab=reports' },
  // VIP Features
  { id: 'api-management', label: 'API Management', icon: Key, href: '/dashboard/partner?tab=api-management', vip: true },
  { id: 'analytics', label: 'Advanced Analytics', icon: BarChart3, href: '/dashboard/partner?tab=analytics', vip: true },
  { id: 'settings', label: 'Settings', icon: Settings, href: '/dashboard/partner?tab=settings' },
]

export default function PartnerSidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [hoveredItem, setHoveredItem] = useState<string | null>(null)

  const isActive = (item: SidebarItem) => {
    const currentTab = searchParams.get('tab')
    // Dashboard is active when no tab param or tab=dashboard
    if (item.id === 'dashboard') {
      return pathname === '/dashboard/partner' && (!currentTab || currentTab === 'dashboard')
    }
    // Other items match by their id against the tab query param
    return pathname === '/dashboard/partner' && currentTab === item.id
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
      <aside className="hidden lg:flex flex-col w-56 bg-gradient-to-b from-purple-50/50 via-pink-50/30 to-white dark:from-gray-900 dark:via-purple-900/20 dark:to-gray-800 border-r border-purple-200/50 dark:border-purple-700/50 h-[calc(100vh-4rem)] fixed left-0 top-16 overflow-y-auto">
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
  const regularItems = sidebarItems.filter(item => !item.vip)
  const vipItems = sidebarItems.filter(item => item.vip)

  return (
    <div className="flex flex-col h-full">
      {/* Logo/Header - Compact */}
      <div className="p-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 via-pink-500 to-purple-600 flex items-center justify-center">
            <Crown className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-sm text-gray-900 dark:text-white">Partner</span>
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
        {regularItems.map((item) => {
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
                  ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-md shadow-purple-500/30'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {active && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute inset-0 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg"
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

        {/* VIP Section Separator */}
        {vipItems.length > 0 && (
          <>
            <div className="my-4 px-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
                <Sparkles className="w-3 h-3" />
                <span>VIP Features</span>
              </div>
            </div>
            {vipItems.map((item) => {
              const active = isActive(item)
              const Icon = item.icon
              
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={onClose}
                  onMouseEnter={() => setHoveredItem(item.id)}
                  onMouseLeave={() => setHoveredItem(null)}
                  className={`relative flex items-center space-x-2 px-3 py-2 rounded-lg transition-all duration-200 group border border-purple-200/50 dark:border-purple-700/50 ${
                    active
                      ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-md shadow-purple-500/30'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:border-purple-300 dark:hover:border-purple-600'
                  }`}
                >
                  {active && (
                    <motion.div
                      layoutId="activeTabVip"
                      className="absolute inset-0 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg"
                      initial={false}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    />
                  )}
                  <div className={`relative z-10 ${active ? 'text-white' : 'text-purple-600 dark:text-purple-400'}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className={`relative z-10 font-medium text-sm ${active ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                    {item.label}
                  </span>
                  <div className={`relative z-10 ml-auto ${active ? 'text-white' : 'text-purple-500'}`}>
                    <Crown className="w-3 h-3" />
                  </div>
                </Link>
              )
            })}
          </>
        )}
      </nav>
    </div>
  )
}

