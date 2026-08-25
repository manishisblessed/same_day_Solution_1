import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

/**
 * POST /api/onboarding/approvals/[id]/reject
 * The inviting upline rejects an invitee's declaration.
 * Body: { reason }
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
    const reason = String(body.reason || '').trim() || 'Rejected by upline'
    const now = new Date().toISOString()

    const { error: updErr } = await supabase
      .from('declaration_approvals')
      .update({ status: 'rejected', rejected_reason: reason, updated_at: now })
      .eq('id', approval.id)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

    return NextResponse.json({ success: true, status: 'rejected' })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 })
  }
}
