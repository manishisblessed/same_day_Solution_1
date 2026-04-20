'use client'

import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { LogOut, IndianRupee } from 'lucide-react'

export default function FinanceHeader() {
  const { user, logout } = useAuth()
  const router = useRouter()

  const handleLogout = async () => {
    try {
      await logout()
    } catch (e) {
      console.error(e)
    } finally {
      window.location.href = '/finance-same/login'
    }
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-white/95 dark:bg-gray-900/95 border-b border-gray-200/50 dark:border-gray-700/50 shadow-sm">
      <div className="mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
        <button
          type="button"
          onClick={() => router.push('/finance-same')}
          className="flex items-center gap-2 hover:opacity-90"
        >
          <div className="p-2 rounded-lg bg-emerald-600 text-white">
            <IndianRupee className="w-5 h-5" />
          </div>
          <div className="text-left">
            <div className="font-semibold text-gray-900 dark:text-white">Finance</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">Same Day Solution</div>
          </div>
        </button>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600 dark:text-gray-300 hidden sm:inline max-w-[200px] truncate">
            {user?.name || user?.email}
          </span>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </div>
    </header>
  )
}
