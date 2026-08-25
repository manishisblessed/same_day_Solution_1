import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { loadInviteByToken } from '@/lib/onboarding/invites'
import { needsUplineApproval } from '@/lib/hierarchy'

export const dynamic = 'force-dynamic'

/**
 * GET /api/onboard/[token]/declaration/status
 * Polled by the wizard while waiting for the upline to approve.
 */
export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  const supabase = getSupabaseAdmin()
  const { invite, error } = await loadInviteByToken(supabase, params.token)
  if (error || !invite) return NextResponse.json({ error: error || 'Invite not found' }, { status: 404 })

  const requiresApproval = needsUplineApproval(invite.invited_by_role)
  if (!requiresApproval) {
    return NextResponse.json({ requiresApproval: false })
  }

  const { data } = await supabase
    .from('declaration_approvals')
    .select('status, approver_email, rejected_reason, approved_at')
    .eq('invite_id', invite.id)
    .order('created_at', { ascending: false })
    .limit(1)
  const approval = data && data[0]

  return NextResponse.json({
    requiresApproval: true,
    approverName: invite.invited_by_name,
    approval: approval
      ? { status: approval.status, rejectedReason: approval.rejected_reason, approvedAt: approval.approved_at }
      : null,
  })
}
