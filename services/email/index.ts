/**
 * Transactional email for onboarding (invite links, email OTP, upline
 * approvals).
 *
 * Provider order:
 *   1. Resend (RESEND_API_KEY) — preferred, domain must be verified.
 *   2. SMTP via nodemailer (SMTP_HOST/SMTP_USER/SMTP_PASSWORD) — same
 *      GoDaddy/Titan mailbox the contact form uses.
 *   3. MOCK (console log) when neither is configured, so flows remain
 *      testable without secrets.
 */

import nodemailer from 'nodemailer'
import type SMTPTransport from 'nodemailer/lib/smtp-transport'
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
  provider: 'resend' | 'smtp' | 'mock'
  error?: string
}

function getFrom(explicit?: string): string {
  return (
    explicit ||
    getEnv('EMAIL_FROM') ||
    getEnv('SMTP_FROM') ||
    'Same Day Solution <onboarding@samedaysolution.in>'
  )
}

function isSmtpConfigured(): boolean {
  return !!(getEnv('SMTP_HOST') && getEnv('SMTP_USER') && getEnv('SMTP_PASSWORD'))
}

export function isEmailConfigured(): boolean {
  return !!getEnv('RESEND_API_KEY') || isSmtpConfigured()
}

async function sendViaResend(args: SendEmailArgs, apiKey: string): Promise<SendEmailResult> {
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

async function sendViaSmtp(args: SendEmailArgs): Promise<SendEmailResult> {
  try {
    const port = parseInt(getEnv('SMTP_PORT') || '465', 10)
    const transporter = nodemailer.createTransport({
      host: getEnv('SMTP_HOST'),
      port,
      secure: getEnv('SMTP_SECURE') === 'true' || (getEnv('SMTP_SECURE') === undefined && port === 465),
      auth: { user: getEnv('SMTP_USER'), pass: getEnv('SMTP_PASSWORD') },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 10000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      pool: false,
    } as SMTPTransport.Options)

    const info = await transporter.sendMail({
      from: getFrom(args.from),
      to: Array.isArray(args.to) ? args.to.join(', ') : args.to,
      subject: args.subject,
      html: args.html,
      replyTo: args.replyTo,
    })
    return { ok: true, provider: 'smtp', id: info.messageId }
  } catch (err: any) {
    console.error('[email:smtp] exception', err?.message)
    return { ok: false, provider: 'smtp', error: err?.message }
  }
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const apiKey = getEnv('RESEND_API_KEY')

  if (apiKey) {
    const result = await sendViaResend(args, apiKey)
    // Resend rejected (bad key / unverified domain)? Try SMTP before failing.
    if (!result.ok && isSmtpConfigured()) {
      console.warn('[email] Resend failed, falling back to SMTP:', result.error)
      return sendViaSmtp(args)
    }
    return result
  }

  if (isSmtpConfigured()) {
    return sendViaSmtp(args)
  }

  console.warn(
    `[email:mock] to=${Array.isArray(args.to) ? args.to.join(',') : args.to} subject="${args.subject}"`
  )
  return { ok: true, provider: 'mock' }
}
