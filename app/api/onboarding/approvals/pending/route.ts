import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { roleLabel } from '@/lib/hierarchy'

export const dynamic = 'force-dynamic'

/**
 * GET /api/onboarding/approvals/pending
 * Declaration approvals awaiting the current upline (MD/DT) partner.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    if (user.role !== 'master_distributor' && user.role !== 'distributor') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('declaration_approvals')
      .select('*')
      .eq('approver_id', user.partner_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Fetch the related invites in one round-trip.
    const inviteIds = Array.from(new Set((data || []).map((a: any) => a.invite_id)))
    const inviteById = new Map<string, any>()
    if (inviteIds.length > 0) {
      const { data: invites } = await supabase
        .from('onboarding_invites')
        .select('id, name, email, phone, target_role, status, created_partner_id')
        .in('id', inviteIds)
      for (const inv of invites || []) inviteById.set(inv.id, inv)
    }

    const approvals = (data || []).map((a: any) => {
      const inv = inviteById.get(a.invite_id)
      return {
        id: a.id,
        invite_id: a.invite_id,
        onboardee_role: a.onboardee_role,
        onboardee_role_label: roleLabel(a.onboardee_role),
        status: a.status,
        created_at: a.created_at,
        invitee: inv ? { name: inv.name, email: inv.email, phone: inv.phone } : null,
      }
    })

    return NextResponse.json({ success: true, approvals })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 })
  }
}
