'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, FileSignature, ArrowLeft } from 'lucide-react'

export default function EsignCompletePage() {
  const [countdown, setCountdown] = useState(5)

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer)
          // Try to close this tab (works if opened via window.open)
          window.close()
          return 0
        }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-emerald-50 px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
        className="w-full max-w-md rounded-3xl border border-gray-100 bg-white p-8 text-center shadow-xl"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 15, delay: 0.2 }}
          className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100"
        >
          <CheckCircle2 className="h-10 w-10 text-emerald-600" />
        </motion.div>

        <h1 className="mb-2 text-2xl font-bold text-gray-900">Agreement Signed!</h1>
        <p className="mb-6 text-sm text-gray-500">
          Your partner agreement has been digitally signed successfully.
          You can now close this tab and continue with your onboarding.
        </p>

        <div className="mb-6 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
          <div className="flex items-center justify-center gap-2 text-sm text-emerald-700">
            <FileSignature className="h-4 w-4" />
            <span>Signed &amp; verified via Leegality</span>
          </div>
        </div>

        {countdown > 0 ? (
          <p className="text-xs text-gray-400">
            This window will close automatically in {countdown}s…
          </p>
        ) : (
          <button
            onClick={() => window.close()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-700"
          >
            <ArrowLeft className="h-4 w-4" /> Return to Onboarding
          </button>
        )}
      </motion.div>
    </div>
  )
}
