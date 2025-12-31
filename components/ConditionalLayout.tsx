'use client'

import { usePathname } from 'next/navigation'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import WhatsAppChat from '@/components/WhatsAppChat'

export default function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isAdminRoute = pathname?.startsWith('/admin')
  const isDashboardRoute = pathname?.startsWith('/dashboard')
  const shouldShowLayout = !isAdminRoute && !isDashboardRoute

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

