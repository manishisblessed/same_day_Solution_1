'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

/**
 * Global error boundary for the application
 * This catches errors that occur during rendering, in lifecycle methods, and in constructors
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const pathname = usePathname()
  const isApiRoute = pathname?.startsWith('/api/')

  useEffect(() => {
    // Log error for debugging
    console.error('Global error boundary caught error:', error)
  }, [error])

  // For API routes, we should never reach here (they should return JSON)
  // But if we do, return a JSON response
  if (isApiRoute) {
    return null // API routes should handle their own errors
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
          Something went wrong!
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          {error.message || 'An unexpected error occurred'}
        </p>
        <button
          onClick={reset}
          className="w-full px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  )
}

