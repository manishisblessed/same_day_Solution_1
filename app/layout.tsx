import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import WhatsAppChat from '@/components/WhatsAppChat'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  metadataBase: new URL('https://samedaysolution.in'),
  title: 'Same Day Solution Pvt. Ltd. - Fast. Secure. Same-Day Fintech Solutions',
  description: 'Leading fintech solutions provider offering digital payments, lending solutions, merchant services, and secure financial technology services.',
  keywords: 'fintech, digital payments, lending solutions, merchant services, KYC, financial technology',
  openGraph: {
    url: 'https://samedaysolution.in',
    siteName: 'Same Day Solution Pvt. Ltd.',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Header />
        <main className="min-h-screen bg-white">
          {children}
        </main>
        <Footer />
        <WhatsAppChat />
      </body>
    </html>
  )
}

