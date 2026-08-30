/**
 * Email-client-safe HTML templates (inline styles, table layout) for
 * onboarding invites, resend links and OTP codes. Renders consistently in
 * Gmail / Outlook / Apple Mail.
 */

const BRAND = '#4F46E5'
const BRAND_DARK = '#4338CA'
const INK = '#111827'
const MUTED = '#6B7280'
const BG = '#EEF2FF'
const CARD = '#FFFFFF'
const SUPPORT_EMAIL = 'support@samedaysolution.in'

function shell(previewText: string, innerHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light only" />
<title>Same Day Solution</title>
</head>
<body style="margin:0;padding:0;background:${BG};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${previewText}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
      <!-- Header -->
      <tr><td style="padding:4px 4px 18px;">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td style="width:40px;height:40px;background:${BRAND};border-radius:10px;text-align:center;vertical-align:middle;color:#fff;font-family:Arial,Helvetica,sans-serif;font-weight:bold;font-size:13px;">SDS</td>
            <td style="padding-left:12px;font-family:Arial,Helvetica,sans-serif;">
              <div style="font-size:16px;font-weight:bold;color:${INK};">Same Day Solution</div>
              <div style="font-size:12px;color:${MUTED};">Partner Onboarding</div>
            </td>
          </tr>
        </table>
      </td></tr>
      <!-- Card -->
      <tr><td style="background:${CARD};border-radius:16px;padding:32px;box-shadow:0 6px 24px rgba(79,70,229,0.08);font-family:Arial,Helvetica,sans-serif;">
        ${innerHtml}
      </td></tr>
      <!-- Footer -->
      <tr><td style="padding:20px 8px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
        <div style="font-size:12px;color:${MUTED};line-height:1.6;">
          Need help? Write to <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND};text-decoration:none;">${SUPPORT_EMAIL}</a><br/>
          &copy; ${new Date().getFullYear()} Same Day Solution Pvt. Ltd. All rights reserved.
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
}

function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr>
    <td style="border-radius:10px;background:${BRAND};background-image:linear-gradient(135deg,${BRAND},${BRAND_DARK});">
      <a href="${url}" target="_blank"
         style="display:inline-block;padding:13px 30px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px;">
        ${label}
      </a>
    </td>
  </tr></table>`
}

export interface BrandedEmailOptions {
  previewText?: string
  heading: string
  /** Paragraph(s) of body copy; may include inline HTML. */
  intro: string
  bullets?: string[]
  ctaLabel?: string
  ctaUrl?: string
  /** Small note under the CTA, e.g. the raw link or an expiry line. */
  secondaryNote?: string
}

export function renderBrandedEmail(opts: BrandedEmailOptions): string {
  const bulletsHtml = opts.bullets?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;">${opts.bullets
        .map(
          (b) =>
            `<tr><td style="padding:4px 0;font-size:14px;color:${INK};">
              <span style="display:inline-block;width:18px;color:${BRAND};font-weight:bold;">&#10003;</span>${b}
            </td></tr>`
        )
        .join('')}</table>`
    : ''

  const inner = `
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:bold;color:${INK};">${opts.heading}</h1>
    <p style="margin:0;font-size:14px;line-height:1.65;color:${MUTED};">${opts.intro}</p>
    ${bulletsHtml}
    ${opts.ctaLabel && opts.ctaUrl ? button(opts.ctaLabel, opts.ctaUrl) : ''}
    ${
      opts.secondaryNote
        ? `<p style="margin:8px 0 0;font-size:12px;line-height:1.6;color:${MUTED};">${opts.secondaryNote}</p>`
        : ''
    }`

  return shell(opts.previewText || opts.heading, inner)
}

export function renderInviteEmail(opts: {
  name?: string | null
  inviterName?: string | null
  roleLabel: string
  link: string
  expiresOn: string
}): string {
  return renderBrandedEmail({
    previewText: `Complete your ${opts.roleLabel} onboarding with Same Day Solution`,
    heading: `You're invited to join as a ${opts.roleLabel}`,
    intro: `Hi${opts.name ? ` <strong style="color:${INK};">${opts.name}</strong>` : ''}, ${
      opts.inviterName || 'your upline'
    } has invited you to onboard as a <strong style="color:${INK};">${opts.roleLabel}</strong> on Same Day Solution. Complete your KYC and registration in a few quick steps:`,
    bullets: [
      'Verify mobile &amp; email',
      'Complete PAN, Aadhaar &amp; bank KYC',
      'Capture a live selfie &amp; short video',
      'Upload documents &amp; sign the declaration',
    ],
    ctaLabel: 'Start Onboarding',
    ctaUrl: opts.link,
    secondaryNote: `Or copy this link: <a href="${opts.link}" style="color:${BRAND};word-break:break-all;">${opts.link}</a><br/><br/>This link expires on <strong>${opts.expiresOn}</strong>. Please don't share it — it's unique to you.`,
  })
}

