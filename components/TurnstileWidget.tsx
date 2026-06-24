'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string
      reset: (widgetId?: string) => void
      remove: (widgetId?: string) => void
    }
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

export interface TurnstileHandle {
  reset: () => void
}

interface TurnstileWidgetProps {
  onVerify: (token: string) => void
  onExpire?: () => void
  /** Fired when the widget cannot load/render or hits a challenge error. */
  onError?: () => void
  className?: string
}

/** Public site key (safe to expose). When unset, the widget renders a hint. */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ''

/** True when CAPTCHA is configured for this build. */
export const isCaptchaEnabled = (): boolean => !!TURNSTILE_SITE_KEY

let scriptPromise: Promise<void> | null = null
function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Turnstile failed to load')))
      if (window.turnstile) resolve()
      return
    }
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => {
      // Allow a later retry to re-attempt loading the script.
      scriptPromise = null
      reject(new Error('Turnstile failed to load'))
    }
    document.head.appendChild(s)
  })
  return scriptPromise
}

/**
 * Cloudflare Turnstile widget. Calls onVerify(token) once solved; clears the
 * token via onExpire on expiry. On a load/render/challenge failure it calls
 * onError so the parent can degrade gracefully (the server still enforces the
 * captcha) instead of leaving the submit button permanently disabled.
 *
 * Parent should pass the token to
 * supabase.auth.signInWithPassword({ options: { captchaToken } }) and call
 * ref.reset() after a failed attempt (tokens are single-use).
 */
const TurnstileWidget = forwardRef<TurnstileHandle, TurnstileWidgetProps>(
  function TurnstileWidget({ onVerify, onExpire, onError, className }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const widgetIdRef = useRef<string | null>(null)
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
    const [attempt, setAttempt] = useState(0)

    useImperativeHandle(ref, () => ({
      reset: () => {
        try {
          if (window.turnstile && widgetIdRef.current) {
            window.turnstile.reset(widgetIdRef.current)
          }
        } catch {
          /* no-op */
        }
      },
    }))

    useEffect(() => {
      if (!TURNSTILE_SITE_KEY) return
      let cancelled = false
      setStatus('loading')

      loadTurnstileScript()
        .then(() => {
          if (cancelled || !containerRef.current || !window.turnstile) return
          // Clear any previous render before re-rendering (retry path).
          if (widgetIdRef.current) {
            try {
              window.turnstile.remove(widgetIdRef.current)
            } catch {
              /* no-op */
            }
            widgetIdRef.current = null
          }
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: TURNSTILE_SITE_KEY,
            callback: (token: string) => {
              if (cancelled) return
              setStatus('ready')
              onVerify(token)
            },
            'expired-callback': () => onExpire?.(),
            'error-callback': () => {
              if (cancelled) return
              setStatus('error')
              onError?.()
            },
            'timeout-callback': () => onExpire?.(),
          })
        })
        .catch(() => {
          if (cancelled) return
          setStatus('error')
          onError?.()
        })

      return () => {
        cancelled = true
        try {
          if (window.turnstile && widgetIdRef.current) {
            window.turnstile.remove(widgetIdRef.current)
          }
        } catch {
          /* no-op */
        }
        widgetIdRef.current = null
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [attempt])

    const retry = useCallback(() => setAttempt((n) => n + 1), [])

    if (!TURNSTILE_SITE_KEY) {
      return (
        <div className="text-xs text-amber-600">
          CAPTCHA is not configured (NEXT_PUBLIC_TURNSTILE_SITE_KEY missing).
        </div>
      )
    }

    return (
      <div className={className}>
        <div ref={containerRef} />
        {status === 'error' && (
          <div className="text-xs text-red-600 mt-1">
            Couldn&apos;t load the CAPTCHA.{' '}
            <button type="button" onClick={retry} className="underline font-medium">
              Retry
            </button>
            <span className="block text-[11px] text-gray-500 mt-0.5">
              If this persists, this domain may not be authorized in Cloudflare Turnstile.
            </span>
          </div>
        )}
      </div>
    )
  }
)

export default TurnstileWidget
