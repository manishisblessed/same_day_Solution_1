import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { loadInviteByToken, OPEN_INVITE_STATUSES } from '@/lib/onboarding/invites'

export const dynamic = 'force-dynamic'

const DOC_VERSION = 'v1.0'

/**
 * GET /api/onboard/[token]/agreement — acceptance status.
 */
export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  const supabase = getSupabaseAdmin()
  const { invite, error } = await loadInviteByToken(supabase, params.token)
  if (error || !invite) return NextResponse.json({ error: error || 'Invite not found' }, { status: 404 })

  const { data } = await supabase
    .from('agreement_acceptances')
    .select('id, doc_version, method, accepted_at')
    .eq('invite_id', invite.id)
    .order('accepted_at', { ascending: false })
    .limit(1)

  const accepted = !!(data && data[0])
  return NextResponse.json({ accepted, docVersion: DOC_VERSION, acceptance: data?.[0] || null })
}

/**
 * POST /api/onboard/[token]/agreement — record click-wrap acceptance.
 * Body: { accepted: true }
 */
export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  const supabase = getSupabaseAdmin()
  const { invite, error } = await loadInviteByToken(supabase, params.token)
  if (error || !invite) return NextResponse.json({ error: error || 'Invite not found' }, { status: 404 })
  if (!OPEN_INVITE_STATUSES.includes(invite.status)) {
    return NextResponse.json({ error: 'This invite is not active' }, { status: 410 })
  }

  const body = await request.json().catch(() => ({}))
  if (body.accepted !== true) {
    return NextResponse.json({ error: 'You must accept the agreement to continue' }, { status: 400 })
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  const userAgent = request.headers.get('user-agent') || null

  await supabase.from('agreement_acceptances').insert([
    {
      invite_id: invite.id,
      doc_version: DOC_VERSION,
      method: 'click_wrap',
      ip,
      user_agent: userAgent,
    },
  ])

  return NextResponse.json({ ok: true, docVersion: DOC_VERSION })
}
