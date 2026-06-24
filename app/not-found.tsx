import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="max-w-md w-full text-center">
        <h1 className="text-6xl font-bold text-gray-900 dark:text-white">404</h1>
        <p className="text-lg text-gray-600 dark:text-gray-400 mt-2">
          This page could not be found.
        </p>
        <Link
          href="/"
          className="inline-block mt-6 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          Go back home
        </Link>
      </div>
    </div>
  )
}
