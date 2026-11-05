import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { roleLabel } from '@/lib/hierarchy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/admin/esign/list
 * Lists partner-agreement eSign documents with linked onboarding invite info.
 * Admin / finance only.
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    if (user.role !== 'admin' && user.role !== 'finance_executive') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const sp = request.nextUrl.searchParams
    const status = sp.get('status')?.trim()
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') || '50', 10) || 50))

    const supabase = getSupabaseAdmin()

    let query = supabase
      .from('esign_documents')
      .select('id, invite_id, leegality_document_id, irn, document_name, status, signed_file_url, audit_trail_url, created_at, updated_at')
      .not('invite_id', 'is', null)
      .order('created_at', { ascending: false })

    if (status) query = query.eq('status', status)

    const from = (page - 1) * pageSize
    const { data: docs, error } = await query.range(from, from + pageSize)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const rows = docs || []
    const hasMore = rows.length > pageSize
    const pageRows = hasMore ? rows.slice(0, pageSize) : rows

    // Join invite details
    const inviteIds = Array.from(new Set(pageRows.map((d) => d.invite_id).filter(Boolean)))
    const inviteMap = new Map<string, any>()
    if (inviteIds.length) {
      const { data: invites } = await supabase
        .from('onboarding_invites')
        .select('id, name, email, phone, target_role, status, created_partner_id')
        .in('id', inviteIds)
      for (const inv of invites || []) inviteMap.set(inv.id, inv)
    }

    // Join invitee sign status
    const docIds = pageRows.map((d) => d.id)
    const inviteeMap = new Map<string, any[]>()
    if (docIds.length) {
      const { data: invitees } = await supabase
        .from('esign_invitees')
        .select('document_id, name, email, phone, status, sign_type, signed_at, sign_url')
        .in('document_id', docIds)
      for (const inv of invitees || []) {
        const arr = inviteeMap.get(inv.document_id) || []
        arr.push(inv)
        inviteeMap.set(inv.document_id, arr)
      }
    }

    const result = pageRows.map((d) => {
      const invite = inviteMap.get(d.invite_id) || null
      const invitees = inviteeMap.get(d.id) || []
      return {
        documentId: d.leegality_document_id,
        irn: d.irn,
        documentName: d.document_name,
        status: d.status,
        hasSignedFile: !!d.signed_file_url,
        hasAuditTrail: !!d.audit_trail_url || d.status === 'COMPLETED',
        createdAt: d.created_at,
        updatedAt: d.updated_at,
        partner: invite
          ? {
              name: invite.name,
              email: invite.email,
              phone: invite.phone,
              role: invite.target_role,
              roleLabel: roleLabel(invite.target_role),
              inviteStatus: invite.status,
              partnerId: invite.created_partner_id,
            }
          : null,
        signers: invitees.map((i) => ({
          name: i.name,
          email: i.email,
          phone: i.phone,
          status: i.status,
          signType: i.sign_type,
          signedAt: i.signed_at,
        })),
      }
    })

    return NextResponse.json({ success: true, agreements: result, page, pageSize, hasMore })
  } catch (err: any) {
    console.error('[admin/esign/list] error:', err)
    return NextResponse.json({ error: err.message || 'Failed to load agreements' }, { status: 500 })
  }
}
