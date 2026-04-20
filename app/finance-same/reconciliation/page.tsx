'use client'

import { useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import ServiceTransactionReport from '@/components/ServiceTransactionReport'
import { Loader2 } from 'lucide-react'

export default function FinanceReconciliationPage() {
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Reconciliation</h1>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Use service and settlement filters below to reconcile transactions across the network.
        </p>
      </div>
      <ServiceTransactionReport userRole="finance_executive" userName={user.name || user.email} />
    </div>
  )
}
