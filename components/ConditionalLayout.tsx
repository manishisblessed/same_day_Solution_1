'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import WhatsAppChat from '@/components/WhatsAppChat'

export default function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const isAdminRoute = pathname?.startsWith('/admin')
  const isDashboardRoute = pathname?.startsWith('/dashboard')
  const shouldShowLayout = mounted && !isAdminRoute && !isDashboardRoute

  return (
    <>
      {shouldShowLayout && <Header />}
      <main className="min-h-screen bg-white">
        {children}
      </main>
      {shouldShowLayout && <Footer />}
      {shouldShowLayout && <WhatsAppChat />}
    </>
  )
}

