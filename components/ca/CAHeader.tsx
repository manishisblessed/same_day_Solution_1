'use client'

import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { LogOut, Calculator } from 'lucide-react'
import Image from 'next/image'
import { motion } from 'framer-motion'

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
    <header className="fixed top-0 left-0 right-0 z-50 bg-gradient-to-r from-violet-700 via-violet-600 to-fuchsia-600 dark:from-violet-900 dark:via-violet-800 dark:to-fuchsia-900 border-b border-violet-800/40 shadow-[0_4px_20px_-4px_rgba(124,58,237,0.5)]">
      {/* subtle shine overlay */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.15),transparent_60%)]" />

      <div className="relative mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
        <motion.button
          type="button"
          onClick={() => router.push('/ca/billing')}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="flex items-center gap-3 group"
        >
          <div className="relative">
            {/* glow ring */}
            <div className="absolute -inset-0.5 rounded-xl bg-gradient-to-br from-white/40 to-fuchsia-300/30 blur-sm opacity-60 group-hover:opacity-100 transition-opacity" />
            <div className="relative w-10 h-10 rounded-xl bg-white/95 shadow-md ring-1 ring-white/60 overflow-hidden flex items-center justify-center">
              <Image
                src="/LOGO_Same_Day.jpeg"
                alt="Same Day Solution"
                width={40}
                height={40}
                className="object-contain"
                priority
                onError={(e) => {
                  const target = e.currentTarget as HTMLImageElement
                  target.style.display = 'none'
                  const fallback = target.nextElementSibling as HTMLElement
                  if (fallback) fallback.style.display = 'flex'
                }}
              />
              <div className="hidden items-center justify-center w-full h-full bg-violet-600 text-white">
                <Calculator className="w-5 h-5" />
              </div>
            </div>
          </div>
          <div className="text-left">
            <div className="font-semibold text-white text-base leading-tight tracking-tight drop-shadow-sm">
              CA Billing
            </div>
            <div className="text-[11px] text-violet-100/80 leading-tight">
              Same Day Solution
            </div>
          </div>
        </motion.button>

        <div className="flex items-center gap-3 sm:gap-4">
          <div className="hidden sm:flex flex-col items-end">
            <span className="text-sm font-medium text-white max-w-[200px] truncate">
              {user?.name || user?.email}
            </span>
            <span className="text-[11px] text-violet-100/80">CA Executive</span>
          </div>
          <div className="hidden sm:block w-9 h-9 rounded-full bg-white/15 ring-1 ring-white/30 flex items-center justify-center text-white font-semibold text-sm backdrop-blur-sm">
            {(user?.name || user?.email || '?').trim().charAt(0).toUpperCase()}
          </div>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-white/10 hover:bg-white/20 border border-white/25 text-white backdrop-blur-sm transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Logout</span>
          </motion.button>
        </div>
      </div>
    </header>
  )
}
