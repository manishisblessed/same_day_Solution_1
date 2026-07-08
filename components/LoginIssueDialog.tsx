'use client'

import { AlertTriangle, Loader2 } from 'lucide-react'

interface LoginIssueDialogProps {
  issues: string[]
  signingIn: boolean
  onDismiss: () => void
}

/**
 * Non-blocking popup shown when there are login issues (location denied,
 * CAPTCHA incomplete, etc). Login proceeds in the background while this
 * dialog is visible — it only informs the user and asks for acknowledgement.
 */
export default function LoginIssueDialog({ issues, signingIn, onDismiss }: LoginIssueDialogProps) {
  if (issues.length === 0) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onDismiss} />
      <div className="relative bg-white rounded-xl shadow-2xl max-w-sm w-full p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 mb-1">Heads up</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              {issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          </div>
        </div>

        {signingIn && (
          <div className="flex items-center gap-2 text-sm text-primary-700 bg-primary-50 rounded-lg px-3 py-2 mb-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Signing you in anyway...</span>
          </div>
        )}

        <button onClick={onDismiss} className="w-full btn-primary">
          OK, continue
        </button>
      </div>
    </div>
  )
}
