import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { isReuseApprover } from '@/lib/onboarding/identityReuse'
import { inviteLink, appUrl } from '@/lib/onboarding/invites'
import { roleLabel } from '@/lib/hierarchy'
import { sendEmail } from '@/services/email'
import { sendSms } from '@/services/sms'
import { renderBrandedEmail } from '@/lib/email/templates'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * PATCH /api/admin/identity-reuse-requests/[id]
 * Body: { action: 'approve' | 'reject' | 'assign', reason?, assigned_to? }
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const supabase = getSupabaseAdmin()
    const { ok, adminId } = await isReuseApprover(supabase, user.email)
    if (!ok) return NextResponse.json({ error: 'You do not have access to Identity Reuse Approvals' }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const action = String(body.action || '').trim()
    const now = new Date().toISOString()

    const { data: reqRow, error: loadErr } = await supabase
      .from('identity_reuse_requests')
      .select('*')
      .eq('id', params.id)
      .maybeSingle()
    if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 })
    if (!reqRow) return NextResponse.json({ error: 'Request not found' }, { status: 404 })

    if (action === 'assign') {
      const { data: updated, error } = await supabase
        .from('identity_reuse_requests')
        .update({ assigned_to: body.assigned_to || null, updated_at: now })
        .eq('id', params.id)
        .select()
        .maybeSingle()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ success: true, request: updated })
    }

    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
    if (reqRow.status !== 'pending') {
      return NextResponse.json({ error: `This request is already ${reqRow.status}` }, { status: 400 })
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected'
    const { data: updated, error } = await supabase
      .from('identity_reuse_requests')
      .update({
        status: newStatus,
        reviewed_by: adminId || null,
        reviewed_at: now,
        reason: body.reason ? String(body.reason) : null,
        updated_at: now,
      })
      .eq('id', params.id)
      .select()
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Notify the applicant so they can return and finish (or stop).
    const { data: invite } = await supabase
      .from('onboarding_invites')
      .select('*')
      .eq('id', reqRow.invite_id)
      .maybeSingle()

    if (invite) {
      const rl = roleLabel(invite.target_role)
      if (newStatus === 'approved') {
        const link = inviteLink(invite.token)
        sendEmail({
          to: invite.email,
          subject: `Approved: continue your ${rl} onboarding`,
          html: renderBrandedEmail({
            previewText: 'Your identity reuse was approved — continue onboarding',
            heading: 'You can now continue',
            intro: `Hi${invite.name ? ` <strong>${invite.name}</strong>` : ''}, an admin has approved the use of your PAN for an additional ${rl} account. Please return to your onboarding link to complete your registration.`,
            ctaLabel: 'Continue Onboarding',
            ctaUrl: link,
          }),
        }).catch(() => {})
        sendSms({
          to: invite.phone,
          body: `Same Day Solution: Your PAN reuse for a ${rl} account is approved. Continue onboarding: ${link}`,
        }).catch(() => {})
      } else {
        sendEmail({
          to: invite.email,
          subject: `Update on your ${rl} onboarding`,
          html: renderBrandedEmail({
            previewText: 'Update on your onboarding',
            heading: 'We could not approve this request',
            intro: `Hi${invite.name ? ` <strong>${invite.name}</strong>` : ''}, your request to use the same PAN for an additional ${rl} account was not approved.${reqRow.reason ? ` Reason: ${String(body.reason || '')}` : ''} Please contact support if you have questions.`,
            ctaLabel: 'Go to Website',
            ctaUrl: appUrl(),
          }),
        }).catch(() => {})
      }
    }

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, user, {
      activity_type: `identity_reuse_${newStatus}`,
      activity_category: 'admin',
      activity_description: `${newStatus} PAN reuse request ${params.id} (PAN ${reqRow.pan_number}, role ${reqRow.target_role})`,
    }).catch(() => {})

    return NextResponse.json({ success: true, request: updated })
  } catch (error: any) {
    console.error('[identity-reuse-requests PATCH] error:', error)
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 })
  }
}
