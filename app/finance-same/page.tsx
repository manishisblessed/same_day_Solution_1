'use client'

import { useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { FileBarChart, Scale, ScrollText, Timer, Loader2 } from 'lucide-react'

export default function FinanceHomePage() {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && (!user || user.role !== 'finance_executive')) {
      router.push('/finance-same/login')
    }
  }, [user, loading, router])

  if (loading || !user || user.role !== 'finance_executive') {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    )
  }

  const cards = [
    {
      href: '/finance-same/reconciliation',
      title: 'Reconciliation',
      desc: 'Cross-check service transactions and settlement-related activity across services.',
      icon: Scale,
    },
    {
      href: '/finance-same/reports',
      title: 'Service transaction reports',
      desc: 'Filter by date, service, and status; export for analysis.',
      icon: FileBarChart,
    },
    {
      href: '/finance-same/settlement',
      title: 'T+1 settlement',
      desc: 'View cron schedule and per-entity pause status (read-only).',
      icon: Timer,
    },
    {
      href: '/finance-same/wallet-ledger',
      title: 'Wallet ledger',
      desc: 'Platform and user wallet movements for audits.',
      icon: ScrollText,
    },
  ]

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-8 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Finance workspace</h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Signed in as <span className="font-medium">{user.name || user.email}</span>
          {user.phone ? (
            <span className="text-gray-500"> · {user.phone}</span>
          ) : null}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {cards.map(({ href, title, desc, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group p-5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50 hover:border-emerald-300 dark:hover:border-emerald-700 hover:shadow-md transition-all"
          >
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
                <Icon className="w-6 h-6" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-white group-hover:text-emerald-700 dark:group-hover:text-emerald-400">
                  {title}
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{desc}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </motion.div>
  )
}
