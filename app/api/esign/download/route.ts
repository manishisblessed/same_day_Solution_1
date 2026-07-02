import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { fetchDocument } from '@/services/leegality/client'
import type { DocumentDownloadType } from '@/services/leegality/types'

export const dynamic = 'force-dynamic'

const VALID_TYPES: DocumentDownloadType[] = [
  'DOCUMENT',
  'AUDIT_TRAIL',
  'ATTACHMENT',
  'SUPPORTING_DOCUMENT',
]

export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const documentId = searchParams.get('documentId')
    const downloadType = searchParams.get('type') as DocumentDownloadType

    if (!documentId) {
      return NextResponse.json({ error: 'documentId is required' }, { status: 400 })
    }

    if (!downloadType || !VALID_TYPES.includes(downloadType)) {
      return NextResponse.json(
        { error: `type must be one of: ${VALID_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    const result = await fetchDocument(documentId, downloadType, {
      supportDocumentUrl: searchParams.get('supportDocumentUrl') || undefined,
      index: searchParams.has('index') ? Number(searchParams.get('index')) : undefined,
    })

    return NextResponse.json({ success: true, data: result })
  } catch (error: any) {
    console.error('[eSigning] Download error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch document' },
      { status: 500 }
    )
  }
}
