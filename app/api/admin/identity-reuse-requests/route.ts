import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { isReuseApprover } from '@/lib/onboarding/identityReuse'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/identity-reuse-requests?status=&assigned_to=
 * Queue of inline PAN-reuse approval requests raised during onboarding.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const supabase = getSupabaseAdmin()
    const { ok } = await isReuseApprover(supabase, user.email)
    if (!ok) return NextResponse.json({ error: 'You do not have access to Identity Reuse Approvals' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const assignedTo = searchParams.get('assigned_to')

    let q = supabase.from('identity_reuse_requests').select('*').order('created_at', { ascending: false })
    if (status) q = q.eq('status', status)
    if (assignedTo) q = q.eq('assigned_to', assignedTo)
    const { data: requests, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Enrich with applicant info from the invite.
    const inviteIds = Array.from(new Set((requests || []).map((r: any) => r.invite_id)))
    const invitesById = new Map<string, any>()
    if (inviteIds.length) {
      const { data: invites } = await supabase
        .from('onboarding_invites')
        .select('id, name, email, phone, target_role, status, created_partner_id')
        .in('id', inviteIds)
      for (const inv of invites || []) invitesById.set(inv.id, inv)
    }

    const enriched = (requests || []).map((r: any) => ({
      ...r,
      invite: invitesById.get(r.invite_id) || null,
    }))

    return NextResponse.json({ success: true, requests: enriched })
  } catch (error: any) {
    console.error('[identity-reuse-requests GET] error:', error)
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 })
  }
}
