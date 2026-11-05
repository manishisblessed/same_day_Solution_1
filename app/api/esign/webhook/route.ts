import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { upsertVerification } from '@/lib/onboarding/invites'
import type { LeegalityWebhookPayload } from '@/services/leegality/types'

export const dynamic = 'force-dynamic'

const ESIGN_WEBHOOK_SECRET = process.env.ESIGN_WEBHOOK_SECRET

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('x-webhook-secret') || request.headers.get('authorization')
    if (ESIGN_WEBHOOK_SECRET) {
      if (!authHeader || authHeader.replace('Bearer ', '') !== ESIGN_WEBHOOK_SECRET) {
        console.error('[eSign Webhook] Unauthorized — invalid or missing secret')
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    } else {
      console.warn('[eSign Webhook] ESIGN_WEBHOOK_SECRET not configured — skipping auth (configure in production!)')
    }

    const raw: any = await request.json()
    // Leegality webhook shape is undocumented in the provided collection and
    // varies by version; normalize the fields we rely on defensively.
    const body = raw?.data ?? raw ?? {}
    const payload: LeegalityWebhookPayload = {
      documentId: body.documentId ?? body.id ?? '',
      irn: body.irn ?? '',
      status: body.status ?? body.documentStatus ?? '',
      invitee: body.invitee
        ? {
            name: body.invitee.name ?? '',
            email: body.invitee.email ?? body.invitee.emailId ?? '',
            signUrl: body.invitee.signUrl ?? body.invitee.url ?? '',
            signType: body.invitee.signType ?? body.invitee.type ?? '',
          }
        : undefined,
      file: body.file ?? body.documentUrl ?? undefined,
      auditTrail: body.auditTrail ?? body.auditTrailUrl ?? undefined,
    }
    const { documentId, invitee, file, auditTrail } = payload

    // Canonicalize status to our internal values regardless of Leegality casing
    const rawStatus = String(payload.status || '').toUpperCase()
    let status = payload.status
    if (['COMPLETED', 'SIGNED', 'COMPLETE'].includes(rawStatus)) status = 'COMPLETED'
    else if (['IN PROGRESS', 'IN_PROGRESS', 'PENDING', 'ACTIVE'].includes(rawStatus)) status = 'IN PROGRESS'
    else if (['EXPIRED'].includes(rawStatus)) status = 'EXPIRED'
    else if (['DELETED', 'DECLINED', 'REJECTED'].includes(rawStatus)) status = 'DELETED'

    console.log(`[eSigning Webhook] documentId=${documentId} status=${status} (raw=${payload.status})`)

    const supabase = getSupabaseAdmin()

    // Update the esign_documents record
    const { data: updatedDoc } = await supabase
      .from('esign_documents')
      .update({
        status,
        ...(file && { signed_file_url: file }),
        ...(auditTrail && { audit_trail_url: auditTrail }),
        updated_at: new Date().toISOString(),
      })
      .eq('leegality_document_id', documentId)
      .select('id, invite_id')
      .maybeSingle()

    if (invitee?.signUrl) {
      await supabase
        .from('esign_invitees')
        .update({
          status: 'signed',
          sign_type: invitee.signType || null,
          signed_at: new Date().toISOString(),
        })
        .eq('sign_url', invitee.signUrl)
    }

    // If the document is COMPLETED and linked to an onboarding invite,
    // record the agreement acceptance automatically.
    if (status === 'COMPLETED' && updatedDoc?.invite_id) {
      const { data: existingAcceptance } = await supabase
        .from('agreement_acceptances')
        .select('id')
        .eq('invite_id', updatedDoc.invite_id)
        .eq('method', 'esign')
        .limit(1)
        .maybeSingle()

      if (!existingAcceptance) {
        await supabase.from('agreement_acceptances').insert({
          invite_id: updatedDoc.invite_id,
          doc_version: 'v1.0',
          method: 'esign',
          ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
          user_agent: 'leegality-webhook',
          esign_document_id: documentId,
        })
        console.log(`[eSigning Webhook] Auto-recorded agreement acceptance for invite ${updatedDoc.invite_id}`)
      }

      // Record verification so onboarding progress gates correctly
      await upsertVerification(supabase, {
        inviteId: updatedDoc.invite_id,
        type: 'PARTNER_AGREEMENT',
        status: 'Success',
        payload: { documentId, method: 'esign' },
      })
    }

    return NextResponse.json({ received: true })
  } catch (error: any) {
    console.error('[eSigning Webhook] Error:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
