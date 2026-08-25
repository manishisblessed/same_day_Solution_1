import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { loadInviteByToken, INVITE_TABLE, getVerifications } from '@/lib/onboarding/invites'

export const dynamic = 'force-dynamic'

/**
 * POST /api/onboard/[token]/resubmit
 * After an admin flags documents for resubmission (invite.status = 'resubmit'),
 * the applicant re-uploads them and calls this to move back to 'registered'.
 */
export async function POST(_request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const supabase = getSupabaseAdmin()
    const { invite, error } = await loadInviteByToken(supabase, params.token)
    if (error || !invite) return NextResponse.json({ error: error || 'Invite not found' }, { status: 404 })

    if (invite.status !== 'resubmit') {
      return NextResponse.json({ error: 'This invite is not awaiting resubmission' }, { status: 400 })
    }

    // Ensure no verification remains in a Rejected state.
    const verifications = await getVerifications(supabase, invite.id)
    const stillRejected = verifications.filter((v) => v.status === 'Rejected')
    if (stillRejected.length > 0) {
      return NextResponse.json(
        {
          error: 'Some documents still need to be re-uploaded',
          pending: stillRejected.map((v) => v.type),
        },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()
    await supabase
      .from(INVITE_TABLE)
      .update({ status: 'registered', updated_at: now })
      .eq('id', invite.id)

    return NextResponse.json({ ok: true, status: 'registered' })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 })
  }
}
