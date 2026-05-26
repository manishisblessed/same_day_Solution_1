import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getLegalDocument } from '@/lib/legal/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

async function requireAdmin(request: NextRequest) {
  const { user: admin } = await getCurrentUserWithFallback(request)
  if (!admin) return { error: 'Session expired', status: 401 as const }
  if (admin.role !== 'admin') return { error: 'Admin access required', status: 403 as const }
  return { admin }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { docId: string } }
) {
  try {
    const auth = await requireAdmin(request)
    if ('error' in auth) {
      return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))
    }

    const doc = await getLegalDocument(params.docId)
    if (!doc) {
      return addCorsHeaders(request, NextResponse.json({ error: 'Document not found' }, { status: 404 }))
    }

    const download = request.nextUrl.searchParams.get('download') === '1'
    if (download) {
      const safeName = doc.fileName.replace(/[^\w.-]+/g, '_')
      return addCorsHeaders(
        request,
        new NextResponse(doc.content, {
          status: 200,
          headers: {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Content-Disposition': `attachment; filename="${safeName}"`,
            'Cache-Control': 'no-store',
          },
        })
      )
    }

    return addCorsHeaders(
      request,
      NextResponse.json({
        success: true,
        document: {
          id: doc.id,
          fileName: doc.fileName,
          title: doc.title,
          shortTitle: doc.shortTitle,
          description: doc.description,
          roles: doc.roles,
          requiredForOnboarding: doc.requiredForOnboarding,
          order: doc.order,
          version: doc.version,
          effectiveDate: doc.effectiveDate,
          content: doc.content,
        },
      })
    )
  } catch (error) {
    console.error('[Legal Agreements] Document error:', error)
    return addCorsHeaders(
      request,
      NextResponse.json({ success: false, error: 'Failed to load document' }, { status: 500 })
    )
  }
}
