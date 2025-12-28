import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Contact Us - Same Day Solution Pvt. Ltd.',
  description: 'Get in touch with Same Day Solution Pvt. Ltd. for fintech solutions and support.',
}

export default function ContactLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}

