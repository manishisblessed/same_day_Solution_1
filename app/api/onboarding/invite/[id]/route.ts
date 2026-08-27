import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { ONBOARD_CAPABLE_ROLES, roleLabel } from '@/lib/hierarchy'
import { INVITE_TABLE, inviteLink, generateInviteToken, inviteExpiryDate, findDuplicateIdentity } from '@/lib/onboarding/invites'
import { sendEmail } from '@/services/email'
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

      const ctx = getRequestContext(request)
      logActivityFromContext(ctx, user, {
        activity_type: 'onboarding_invite_approve',
        activity_category: 'admin',
        activity_description: `Approved onboarding for ${invite.email} (${invite.created_partner_id || 'n/a'})`,
      }).catch(() => {})

      return NextResponse.json({ success: true, status: 'approved' })
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
      let emailSent = true
      try {
        await sendEmail({
          to: invite.email,
          subject: 'Your Same Day Solution onboarding link',
          html: `<p>Hi${invite.name ? ` ${invite.name}` : ''},</p><p>Here is your onboarding link:</p><p><a href="${link}">${link}</a></p><p>This link expires on ${new Date(inviteExpiryDate()).toLocaleDateString('en-IN')}.</p>`,
        })
      } catch {
        emailSent = false
      }

      return NextResponse.json({ success: true, status: nextStatus, link, onboardingLink: link, emailSent })
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
      let emailSent = true
      try {
        await sendEmail({
          to: email,
          subject: `You're invited to join Same Day Solution as a ${roleLabel(invite.target_role)}`,
          html: `<p>Hi${name ? ` ${name}` : ''},</p><p>Click below to complete your onboarding:</p><p><a href="${link}">${link}</a></p>`,
        })
      } catch {
        emailSent = false
      }

      const ctx = getRequestContext(request)
      logActivityFromContext(ctx, user, {
        activity_type: 'onboarding_invite_update',
        activity_category: 'admin',
        activity_description: `Edited invite contact for ${email}`,
      }).catch(() => {})

      return NextResponse.json({ success: true, status: 'pending', link, onboardingLink: link, emailSent })
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

    return NextResponse.json({ success: true, invite, verifications: verifications || [] })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 })
  }
}
