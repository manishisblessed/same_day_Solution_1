import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { deleteDocument, deleteInvitation } from '@/services/leegality/client'
import { createClient } from '@/lib/supabase/server-admin'

export const dynamic = 'force-dynamic'

export async function DELETE(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const documentId = searchParams.get('documentId')
    const signUrl = searchParams.get('signUrl')

    if (!documentId && !signUrl) {
      return NextResponse.json(
        { error: 'Either documentId or signUrl is required' },
        { status: 400 }
      )
    }

    const supabase = createClient()

    if (signUrl) {
      await deleteInvitation(signUrl)

      await supabase
        .from('esign_invitees')
        .update({ status: 'deleted' })
        .eq('sign_url', signUrl)

      return NextResponse.json({ success: true, message: 'Invitation deleted' })
    }

    await deleteDocument(documentId!)

    await supabase
      .from('esign_documents')
      .update({ status: 'DELETED', updated_at: new Date().toISOString() })
      .eq('leegality_document_id', documentId!)

    return NextResponse.json({ success: true, message: 'Document deleted' })
  } catch (error: any) {
    console.error('[eSigning] Delete error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete' },
      { status: 500 }
    )
  }
}
