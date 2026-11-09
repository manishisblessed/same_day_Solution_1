import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { loadInviteByToken, upsertVerification } from '@/lib/onboarding/invites'
import { getDocumentDetails } from '@/services/leegality/client'

export const dynamic = 'force-dynamic'

/**
 * GET /api/onboard/[token]/esign/status
 * Returns the current eSigning status for this onboarding invite.
 * Proactively syncs with Leegality API if local DB hasn't been updated by webhook.
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

    let { data: invitees } = await supabase
      .from('esign_invitees')
      .select('name, email, phone, sign_url, status, sign_type, signed_at, signing_order')
      .eq('document_id', doc.id)
      .order('signing_order', { ascending: true })

    let partnerInvitee = (invitees || []).find((i: any) => i.signing_order === 1)
    let partnerSigned = partnerInvitee?.status === 'signed'

    // If partner hasn't signed in our DB but doc was initiated > 30s ago,
    // proactively check Leegality API (webhook may have missed/delayed)
    if (!partnerSigned && doc.status === 'IN PROGRESS') {
      const ageMs = Date.now() - new Date(doc.created_at).getTime()
      if (ageMs > 30_000) {
        try {
          const details = await getDocumentDetails(doc.leegality_document_id)
          // Sync invitee statuses from Leegality
          for (const leegalityInv of details.invitees || []) {
            const isSigned = leegalityInv.status === 'signed' || !!leegalityInv.signedAt
            if (isSigned && leegalityInv.signUrl) {
              await supabase.from('esign_invitees').update({
                status: 'signed',
                sign_type: leegalityInv.signType || null,
                signed_at: leegalityInv.signedAt || new Date().toISOString(),
              }).eq('sign_url', leegalityInv.signUrl)
            }
          }
          // Sync document status
          if (details.status && details.status !== doc.status) {
            await supabase.from('esign_documents').update({
              status: details.status,
              ...(details.file && { signed_file_url: details.file }),
              ...(details.auditTrail && { audit_trail_url: details.auditTrail }),
              updated_at: new Date().toISOString(),
            }).eq('id', doc.id)
          }
          // Re-read invitees after sync
          const { data: refreshed } = await supabase.from('esign_invitees')
            .select('name, email, phone, sign_url, status, sign_type, signed_at, signing_order')
            .eq('document_id', doc.id).order('signing_order', { ascending: true })
          invitees = refreshed
          partnerInvitee = (invitees || []).find((i: any) => i.signing_order === 1)
          partnerSigned = partnerInvitee?.status === 'signed'
          console.log(`[esign/status] Leegality sync: partnerSigned=${partnerSigned} docStatus=${details.status}`)
        } catch (syncErr: any) {
          console.warn('[esign/status] Leegality sync failed:', syncErr?.message)
        }
      }
    }

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
