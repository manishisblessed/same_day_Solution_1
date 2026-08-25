/**
 * Transactional email via Resend (REST API — no SDK dependency).
 *
 * Used for onboarding invite links, email OTP, and upline-approval
 * notifications. Falls back to a no-op MOCK (logs to console) when
 * RESEND_API_KEY is absent so flows remain testable without secrets.
 */

import { getEnv } from '@/lib/env'

export interface SendEmailArgs {
  to: string | string[]
  subject: string
  html: string
  from?: string
  replyTo?: string
}

export interface SendEmailResult {
  ok: boolean
  id?: string
  provider: 'resend' | 'mock'
  error?: string
}

function getFrom(explicit?: string): string {
  return (
    explicit ||
    getEnv('EMAIL_FROM') ||
    'Same Day Solution <onboarding@samedaysolution.in>'
  )
}

export function isEmailConfigured(): boolean {
  return !!getEnv('RESEND_API_KEY')
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const apiKey = getEnv('RESEND_API_KEY')

  if (!apiKey) {
    console.warn(
      `[email:mock] to=${Array.isArray(args.to) ? args.to.join(',') : args.to} subject="${args.subject}"`
    )
    return { ok: true, provider: 'mock' }
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: getFrom(args.from),
        to: Array.isArray(args.to) ? args.to : [args.to],
        subject: args.subject,
        html: args.html,
        reply_to: args.replyTo,
      }),
    })

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error('[email:resend] failed', res.status, data)
      return { ok: false, provider: 'resend', error: data?.message || `HTTP ${res.status}` }
    }
    return { ok: true, provider: 'resend', id: data?.id }
  } catch (err: any) {
    console.error('[email:resend] exception', err?.message)
    return { ok: false, provider: 'resend', error: err?.message }
  }
}
