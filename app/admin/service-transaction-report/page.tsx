'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ServiceTransactionReportRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/admin?tab=service-transaction-report')
  }, [router])
  return null
}
