import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { loadInviteByToken, OPEN_INVITE_STATUSES, getVerifications } from '@/lib/onboarding/invites'
import { needsUplineApproval, roleLabel } from '@/lib/hierarchy'
import { sendEmail } from '@/services/email'
import { appUrl } from '@/lib/onboarding/invites'

export const dynamic = 'force-dynamic'

/**
 * POST /api/onboard/[token]/declaration/send
 * Creates a pending declaration_approval for the inviting upline (MD/DT) and
 * notifies them. No-op (returns not-required) for admin-created invites.
 */
export async function POST(_request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const supabase = getSupabaseAdmin()
    const { invite, error } = await loadInviteByToken(supabase, params.token)
    if (error || !invite) return NextResponse.json({ error: error || 'Invite not found' }, { status: 404 })
    if (!OPEN_INVITE_STATUSES.includes(invite.status)) {
      return NextResponse.json({ error: 'This invite is not active' }, { status: 410 })
    }

    if (!needsUplineApproval(invite.invited_by_role)) {
      return NextResponse.json({ ok: true, requiresApproval: false })
    }

    // Require the signed self-declaration to be uploaded first.
    const verifications = await getVerifications(supabase, invite.id)
    const hasDeclaration = verifications.some((v) => v.type === 'SELF_DECLARATION' && v.status === 'Uploaded')
    if (!hasDeclaration) {
      return NextResponse.json(
        { error: 'Upload your signed self-declaration before requesting approval' },
        { status: 400 }
      )
    }

    // Reuse an existing pending/approved approval if present.
    const { data: existing } = await supabase
      .from('declaration_approvals')
      .select('*')
      .eq('invite_id', invite.id)
      .order('created_at', { ascending: false })
      .limit(1)
    const current = existing && existing[0]
    if (current && (current.status === 'pending' || current.status === 'approved')) {
      return NextResponse.json({ ok: true, requiresApproval: true, approval: { status: current.status } })
    }

    const { data: approval, error: insErr } = await supabase
      .from('declaration_approvals')
      .insert([
        {
          invite_id: invite.id,
          approver_role: invite.invited_by_role,
          approver_id: invite.invited_by_id,
          approver_email: invite.invited_by_email,
          onboardee_role: invite.target_role,
          status: 'pending',
        },
      ])
      .select()
      .single()

    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    if (invite.invited_by_email) {
      sendEmail({
        to: invite.invited_by_email,
        subject: `Approval needed: onboarding of ${roleLabel(invite.target_role)} ${invite.name || invite.email}`,
        html: `<p>Your invitee <strong>${invite.name || invite.email}</strong> has completed KYC and requests your declaration approval.</p>
          <p>Please review and approve/reject in your dashboard:</p>
          <p><a href="${appUrl()}/dashboard/approvals">Open Approvals</a></p>`,
      }).catch(() => {})
    }

    return NextResponse.json({ ok: true, requiresApproval: true, approval: { status: approval.status } })
  } catch (error: any) {
    console.error('[declaration/send] error:', error)
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 })
  }
}
