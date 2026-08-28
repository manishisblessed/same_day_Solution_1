/**
 * Generic transactional SMS via Twilio Messaging API (not Verify — that only
 * sends OTP codes). Used to send onboarding invite links over SMS.
 *
 * Requires the shared Twilio account creds plus a sender:
 *   - TWILIO_ACCOUNT_SID
 *   - TWILIO_AUTH_TOKEN
 *   - one of: TWILIO_MESSAGING_SERVICE_SID  (preferred)  |  TWILIO_SMS_FROM  (E.164 number)
 *
 * When no sender is configured it falls back to a no-op MOCK (logs to console)
 * so the invite flow never breaks — email still goes out regardless.
 */

import { getEnv } from '@/lib/env'

export interface SendSmsResult {
  ok: boolean
  provider: 'twilio' | 'mock'
  sid?: string
  error?: string
}

export function isSmsConfigured(): boolean {
  return !!(
    getEnv('TWILIO_ACCOUNT_SID') &&
    getEnv('TWILIO_AUTH_TOKEN') &&
    (getEnv('TWILIO_MESSAGING_SERVICE_SID') || getEnv('TWILIO_SMS_FROM'))
  )
}

function twilioBasicAuth(): string {
  const sid = getEnv('TWILIO_ACCOUNT_SID') || ''
  const token = getEnv('TWILIO_AUTH_TOKEN') || ''
  return Buffer.from(`${sid}:${token}`).toString('base64')
}

/** Normalize to E.164, defaulting bare 10-digit numbers to India (+91). */
export function normalizePhone(phone: string): string {
  const trimmed = String(phone || '').trim().replace(/[\s-]/g, '')
  if (trimmed.startsWith('+')) return trimmed
  if (/^\d{10}$/.test(trimmed)) return `+91${trimmed}`
  if (/^91\d{10}$/.test(trimmed)) return `+${trimmed}`
  return `+${trimmed}`
}

export async function sendSms(args: { to: string; body: string }): Promise<SendSmsResult> {
  if (!isSmsConfigured()) {
    console.warn(`[sms:mock] to=${args.to} body="${args.body.slice(0, 60)}…"`)
    return { ok: true, provider: 'mock' }
  }

  const accountSid = getEnv('TWILIO_ACCOUNT_SID') as string
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`

  const form = new URLSearchParams({ To: normalizePhone(args.to), Body: args.body })
  const messagingServiceSid = getEnv('TWILIO_MESSAGING_SERVICE_SID')
  if (messagingServiceSid) {
    form.set('MessagingServiceSid', messagingServiceSid)
  } else {
    form.set('From', getEnv('TWILIO_SMS_FROM') as string)
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${twilioBasicAuth()}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.error('[sms:twilio] failed', res.status, data)
      return { ok: false, provider: 'twilio', error: data?.message || `HTTP ${res.status}` }
    }
    return { ok: true, provider: 'twilio', sid: data?.sid }
  } catch (err: any) {
    console.error('[sms:twilio] exception', err?.message)
    return { ok: false, provider: 'twilio', error: err?.message }
  }
}

/** Short SMS body for an onboarding invite. */
export function inviteSmsBody(opts: { inviterName?: string | null; roleLabel: string; link: string }): string {
  const inviter = opts.inviterName ? `${opts.inviterName} has ` : 'You have been '
  return `${inviter}invited you to join Same Day Solution as a ${opts.roleLabel}. Complete your KYC & registration here: ${opts.link}`
}
