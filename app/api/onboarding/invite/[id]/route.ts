import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { ONBOARD_CAPABLE_ROLES, roleLabel } from '@/lib/hierarchy'
import { INVITE_TABLE, VERIFICATION_TABLE, inviteLink, generateInviteToken, inviteExpiryDate, findDuplicateIdentity, appUrl, getVerifications } from '@/lib/onboarding/invites'
import { docLabel } from '@/lib/onboarding/requiredDocuments'
import { isS3Configured, presignGetUrl } from '@/services/s3-kyc'
import { sendEmail } from '@/services/email'
import { renderInviteEmail, renderApprovalEmail, renderResubmitEmail, renderRejectionEmail } from '@/lib/email/templates'
import { sendSms, inviteSmsBody } from '@/services/sms'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'

export const dynamic = 'force-dynamic'

const ROLE_TABLE: Record<string, string> = {
  master_distributor: 'master_distributors',
  distributor: 'distributors',
  retailer: 'retailers',
  partner: 'partners',
  master_partner: 'partners',
}

// The partners table keys on UUID id; network role tables key on partner_id.
function idColumnForRole(role: string): string {
  return role === 'partner' || role === 'master_partner' ? 'id' : 'partner_id'
}

const IDENTITY_LABELS: Record<string, string> = {
  PAN_360: 'PAN',
  AADHAAR_DIGILOCKER: 'Aadhaar',
  BANK_PENNY_DROP: 'Bank Account',
  GST: 'GST',
  BUSINESS_NAME: 'Business Name',
  ONBOARD_VIDEO: 'Liveness Video',
  SELF_DECLARATION: 'Signed Self-Declaration Form',
}

/** Human label for a verification type (identity, media or document). */
function verificationLabel(type: string): string {
  if (IDENTITY_LABELS[type]) return IDENTITY_LABELS[type]
  if (type.startsWith('DOCUMENT_')) return docLabel(type.replace('DOCUMENT_', ''))
  return type
}

