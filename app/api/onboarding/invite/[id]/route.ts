import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { ONBOARD_CAPABLE_ROLES } from '@/lib/hierarchy'
import { INVITE_TABLE, inviteLink, generateInviteToken, inviteExpiryDate } from '@/lib/onboarding/invites'
import { sendEmail } from '@/services/email'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'

export const dynamic = 'force-dynamic'

const ROLE_TABLE: Record<string, string> = {
  master_distributor: 'master_distributors',
  distributor: 'distributors',
  retailer: 'retailers',
}

/**
 * PATCH /api/onboarding/invite/[id]
 * Admin/upline management of an invite.
 * Body: { action: 'approve' | 'reject' | 'resend', reason? }
 *  - approve: only from registered/verified. Flips invite -> approved and the
 *    created partner row -> active / verification_status approved.
 *  - reject: invite -> rejected; partner row (if created) -> inactive/rejected.
 *  - resend: reissues the token + link (only for open invites).
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
          .eq('partner_id', invite.created_partner_id)
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
          .eq('partner_id', invite.created_partner_id)
      }

      return NextResponse.json({ success: true, status: 'rejected' })
    }

    if (action === 'resend') {
      if (!['pending', 'registered', 'verified', 'resubmit'].includes(invite.status)) {
        return NextResponse.json(
          { error: `Cannot resend an invite in "${invite.status}" state` },
          { status: 400 }
        )
      }
      const token = generateInviteToken()
      await supabase
        .from(INVITE_TABLE)
        .update({ token, expires_at: inviteExpiryDate(), updated_at: now })
        .eq('id', invite.id)

      const link = inviteLink(token)
      sendEmail({
        to: invite.email,
        subject: 'Your Same Day Solution onboarding link (resent)',
        html: `<p>Here is your onboarding link:</p><p><a href="${link}">${link}</a></p>`,
      }).catch(() => {})

      return NextResponse.json({ success: true, status: invite.status, link })
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
