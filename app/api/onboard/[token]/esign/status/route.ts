import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { loadInviteByToken, upsertVerification } from '@/lib/onboarding/invites'

export const dynamic = 'force-dynamic'

/**
 * GET /api/onboard/[token]/esign/status
 * Returns the current eSigning status for this onboarding invite.
 */
export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const supabase = getSupabaseAdmin()
    const { invite, error } = await loadInviteByToken(supabase, params.token)
    if (error || !invite) {
      return NextResponse.json({ error: error || 'Invite not found' }, { status: 404 })
    }

    const { data: doc } = await supabase
      .from('esign_documents')
      .select('id, leegality_document_id, status, signed_file_url, audit_trail_url, created_at, updated_at')
      .eq('invite_id', invite.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!doc) {
      return NextResponse.json({ initiated: false, status: null })
    }

    const { data: invitees } = await supabase
      .from('esign_invitees')
      .select('name, email, phone, sign_url, status, sign_type, signed_at, signing_order')
      .eq('document_id', doc.id)
      .order('signing_order', { ascending: true })

    // Check if the partner (signing_order=1) has individually signed,
    // even if the overall document is still IN PROGRESS (waiting for company signatory)
    const partnerInvitee = (invitees || []).find((i: any) => i.signing_order === 1)
    const partnerSigned = partnerInvitee?.status === 'signed'

    // Record verification when partner has signed (don't wait for both parties)
    if (partnerSigned || doc.status === 'COMPLETED') {
      await upsertVerification(supabase, {
        inviteId: invite.id,
        type: 'PARTNER_AGREEMENT',
        status: 'Success',
        payload: { documentId: doc.leegality_document_id, method: 'esign' },
      })
    }

    return NextResponse.json({
      initiated: true,
      status: doc.status,
      partnerSigned,
      documentId: doc.leegality_document_id,
      signedFileUrl: doc.signed_file_url,
      auditTrailUrl: doc.audit_trail_url,
      invitees: invitees || [],
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
    })
  } catch (err: any) {
    console.error('[esign/status] error:', err)
    return NextResponse.json({ error: err.message || 'Failed to fetch status' }, { status: 500 })
  }
}