function expiryLabel(): string {
  return new Date(inviteExpiryDate()).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * PATCH /api/onboarding/invite/[id]
 * Admin/upline management of an invite.
 * Body: { action: 'approve' | 'reject' | 'resend' | 'reshare' | 'update', reason?, email?, phone?, name? }
 *  - approve: only from registered/verified. Flips invite -> approved and the
 *    created partner row -> active / verification_status approved.
 *  - reject: invite -> rejected; partner row (if created) -> inactive/rejected.
 *  - resend: reissues the token + link (only for open invites).
 *  - reshare: like resend but also un-expires the invite (status -> pending) so a
 *    fresh, usable link can be handed to someone who couldn't finish in time.
 *  - update: correct the email / phone / name of a still-pending invite (wrong
 *    contact) and re-send the onboarding link to the corrected address.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    if (!ONBOARD_CAPABLE_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const action = String(body.action || '').trim()
    const supabase = getSupabaseAdmin()

    const { data: invite, error: loadErr } = await supabase
      .from(INVITE_TABLE)
      .select('*')
      .eq('id', params.id)
      .maybeSingle()
    if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 })
    if (!invite) return NextResponse.json({ error: 'Invite not found' }, { status: 404 })

    // Non-admins may only manage their own invites.
    const isAdmin = user.role === 'admin' || user.role === 'finance_executive'
    if (!isAdmin && invite.invited_by_id !== (user.partner_id || user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const now = new Date().toISOString()

    if (action === 'approve') {
      // Only admins activate a partner.
      if (!isAdmin) {
        return NextResponse.json({ error: 'Only admin can approve onboarding' }, { status: 403 })
      }
      if (!['registered', 'verified'].includes(invite.status)) {
        return NextResponse.json(
          { error: `Cannot approve an invite in "${invite.status}" state` },
          { status: 400 }
        )
      }

      await supabase
        .from(INVITE_TABLE)
        .update({ status: 'approved', approved_at: now, updated_at: now })
        .eq('id', invite.id)

      // Activate the created partner row.
      const table = ROLE_TABLE[invite.target_role]
      if (table && invite.created_partner_id) {
        await supabase
          .from(table)
          .update({
            status: 'active',
            verification_status: 'approved',
            verified_at: now,
            verified_by: user.id,
          })
          .eq(idColumnForRole(invite.target_role), invite.created_partner_id)
      }

      // Notify the applicant that their account is now active.
      const loginUrl = `${appUrl()}/login`
      const rl = roleLabel(invite.target_role)
      let emailSent = false
      let smsSent = false
      const er = await sendEmail({
        to: invite.email,
        subject: `Your Same Day Solution ${rl} account is approved`,
        html: renderApprovalEmail({
          name: invite.name,
          roleLabel: rl,
          partnerId: invite.created_partner_id,
          loginUrl,
        }),
      }).catch(() => ({ ok: false }))
      emailSent = !!er.ok
      const sr = await sendSms({
        to: invite.phone,
        body: `Congratulations${invite.name ? ` ${invite.name}` : ''}! Your Same Day Solution ${rl} account is approved and active${invite.created_partner_id ? ` (ID: ${invite.created_partner_id})` : ''}. Log in at ${loginUrl}`,
      }).catch(() => ({ ok: false }))
      smsSent = !!sr.ok

      const ctx = getRequestContext(request)
      logActivityFromContext(ctx, user, {
        activity_type: 'onboarding_invite_approve',
        activity_category: 'admin',
        activity_description: `Approved onboarding for ${invite.email} (${invite.created_partner_id || 'n/a'})`,
      }).catch(() => {})

      return NextResponse.json({ success: true, status: 'approved', emailSent, smsSent })
    }

    if (action === 'reject') {
      const reason = body.reason ? String(body.reason) : null
      await supabase
        .from(INVITE_TABLE)
        .update({ status: 'rejected', rejected_at: now, rejected_reason: reason, updated_at: now })
        .eq('id', invite.id)

      const table = ROLE_TABLE[invite.target_role]
      if (table && invite.created_partner_id) {
        await supabase
          .from(table)
          .update({ status: 'inactive', verification_status: 'rejected', verified_at: now, verified_by: user.id })
          .eq(idColumnForRole(invite.target_role), invite.created_partner_id)
      }

      return NextResponse.json({ success: true, status: 'rejected' })
    }

    if (action === 'resend' || action === 'reshare') {
      const resharing = action === 'reshare'
      // resend: only for still-open invites. reshare: also revives an expired one.
      const allowed = resharing
        ? ['pending', 'registered', 'verified', 'resubmit', 'expired']
        : ['pending', 'registered', 'verified', 'resubmit']
      if (!allowed.includes(invite.status)) {
        return NextResponse.json(
          { error: `Cannot ${action} an invite in "${invite.status}" state` },
          { status: 400 }
        )
      }
      // Once the partner row exists we must not silently reset their progress.
      if (resharing && invite.created_partner_id) {
        return NextResponse.json(
          { error: 'This applicant has already registered — cannot reshare a fresh link.' },
          { status: 400 }
        )
      }

      const token = generateInviteToken()
      const nextStatus = resharing && invite.status === 'expired' ? 'pending' : invite.status
      await supabase
        .from(INVITE_TABLE)
        .update({ token, expires_at: inviteExpiryDate(), status: nextStatus, updated_at: now })
        .eq('id', invite.id)

      const link = inviteLink(token)
      const channels: string[] = Array.isArray(body.channels) && body.channels.length
        ? body.channels.map((c: any) => String(c).toLowerCase())
        : ['email', 'sms']
      const rl = roleLabel(invite.target_role)
      let emailSent = false
      let smsSent = false

      if (channels.includes('email')) {
        const r = await sendEmail({
          to: invite.email,
          subject: 'Your Same Day Solution onboarding link',
          html: renderInviteEmail({
            name: invite.name,
            inviterName: invite.invited_by_name,
            roleLabel: rl,
            link,
            expiresOn: new Date(inviteExpiryDate()).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
          }),
        }).catch(() => ({ ok: false }))
        emailSent = !!r.ok
      }
      if (channels.includes('sms')) {
        const r = await sendSms({
          to: invite.phone,
          body: inviteSmsBody({ inviterName: invite.invited_by_name, roleLabel: rl, link }),
        }).catch(() => ({ ok: false }))
        smsSent = !!r.ok
      }

      return NextResponse.json({ success: true, status: nextStatus, link, onboardingLink: link, emailSent, smsSent })
    }

    if (action === 'update') {
      if (invite.status !== 'pending') {
        return NextResponse.json(
          { error: 'Only a pending invite (before the invitee registers) can be edited.' },
          { status: 400 }
        )
      }
      const email = body.email ? String(body.email).trim().toLowerCase() : invite.email
      const phone = body.phone ? String(body.phone).trim() : invite.phone
      const name = body.name !== undefined ? (body.name ? String(body.name).trim() : null) : invite.name

      if (!email || !phone) {
        return NextResponse.json({ error: 'Email and phone are required' }, { status: 400 })
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
      }

      // Only run the duplicate guard if the contact actually changed.
      if (email !== invite.email || phone !== invite.phone) {
        const dup = await findDuplicateIdentity(supabase, { email, phone, excludeInviteId: invite.id })
        if (dup) return NextResponse.json({ error: dup }, { status: 409 })
      }

      // Issue a fresh token so any stale link sent to the wrong contact is dead.
      const token = generateInviteToken()
      const { error: updErr } = await supabase
        .from(INVITE_TABLE)
        .update({ email, phone, name, token, expires_at: inviteExpiryDate(), updated_at: now })
        .eq('id', invite.id)
      if (updErr) return NextResponse.json({ error: updErr.message }, { status: 400 })

      const link = inviteLink(token)
      const rl = roleLabel(invite.target_role)
      let emailSent = false
      let smsSent = false

      const r = await sendEmail({
        to: email,
        subject: `You're invited to join Same Day Solution as a ${rl}`,
        html: renderInviteEmail({
          name,
          inviterName: invite.invited_by_name,
          roleLabel: rl,
          link,
          expiresOn: new Date(inviteExpiryDate()).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
        }),
      }).catch(() => ({ ok: false }))
      emailSent = !!r.ok

      const sr = await sendSms({
        to: phone,
        body: inviteSmsBody({ inviterName: invite.invited_by_name, roleLabel: rl, link }),
      }).catch(() => ({ ok: false }))
      smsSent = !!sr.ok

      const ctx = getRequestContext(request)
      logActivityFromContext(ctx, user, {
        activity_type: 'onboarding_invite_update',
        activity_category: 'admin',
        activity_description: `Edited invite contact for ${email}`,
      }).catch(() => {})

      return NextResponse.json({ success: true, status: 'pending', link, onboardingLink: link, emailSent, smsSent })
    }

    if (action === 'reject_items') {
      if (!isAdmin) {
        return NextResponse.json({ error: 'Only admin can request re-submission' }, { status: 403 })
      }
      const rawItems = Array.isArray(body.items) ? body.items : []
      const items = rawItems
        .map((i: any) => ({ type: String(i?.type || '').trim(), reason: String(i?.reason || '').trim() }))
        .filter((i: any) => i.type && i.reason)
      if (!items.length) {
        return NextResponse.json({ error: 'Select at least one item and add a reason for each' }, { status: 400 })
      }

      const verifications = await getVerifications(supabase, invite.id)
      const byType = new Map(verifications.map((v) => [v.type, v]))

      for (const it of items) {
        const existing = byType.get(it.type)
        const payload = {
          ...((existing?.response_payload as any) || {}),
          rejection_reason: it.reason,
          rejected_at: now,
          rejected_by: user.id,
        }
        await supabase
          .from(VERIFICATION_TABLE)
          .update({ status: 'Rejected', response_payload: payload, updated_at: now })
          .eq('invite_id', invite.id)
          .eq('type', it.type)
      }

      // Reopen the invite for resubmission with a fresh, usable link.
      const token = generateInviteToken()
      await supabase
        .from(INVITE_TABLE)
        .update({ status: 'resubmit', token, expires_at: inviteExpiryDate(), rejected_reason: body.note ? String(body.note) : null, updated_at: now })
        .eq('id', invite.id)

      // If a partner row was already created, put it back into pending review.
      const table = ROLE_TABLE[invite.target_role]
      if (table && invite.created_partner_id) {
        await supabase
          .from(table)
          .update({ status: 'pending_verification', verification_status: 'pending', updated_at: now })
          .eq(idColumnForRole(invite.target_role), invite.created_partner_id)
      }

      const link = inviteLink(token)
      const rl = roleLabel(invite.target_role)
      const emailItems = items.map((i: any) => ({ label: verificationLabel(i.type), reason: i.reason }))
      const er = await sendEmail({
        to: invite.email,
        subject: `Action needed: update your ${rl} onboarding`,
        html: renderResubmitEmail({ name: invite.name, roleLabel: rl, link, expiresOn: expiryLabel(), items: emailItems }),
      }).catch(() => ({ ok: false }))
      const sr = await sendSms({
        to: invite.phone,
        body: `Same Day Solution: A few items in your ${rl} onboarding need correction (${emailItems.map((i: any) => i.label).join(', ')}). Update & re-submit: ${link}`,
      }).catch(() => ({ ok: false }))

      const ctx = getRequestContext(request)
      logActivityFromContext(ctx, user, {
        activity_type: 'onboarding_invite_reject_items',
        activity_category: 'admin',
        activity_description: `Requested resubmission for ${invite.email}: ${items.map((i: any) => i.type).join(', ')}`,
      }).catch(() => {})

      return NextResponse.json({ success: true, status: 'resubmit', link, onboardingLink: link, emailSent: !!er.ok, smsSent: !!sr.ok })
    }

    if (action === 'resend_decision') {
      if (!isAdmin) {
        return NextResponse.json({ error: 'Only admin can resend decision emails' }, { status: 403 })
      }
      const rl = roleLabel(invite.target_role)
      let emailSent = false
      let smsSent = false

      if (invite.status === 'approved') {
        const loginUrl = `${appUrl()}/login`
        const er = await sendEmail({
          to: invite.email,
          subject: `Your Same Day Solution ${rl} account is approved`,
          html: renderApprovalEmail({ name: invite.name, roleLabel: rl, partnerId: invite.created_partner_id, loginUrl }),
        }).catch(() => ({ ok: false }))
        emailSent = !!er.ok
        const sr = await sendSms({
          to: invite.phone,
          body: `Congratulations${invite.name ? ` ${invite.name}` : ''}! Your Same Day Solution ${rl} account is approved and active${invite.created_partner_id ? ` (ID: ${invite.created_partner_id})` : ''}. Log in at ${loginUrl}`,
        }).catch(() => ({ ok: false }))
        smsSent = !!sr.ok
      } else if (invite.status === 'rejected') {
        const er = await sendEmail({
          to: invite.email,
          subject: `Update on your Same Day Solution ${rl} application`,
          html: renderRejectionEmail({ name: invite.name, roleLabel: rl, reason: invite.rejected_reason }),
        }).catch(() => ({ ok: false }))
        emailSent = !!er.ok
        const sr = await sendSms({
          to: invite.phone,
          body: `Same Day Solution: Your ${rl} application could not be approved.${invite.rejected_reason ? ` Reason: ${invite.rejected_reason}.` : ''} Contact your upline for details.`,
        }).catch(() => ({ ok: false }))
        smsSent = !!sr.ok
      } else if (invite.status === 'resubmit') {
        const verifications = await getVerifications(supabase, invite.id)
        const emailItems = verifications
          .filter((v) => v.status === 'Rejected')
          .map((v) => ({ label: verificationLabel(v.type), reason: (v.response_payload as any)?.rejection_reason || 'Please re-upload a clear, valid copy.' }))
        const link = inviteLink(invite.token)
        const expiresOn = new Date(invite.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
        const er = await sendEmail({
          to: invite.email,
          subject: `Action needed: update your ${rl} onboarding`,
          html: renderResubmitEmail({ name: invite.name, roleLabel: rl, link, expiresOn, items: emailItems }),
        }).catch(() => ({ ok: false }))
        emailSent = !!er.ok
        const sr = await sendSms({
          to: invite.phone,
          body: `Same Day Solution: A few items in your ${rl} onboarding need correction. Update & re-submit: ${link}`,
        }).catch(() => ({ ok: false }))
        smsSent = !!sr.ok
      } else {
        return NextResponse.json({ error: `No decision email to resend for a "${invite.status}" invite` }, { status: 400 })
      }

      return NextResponse.json({ success: true, status: invite.status, emailSent, smsSent })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error: any) {
    console.error('[onboarding/invite PATCH] error:', error)
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 })
  }
}

