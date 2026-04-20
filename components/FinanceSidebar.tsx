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
} from 'lucide-react'
import { useState } from 'react'

const items = [
  { href: '/finance-same', label: 'Home', icon: LayoutDashboard, exact: true },
  { href: '/finance-same/reconciliation', label: 'Reconciliation', icon: Scale },
  { href: '/finance-same/reports', label: 'Service reports', icon: FileBarChart },
  { href: '/finance-same/settlement', label: 'T+1 settlement', icon: Timer },
  { href: '/finance-same/wallet-ledger', label: 'Wallet ledger', icon: ScrollText },
]

export default function FinanceSidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

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
        {items.map(({ href, label, icon: Icon, exact }) => (
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
