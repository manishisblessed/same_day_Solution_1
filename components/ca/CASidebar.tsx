'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Landmark,
  Receipt,
  FileText,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react'
import { useState } from 'react'

const items = [
  { href: '/ca/billing', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/ca/billing/bank-mdr', label: 'Bank MDR Rates', icon: Landmark },
  { href: '/ca/billing/reimbursement', label: 'Reimbursement', icon: Receipt },
  { href: '/ca/billing/transaction-invoices', label: 'GST Invoices', icon: FileText },
]

export default function CASidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  const isActive = (href: string, exact?: boolean) => {
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
              isActive(href, exact)
                ? 'bg-violet-50 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300'
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
