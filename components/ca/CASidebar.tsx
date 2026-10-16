'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Landmark,
  Receipt,
  FileText,
  Building2,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react'
import { useState } from 'react'
import { motion } from 'framer-motion'

const items = [
  { href: '/ca/billing', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/ca/billing/company', label: 'Company Details', icon: Building2 },
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
      className={`hidden md:flex flex-col border-r border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm transition-[width] duration-200 ${
        collapsed ? 'w-[72px]' : 'w-56'
      }`}
    >
      <div className="p-2 flex justify-end">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="p-2 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-900/30 text-gray-500 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <PanelLeft className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>
      <nav className="flex-1 px-2 pb-4 space-y-1">
        {items.map(({ href, label, icon: Icon, exact }) => {
          const active = isActive(href, exact)
          return (
            <Link
              key={href}
              href={href}
              className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all group ${
                active
                  ? 'bg-gradient-to-r from-violet-500/15 to-fuchsia-500/10 text-violet-800 dark:text-violet-200'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800/70 hover:text-violet-700 dark:hover:text-violet-300'
              }`}
              title={collapsed ? label : undefined}
            >
              {active && (
                <motion.span
                  layoutId="ca-active-pill"
                  className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r bg-gradient-to-b from-violet-500 to-fuchsia-500"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              <Icon
                className={`w-5 h-5 shrink-0 transition-transform group-hover:scale-110 ${
                  active ? 'text-violet-600 dark:text-violet-300' : ''
                }`}
              />
              {!collapsed && <span>{label}</span>}
            </Link>
          )
        })}
      </nav>

      {!collapsed && (
        <div className="m-3 p-3 rounded-xl bg-gradient-to-br from-violet-500/10 via-fuchsia-500/10 to-pink-500/10 border border-violet-200/60 dark:border-violet-800/40">
          <p className="text-[11px] font-semibold text-violet-800 dark:text-violet-300 uppercase tracking-wider">
            CA Workspace
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 leading-snug">
            Reimbursements, MDR &amp; GST invoices in one place.
          </p>
        </div>
      )}
    </aside>
  )
}