export function renderApprovalEmail(opts: {
  name?: string | null
  roleLabel: string
  partnerId?: string | null
  loginUrl: string
}): string {
  return renderBrandedEmail({
    previewText: `Your ${opts.roleLabel} account has been approved`,
    heading: `Welcome aboard! Your account is approved 🎉`,
    intro: `Hi${opts.name ? ` <strong style="color:${INK};">${opts.name}</strong>` : ''}, great news — your KYC has been verified and your <strong style="color:${INK};">${opts.roleLabel}</strong> account with Same Day Solution is now <strong style="color:${INK};">active</strong>. You can log in and start transacting right away.`,
    bullets: [
      ...(opts.partnerId ? [`Your Partner ID: <strong style="color:${INK};">${opts.partnerId}</strong>`] : []),
      'Log in with your registered email &amp; password',
      'Set up services and start using your dashboard',
    ],
    ctaLabel: 'Log in to your account',
    ctaUrl: opts.loginUrl,
    secondaryNote: `Or open: <a href="${opts.loginUrl}" style="color:${BRAND};word-break:break-all;">${opts.loginUrl}</a>`,
  })
}

export function renderResubmitEmail(opts: {
  name?: string | null
  roleLabel: string
  link: string
  expiresOn: string
  items: { label: string; reason: string }[]
}): string {
  const itemsHtml = opts.items.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:14px 0 6px;border-collapse:separate;border-spacing:0 8px;">${opts.items
        .map(
          (it) =>
            `<tr><td style="background:${BG};border-radius:10px;padding:12px 14px;font-family:Arial,Helvetica,sans-serif;">
              <div style="font-size:14px;font-weight:bold;color:${INK};">${it.label}</div>
              <div style="font-size:13px;color:${MUTED};margin-top:2px;"><span style="color:#B45309;font-weight:bold;">Reason:</span> ${it.reason}</div>
            </td></tr>`
        )
        .join('')}</table>`
    : ''

  const inner = `
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:bold;color:${INK};">Action needed: re-submit a few details</h1>
    <p style="margin:0;font-size:14px;line-height:1.65;color:${MUTED};">
      Hi${opts.name ? ` <strong style="color:${INK};">${opts.name}</strong>` : ''}, thanks for completing your <strong style="color:${INK};">${opts.roleLabel}</strong> onboarding with Same Day Solution. Our team reviewed your application and a few items need to be corrected and re-submitted before we can approve your account:
    </p>
    ${itemsHtml}
    <p style="margin:10px 0 0;font-size:14px;line-height:1.65;color:${MUTED};">Please reopen your onboarding using the button below, update only the flagged items, and re-submit for review. Everything else you already completed is saved.</p>
    ${button('Update & Re-submit', opts.link)}
    <p style="margin:8px 0 0;font-size:12px;line-height:1.6;color:${MUTED};">Or copy this link: <a href="${opts.link}" style="color:${BRAND};word-break:break-all;">${opts.link}</a><br/><br/>This link expires on <strong>${opts.expiresOn}</strong>. Please don't share it — it's unique to you.</p>`

  return shell(`Update a few details to complete your ${opts.roleLabel} onboarding`, inner)
}

export function renderRejectionEmail(opts: {
  name?: string | null
  roleLabel: string
  reason?: string | null
}): string {
  return renderBrandedEmail({
    previewText: `Update on your ${opts.roleLabel} onboarding application`,
    heading: `Your ${opts.roleLabel} application could not be approved`,
    intro: `Hi${opts.name ? ` <strong style="color:${INK};">${opts.name}</strong>` : ''}, thank you for your interest in joining Same Day Solution as a <strong style="color:${INK};">${opts.roleLabel}</strong>. After reviewing your application, we're unable to approve it at this time.${
      opts.reason ? ` <br/><br/><strong style="color:${INK};">Reason:</strong> ${opts.reason}` : ''
    }`,
    secondaryNote: `If you believe this is a mistake or you'd like to reapply, please contact your upline or write to ${SUPPORT_EMAIL}.`,
  })
}

export function renderOtpEmail(opts: { code: string; name?: string | null }): string {
  const inner = `
    <h1 style="margin:0 0 12px;font-size:20px;font-weight:bold;color:${INK};">Your verification code</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.65;color:${MUTED};">
      Hi${opts.name ? ` <strong style="color:${INK};">${opts.name}</strong>` : ''}, use the code below to verify your email address and continue your onboarding.
    </p>
    <div style="text-align:center;margin:8px 0 20px;">
      <div style="display:inline-block;background:${BG};border-radius:12px;padding:16px 28px;font-family:'Courier New',monospace;font-size:34px;font-weight:bold;letter-spacing:10px;color:${BRAND_DARK};">
        ${opts.code}
      </div>
    </div>
    <p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED};">
      This code expires in 10 minutes. If you didn't request it, you can safely ignore this email.
    </p>`
  return shell('Your Same Day Solution verification code', inner)
}
