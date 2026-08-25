'use client'

import { useEffect } from 'react'
import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { financeHasTab } from '@/lib/auth-roles'
import { useRouter } from 'next/navigation'
import ServiceTransactionReport from '@/components/ServiceTransactionReport'
import PosReconciliationReport from '@/components/reports/PosReconciliationReport'
import { Loader2 } from 'lucide-react'

export default function FinanceReconciliationPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [view, setView] = useState<'pos' | 'service'>('pos')

  useEffect(() => {
    if (!loading && (!user || user.role !== 'finance_executive')) {
      router.push('/finance-same/login')
    } else if (!loading && user && !financeHasTab(user, 'reconciliation')) {
      router.push('/finance-same')
    }
  }, [user, loading, router])

  if (loading || !user || user.role !== 'finance_executive' || !financeHasTab(user, 'reconciliation')) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Reconciliation</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Auto-computed POS card reconciliation (MDR, charges &amp; net pay) plus multi-service settlement filters.
        </p>
      </div>

      <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-1">
        <button
          type="button"
          onClick={() => setView('pos')}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
            view === 'pos'
              ? 'bg-emerald-600 text-white'
              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
        >
          POS card reconciliation
        </button>
        <button
          type="button"
          onClick={() => setView('service')}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
            view === 'service'
              ? 'bg-emerald-600 text-white'
              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
          }`}
        >
          Service transactions
        </button>
      </div>

      {view === 'pos' ? (
        <PosReconciliationReport />
      ) : (
        <ServiceTransactionReport userRole="finance_executive" userName={user.name || user.email} />
      )}
    </div>
  )
}
