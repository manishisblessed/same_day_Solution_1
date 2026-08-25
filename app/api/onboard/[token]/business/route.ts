import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { loadInviteByToken, OPEN_INVITE_STATUSES, upsertVerification } from '@/lib/onboarding/invites'

export const dynamic = 'force-dynamic'

/**
 * POST /api/onboard/[token]/business
 * Body: { shopName }
 * Captures the business/shop name (required even when GST is skipped).
 */
export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const supabase = getSupabaseAdmin()
    const { invite, error } = await loadInviteByToken(supabase, params.token)
    if (error || !invite) return NextResponse.json({ error: error || 'Invite not found' }, { status: 404 })
    if (!OPEN_INVITE_STATUSES.includes(invite.status)) {
      return NextResponse.json({ error: 'This invite is not active' }, { status: 410 })
    }

    const body = await request.json().catch(() => ({}))
    const shopName = String(body.shopName || '').trim()
    if (shopName.length < 2) {
      return NextResponse.json({ error: 'Business/shop name is required' }, { status: 400 })
    }

    await upsertVerification(supabase, {
      inviteId: invite.id,
      type: 'BUSINESS_NAME',
      status: 'Success',
      verifiedName: shopName,
      payload: { shopName },
    })

    return NextResponse.json({ ok: true, shopName })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 })
  }
}
