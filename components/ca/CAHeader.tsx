'use client'

import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { LogOut, Calculator } from 'lucide-react'
import Image from 'next/image'

export default function CAHeader() {
  const { user, logout } = useAuth()
  const router = useRouter()

  const handleLogout = async () => {
    try {
      await logout()
    } catch (e) {
      console.error(e)
    } finally {
      window.location.href = '/ca/login'
    }
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-gray-900 dark:bg-gray-950 border-b border-gray-800 shadow-lg">
      <div className="mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
        <button
          type="button"
          onClick={() => router.push('/ca/billing')}
          className="flex items-center gap-3 hover:opacity-90"
        >
          <Image
            src="/images/logo-icon.png"
            alt="Logo"
            width={36}
            height={36}
            className="rounded-lg"
            onError={(e) => {
              const target = e.currentTarget as HTMLImageElement
              target.style.display = 'none'
              const fallback = target.nextElementSibling as HTMLElement
              if (fallback) fallback.style.display = 'flex'
            }}
          />
          <div
            className="hidden items-center justify-center p-2 rounded-lg bg-violet-600 text-white"
          >
            <Calculator className="w-5 h-5" />
          </div>
          <div className="text-left">
            <div className="font-semibold text-white text-base leading-tight">CA Billing</div>
            <div className="text-[11px] text-gray-400 leading-tight">Same Day Solution</div>
          </div>
        </button>

        <div className="flex items-center gap-4">
          <div className="hidden sm:flex flex-col items-end">
            <span className="text-sm font-medium text-white max-w-[200px] truncate">
              {user?.name || user?.email}
            </span>
            <span className="text-[11px] text-gray-400">CA Executive</span>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-600 hover:bg-gray-800 text-gray-300 hover:text-white transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </div>
    </header>
  )
}
