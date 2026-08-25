'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  FileBarChart,
  Scale,
  ScrollText,
  PanelLeftClose,
  PanelLeft,
  Timer,
  Settings,
} from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { financeHasTab } from '@/lib/auth-roles'

const items = [
  { href: '/finance-same', label: 'Home', icon: LayoutDashboard, exact: true, tab: 'home' },
  { href: '/finance-same/reconciliation', label: 'Reconciliation', icon: Scale, tab: 'reconciliation' },
  { href: '/finance-same/reports', label: 'Service reports', icon: FileBarChart, tab: 'reports' },
  { href: '/finance-same/settlement', label: 'T+1 settlement', icon: Timer, tab: 'settlement' },
  { href: '/finance-same/wallet-ledger', label: 'Wallet ledger', icon: ScrollText, tab: 'wallet-ledger' },
  { href: '/finance-same/settings', label: 'Settings', icon: Settings, tab: 'settings' },
]

export default function FinanceSidebar() {
  const pathname = usePathname()
  const { user } = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  const visibleItems = items.filter((item) => financeHasTab(user, item.tab))

  const active = (href: string, exact?: boolean) => {
    if (exact) return pathname === href
    return pathname === href || pathname?.startsWith(href + '/')
  }

  return (
    <aside
      className={`hidden md:flex flex-col border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 transition-[width] duration-200 ${
        collapsed ? 'w-[72px]' : 'w-56'
      }`}
    >
      <div className="p-2 flex justify-end">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <PanelLeft className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>
      <nav className="flex-1 px-2 pb-4 space-y-1">
        {visibleItems.map(({ href, label, icon: Icon, exact }) => (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              active(href, exact)
                ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
            title={collapsed ? label : undefined}
          >
            <Icon className="w-5 h-5 shrink-0" />
            {!collapsed && <span>{label}</span>}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
