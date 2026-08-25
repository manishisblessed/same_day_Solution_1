import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { getRequestContext, logActivityFromContext } from '@/lib/activity-logger'

export const dynamic = 'force-dynamic'

/**
 * POST /api/onboarding/approvals/[id]/approve
 * The inviting upline (MD/DT) approves an invitee's declaration.
 * Body: { signatureUrl?, selfieUrl?, latitude?, longitude? }
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    if (user.role !== 'master_distributor' && user.role !== 'distributor') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = getSupabaseAdmin()
    const { data: approval } = await supabase
      .from('declaration_approvals')
      .select('*')
      .eq('id', params.id)
      .maybeSingle()
    if (!approval) return NextResponse.json({ error: 'Approval not found' }, { status: 404 })
    if (approval.approver_id !== user.partner_id) {
      return NextResponse.json({ error: 'This approval is not assigned to you' }, { status: 403 })
    }
    if (approval.status !== 'pending') {
      return NextResponse.json({ error: `Already ${approval.status}` }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const now = new Date().toISOString()
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null

    const { error: updErr } = await supabase
      .from('declaration_approvals')
      .update({
        status: 'approved',
        approver_signature_url: body.signatureUrl || null,
        approver_selfie_url: body.selfieUrl || null,
        approval_lat: body.latitude ?? null,
        approval_lng: body.longitude ?? null,
        approval_ip: ip,
        approval_user_agent: request.headers.get('user-agent') || null,
        approved_at: now,
        updated_at: now,
      })
      .eq('id', approval.id)

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

    const ctx = getRequestContext(request)
    logActivityFromContext(ctx, user, {
      activity_type: 'onboarding_declaration_approve',
      activity_category: 'admin',
      activity_description: `Approved onboarding declaration ${approval.id}`,
    }).catch(() => {})

    return NextResponse.json({ success: true, status: 'approved' })
  } catch (error: any) {
    console.error('[approvals approve] error:', error)
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 })
  }
}
