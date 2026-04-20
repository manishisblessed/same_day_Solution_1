'use client'

import { useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import AdminWalletLedgerTab from '@/components/AdminWalletLedgerTab'
import { Loader2 } from 'lucide-react'

export default function FinanceWalletLedgerPage() {
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
      <h1 className="text-xl font-bold text-gray-900 dark:text-white">Wallet ledger</h1>
      <AdminWalletLedgerTab />
    </div>
  )
}
