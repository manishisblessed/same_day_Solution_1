'use client'

import { useState, useEffect, Suspense } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useRouter } from 'next/navigation'
import AdminSidebar from '@/components/AdminSidebar'
import ServiceTransactionReport from '@/components/ServiceTransactionReport'
import PosReconciliationReport from '@/components/reports/PosReconciliationReport'
import { Scale, Loader2 } from 'lucide-react'

export default function AdminFinanceReconciliationPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary-600" /></div>}>
      <PageContent />
    </Suspense>
  )
}

function PageContent() {
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [view, setView] = useState<'pos' | 'service'>('pos')

  useEffect(() => {
    if (!authLoading && (!user || user.role !== 'admin')) {
      router.push('/admin/login')
    }
  }, [user, authLoading, router])

  if (authLoading || !user || user.role !== 'admin') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
        <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="lg:pl-56 flex items-center justify-center min-h-screen">
          <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900">
      <AdminSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="lg:pl-56">
        <div className="pt-20 p-6 space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
              <Scale className="w-8 h-8 text-primary-600" />
              Reconciliation
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-1">
              Auto-computed POS card reconciliation (MDR, charges &amp; net pay) plus multi-service settlement filters.
            </p>
          </div>

          <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-1">
            <button
              type="button"
              onClick={() => setView('pos')}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                view === 'pos'
                  ? 'bg-primary-600 text-white'
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
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              Service transactions
            </button>
          </div>

          {view === 'pos' ? (
            <PosReconciliationReport />
          ) : (
            <ServiceTransactionReport userRole="admin" userName={user.name || user.email} />
          )}
        </div>
      </div>
    </div>
  )
}
