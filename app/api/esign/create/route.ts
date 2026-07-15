import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { createSigningRequest } from '@/services/leegality/client'
import { getLeegalityWorkflowId } from '@/services/leegality/config'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body = await request.json()
    const { invitees, fileBase64, fileName, fields, irn } = body

    if (!invitees?.length) {
      return NextResponse.json({ error: 'At least one invitee required' }, { status: 400 })
    }

    for (const inv of invitees) {
      if (!inv.name) {
        return NextResponse.json({ error: 'Each invitee must have a name' }, { status: 400 })
      }
      if (!inv.email && !inv.phone) {
        return NextResponse.json(
          { error: 'Each invitee must have email or phone' },
          { status: 400 }
        )
      }
    }

    const result = await createSigningRequest({
      profileId: getLeegalityWorkflowId(),
      invitees,
      ...(fileBase64 && { file: { name: fileName || 'agreement.pdf', file: fileBase64 } }),
      ...(fields && { fields }),
      ...(irn && { irn }),
    })

    const supabase = getSupabaseAdmin()

    const { data: doc } = await supabase
      .from('esign_documents')
      .insert({
        user_id: user.id,
        leegality_document_id: result.documentId,
        irn: result.irn || irn || null,
        document_name: fileName || 'Agreement',
        status: 'IN PROGRESS',
      })
      .select('id')
      .single()

    if (doc) {
      const inviteeRows = result.invitees.map((inv) => ({
        document_id: doc.id,
        name: inv.name,
        email: inv.email || null,
        phone: inv.phone || null,
        sign_url: inv.signUrl,
        status: 'pending',
      }))

      await supabase.from('esign_invitees').insert(inviteeRows)
    }

    return NextResponse.json({
      success: true,
      data: {
        documentId: result.documentId,
        invitees: result.invitees,
      },
    })
  } catch (error: any) {
    console.error('[eSigning] Create error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create signing request' },
      { status: 500 }
    )
  }
}
