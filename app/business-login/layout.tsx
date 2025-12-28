import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Business Login - Partner Portal | Same Day Solution',
  description: 'Login to your partner dashboard. Access for retailers, distributors, and master distributors.',
}

export default function BusinessLoginLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}

