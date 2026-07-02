import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server-admin'
import type { LeegalityWebhookPayload } from '@/services/leegality/types'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const payload: LeegalityWebhookPayload = await request.json()
    const { documentId, status, invitee, file, auditTrail } = payload

    console.log(`[eSigning Webhook] documentId=${documentId} status=${status}`)

    const supabase = createClient()

    await supabase
      .from('esign_documents')
      .update({
        status,
        ...(file && { signed_file_url: file }),
        ...(auditTrail && { audit_trail_url: auditTrail }),
        updated_at: new Date().toISOString(),
      })
      .eq('leegality_document_id', documentId)

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

    return NextResponse.json({ received: true })
  } catch (error: any) {
    console.error('[eSigning Webhook] Error:', error)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
