import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { fetchDocument } from '@/services/leegality/client'
import type { DocumentDownloadType } from '@/services/leegality/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/admin/esign/download?documentId=...&type=DOCUMENT|AUDIT_TRAIL
 * Fetches a fresh short-lived CDN URL from Leegality, downloads the PDF
 * server-side, and streams it to the admin (the CDN URL expires in ~5 min
 * and is not meant to be exposed to the browser directly).
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await getCurrentUserWithFallback(request)
    if (!user) return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    if (user.role !== 'admin' && user.role !== 'finance_executive') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const sp = request.nextUrl.searchParams
    const documentId = sp.get('documentId')
    const type = (sp.get('type') || 'DOCUMENT') as DocumentDownloadType

    if (!documentId) {
      return NextResponse.json({ error: 'documentId is required' }, { status: 400 })
    }
    if (type !== 'DOCUMENT' && type !== 'AUDIT_TRAIL') {
      return NextResponse.json({ error: 'type must be DOCUMENT or AUDIT_TRAIL' }, { status: 400 })
    }

    // 1. Ask Leegality for a fresh CDN URL
    const res = await fetchDocument(documentId, type)
    const cdnUrl = (res as any)?.url || (res as any)?.file || (res as any)?.data?.url
    if (!cdnUrl) {
      return NextResponse.json({ error: 'Leegality did not return a file URL' }, { status: 502 })
    }

    // 2. Download the file server-side
    const fileRes = await fetch(cdnUrl)
    if (!fileRes.ok) {
      return NextResponse.json({ error: `Failed to download file (${fileRes.status})` }, { status: 502 })
    }
    const arrayBuf = await fileRes.arrayBuffer()

    const suffix = type === 'AUDIT_TRAIL' ? 'audit-trail' : 'agreement'
    const filename = `${suffix}-${documentId}.pdf`

    return new NextResponse(new Uint8Array(arrayBuf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err: any) {
    console.error('[admin/esign/download] error:', err)
    return NextResponse.json({ error: err.message || 'Download failed' }, { status: 500 })
  }
}