/**
 * GET /api/onboarding/invite/[id] — single invite detail (with verifications).
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    if (!ONBOARD_CAPABLE_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = getSupabaseAdmin()
    const { data: invite } = await supabase
      .from(INVITE_TABLE)
      .select('*')
      .eq('id', params.id)
      .maybeSingle()
    if (!invite) return NextResponse.json({ error: 'Invite not found' }, { status: 404 })

    const isAdmin = user.role === 'admin' || user.role === 'finance_executive'
    if (!isAdmin && invite.invited_by_id !== (user.partner_id || user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: verifications } = await supabase
      .from('onboarding_verifications')
      .select('*')
      .eq('invite_id', invite.id)

    // Attach a viewable media URL: S3 objects get a short-lived signed GET,
    // Supabase storage rows already carry a public URL.
    const enriched = (verifications || []).map((v: any) => {
      const payload = v.response_payload || {}
      let media_url: string | null = null
      if (payload.storage === 's3' && payload.key && isS3Configured()) {
        try {
          media_url = presignGetUrl({ key: payload.key, expiresSec: 900 })
        } catch {}
      } else if (typeof payload.url === 'string' && payload.url) {
        media_url = payload.url
      }
      return { ...v, media_url }
    })

    return NextResponse.json({ success: true, invite, verifications: enriched })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 })
  }
}
