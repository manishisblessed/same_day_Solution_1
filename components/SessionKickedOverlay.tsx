'use client'

import { useAuth } from '@/contexts/AuthContext'
import { Monitor, LogOut } from 'lucide-react'

interface Props {
  loginPath?: string
}

export default function SessionKickedOverlay({ loginPath = '/business-login' }: Props) {
  const { sessionKicked } = useAuth()

  if (!sessionKicked) return null

  const handleRedirect = () => {
    window.location.href = `${loginPath}?reason=replaced`
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
        <div className="bg-gradient-to-r from-red-500 to-rose-600 p-6 text-white">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm">
              <Monitor className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Session Ended</h2>
              <p className="text-red-100 text-sm">Signed in from another device</p>
            </div>
          </div>
        </div>

        <div className="p-6 text-center">
          <p className="text-gray-600 mb-2">
            Your account was signed in from another location or device.
          </p>
          <p className="text-sm text-gray-500 mb-6">
            For security, only one active session is allowed at a time. If this wasn&apos;t you, please change your password immediately.
          </p>
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
