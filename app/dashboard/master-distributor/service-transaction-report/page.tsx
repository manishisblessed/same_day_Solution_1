'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ServiceTransactionReportRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/dashboard/master-distributor?tab=reports')
  }, [router])
  return null
}
