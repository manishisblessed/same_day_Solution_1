'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ServiceTransactionReportRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/dashboard/retailer?tab=reports')
  }, [router])
  return null
}
