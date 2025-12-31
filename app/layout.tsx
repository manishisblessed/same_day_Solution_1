import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import ConditionalLayout from '@/components/ConditionalLayout'
import { AuthProvider } from '@/contexts/AuthContext'

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
        <AuthProvider>
          <ConditionalLayout>
            {children}
          </ConditionalLayout>
        </AuthProvider>
      </body>
    </html>
  )
}

