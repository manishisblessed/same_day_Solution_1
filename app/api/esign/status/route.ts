import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getDocumentDetails } from '@/services/leegality/client'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const documentId = searchParams.get('documentId')

    if (!documentId) {
      return NextResponse.json({ error: 'documentId is required' }, { status: 400 })
    }

    const includeFile = searchParams.get('file') === 'true'
    const includeAudit = searchParams.get('auditTrail') === 'true'

    const details = await getDocumentDetails(documentId, {
      file: includeFile,
      auditTrail: includeAudit,
    })

    return NextResponse.json({ success: true, data: details })
  } catch (error: any) {
    console.error('[eSigning] Status error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch document status' },
      { status: 500 }
    )
  }
}
