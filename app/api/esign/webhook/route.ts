import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { upsertVerification } from '@/lib/onboarding/invites'
import { fetchDocument } from '@/services/leegality/client'
import { sendEmail } from '@/services/email'
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

      // Email the signed agreement to the partner
      try {
        const { data: invite } = await supabase
          .from('onboarding_invites')
          .select('name, email, phone')
          .eq('id', updatedDoc.invite_id)
          .maybeSingle()

        if (invite?.email) {
          // Fetch signed PDF from Leegality
          const { url: pdfUrl } = await fetchDocument(documentId, 'DOCUMENT')
          const pdfRes = await fetch(pdfUrl)
          const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer())

          await sendEmail({
            to: invite.email,
            subject: 'Your Signed Partner Agreement — Same Day Solution',
            html: `
              <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
                <h2 style="color:#1e293b">Partner Agreement Signed Successfully</h2>
                <p>Dear ${invite.name || 'Partner'},</p>
                <p>Your Master Service Agreement with <strong>Same Day Solution Pvt. Ltd.</strong> has been signed by both parties.</p>
                <p>Please find the fully executed agreement attached to this email for your records.</p>
                <br/>
                <p style="color:#64748b;font-size:13px">This is an auto-generated email. For any queries, contact us at <a href="mailto:grievance@samedaysolution.in">grievance@samedaysolution.in</a> or call 7399599958.</p>
                <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0"/>
                <p style="color:#94a3b8;font-size:11px">Same Day Solution Pvt. Ltd. | TF-11B, 3rd Floor, Eros Metro Mall, Dwarka Sector-14, New Delhi – 110078</p>
              </div>`,
            attachments: [{
              filename: `Partner-Agreement-${(invite.name || 'Signed').replace(/\s+/g, '-')}.pdf`,
              content: pdfBuffer,
              contentType: 'application/pdf',
            }],
          })
          console.log(`[eSigning Webhook] Emailed signed agreement to ${invite.email}`)
        }
      } catch (emailErr: any) {
        // Don't fail the webhook if email fails
        console.error('[eSigning Webhook] Failed to email signed agreement:', emailErr?.message)
      }
    }

    return NextResponse.json({ received: true })
  } catch (error: any) {
    console.error('[eSigning Webhook] Error:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
