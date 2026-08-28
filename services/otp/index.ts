/**
 * OTP provider for the onboarding wizard.
 *
 * - SMS: Twilio Verify (stateless — Twilio stores/validates the code).
 * - EMAIL: 6-digit code emailed via Resend; hash persisted in onboarding_otps.
 *
 * Falls back to MOCK mode (fixed code 123456) when the relevant provider
 * credentials are absent, so the flow is testable end-to-end without secrets.
 */

import crypto from 'crypto'
import { getEnv } from '@/lib/env'
import { sendEmail, isEmailConfigured } from '@/services/email'
import { renderOtpEmail } from '@/lib/email/templates'

export type OtpChannel = 'SMS' | 'EMAIL'

export const MOCK_OTP_CODE = '123456'

export function isTwilioConfigured(): boolean {
  return !!(
    getEnv('TWILIO_ACCOUNT_SID') &&
    getEnv('TWILIO_AUTH_TOKEN') &&
    getEnv('TWILIO_VERIFY_SERVICE_SID')
  )
}

export function isResendConfigured(): boolean {
  return !!getEnv('RESEND_API_KEY')
}

export function hashOtp(code: string): string {
  const secret = getEnv('NEXTAUTH_SECRET') || getEnv('JWT_SECRET') || 'onboarding-otp-salt'
  return crypto.createHmac('sha256', secret).update(code).digest('hex')
}

export function generateOtpCode(): string {
  // 6-digit numeric, no leading-zero bias issues for display.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

// ── Twilio Verify (SMS) ─────────────────────────────────────────────────────

function twilioBasicAuth(): string {
  const sid = getEnv('TWILIO_ACCOUNT_SID') || ''
  const token = getEnv('TWILIO_AUTH_TOKEN') || ''
  return Buffer.from(`${sid}:${token}`).toString('base64')
}

function normalizePhone(phone: string): string {
  const trimmed = phone.trim().replace(/[\s-]/g, '')
  if (trimmed.startsWith('+')) return trimmed
  // Default to India (+91) for 10-digit local numbers.
  if (/^\d{10}$/.test(trimmed)) return `+91${trimmed}`
  return `+${trimmed}`
}

async function twilioStartVerification(phone: string): Promise<{ ok: boolean; error?: string }> {
  const serviceSid = getEnv('TWILIO_VERIFY_SERVICE_SID') as string
  const url = `https://verify.twilio.com/v2/Services/${serviceSid}/Verifications`
  const body = new URLSearchParams({ To: normalizePhone(phone), Channel: 'sms' })
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${twilioBasicAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, error: `Twilio start failed (${res.status}): ${text.slice(0, 200)}` }
  }
  return { ok: true }
}

async function twilioCheckVerification(
  phone: string,
  code: string
): Promise<{ ok: boolean; error?: string }> {
  const serviceSid = getEnv('TWILIO_VERIFY_SERVICE_SID') as string
  const url = `https://verify.twilio.com/v2/Services/${serviceSid}/VerificationCheck`
  const body = new URLSearchParams({ To: normalizePhone(phone), Code: code })
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${twilioBasicAuth()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    return { ok: false, error: `Twilio check failed (${res.status})` }
  }
  return { ok: data.status === 'approved' }
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface OtpSendResult {
  ok: boolean
  provider: 'twilio' | 'resend' | 'mock'
  /** Present only for EMAIL: the generated code (caller persists its hash). */
  emailCode?: string
  error?: string
}

/**
 * Trigger an OTP for the given channel/destination.
 * For EMAIL the caller must persist the returned code hash (channel === EMAIL).
 */
export async function sendOtp(
  channel: OtpChannel,
  destination: string,
  context: { name?: string } = {}
): Promise<OtpSendResult> {
  if (channel === 'SMS') {
    if (!isTwilioConfigured()) {
      console.warn('[otp] Twilio not configured — MOCK SMS OTP (123456)')
      return { ok: true, provider: 'mock' }
    }
    const r = await twilioStartVerification(destination)
    return { ok: r.ok, provider: 'twilio', error: r.error }
  }

  // EMAIL
  const code = generateOtpCode()
  if (!isEmailConfigured()) {
    console.warn('[otp] No email provider (Resend/SMTP) configured — MOCK EMAIL OTP (123456)')
    return { ok: true, provider: 'mock', emailCode: MOCK_OTP_CODE }
  }
  const sent = await sendEmail({
    to: destination,
    subject: 'Your Same Day Solution verification code',
    html: renderOtpEmail({ code, name: context.name }),
  })
  return { ok: sent.ok, provider: 'resend', emailCode: code, error: sent.error }
}

/**
 * Verify an OTP.
 * - SMS with Twilio: delegated to Twilio VerificationCheck (expectedHash ignored).
 * - Otherwise: compare hash of submitted code with the stored hash.
 */
export async function verifyOtp(
  channel: OtpChannel,
  destination: string,
  code: string,
  expectedHash?: string | null
): Promise<{ ok: boolean; error?: string }> {
  if (channel === 'SMS' && isTwilioConfigured()) {
    return twilioCheckVerification(destination, code)
  }
  // Mock or email/hash comparison.
  if (!expectedHash) {
    // Mock SMS path: accept the fixed mock code.
    if (channel === 'SMS') return { ok: code === MOCK_OTP_CODE }
    return { ok: false, error: 'No pending OTP' }
  }
  return { ok: hashOtp(code) === expectedHash }
}
