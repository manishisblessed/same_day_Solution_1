'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ServiceTransactionReportRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/dashboard/distributor?tab=reports')
  }, [router])
  return null
}
