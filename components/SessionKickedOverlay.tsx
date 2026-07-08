'use client'

import { useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { Monitor, Clock, LogOut } from 'lucide-react'

interface Props {
  loginPath?: string
}

export default function SessionKickedOverlay({ loginPath = '/business-login' }: Props) {
  const { sessionKicked, kickReason } = useAuth()

  const isReplaced = kickReason === 'replaced'
  const query = isReplaced ? 'reason=replaced' : 'session=expired'

  // Auto-redirect to login shortly after showing the message, so the user
  // isn't stranded on a dead dashboard.
  useEffect(() => {
    if (!sessionKicked) return
    const t = setTimeout(() => {
      window.location.href = `${loginPath}?${query}`
    }, 4000)
    return () => clearTimeout(t)
  }, [sessionKicked, loginPath, query])

  if (!sessionKicked) return null

  const handleRedirect = () => {
    window.location.href = `${loginPath}?${query}`
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
        <div className={`bg-gradient-to-r ${isReplaced ? 'from-red-500 to-rose-600' : 'from-amber-500 to-orange-600'} p-6 text-white`}>
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm">
              {isReplaced ? <Monitor className="w-8 h-8" /> : <Clock className="w-8 h-8" />}
            </div>
            <div>
              <h2 className="text-xl font-bold">Session Ended</h2>
              <p className="text-white/90 text-sm">
                {isReplaced ? 'Signed in from another device' : 'Please sign in again to continue'}
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 text-center">
          {isReplaced ? (
            <>
              <p className="text-gray-600 mb-2">
                Your account was signed in from another location or device.
              </p>
              <p className="text-sm text-gray-500 mb-6">
                For security, only one active session is allowed at a time. If this wasn&apos;t you, please change your password immediately.
              </p>
            </>
          ) : (
            <>
              <p className="text-gray-600 mb-2">
                Your session has ended and you&apos;ve been signed out.
              </p>
              <p className="text-sm text-gray-500 mb-6">
                This can happen after a period of inactivity, or if you signed out in another tab. Please sign in again to continue.
              </p>
            </>
          )}
          <button
            onClick={handleRedirect}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-primary-500 to-primary-600 text-white rounded-xl font-semibold hover:shadow-lg transition-all"
          >
            <LogOut className="w-5 h-5" />
            Go to Login
          </button>
        </div>
      </div>
    </div>
  )
}
