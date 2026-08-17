import { NextRequest, NextResponse } from 'next/server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getLegalDocument } from '@/lib/legal/server'
import { renderMarkdownToHtml } from '@/lib/legal/renderMarkdown'
import { requireLegalAdmin } from '@/lib/legal/authz'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

export async function GET(
  request: NextRequest,
  context: any
) {
  try {
    const auth = await requireLegalAdmin(request)
    if ('error' in auth) {
      return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))
    }

    const resolvedParams = typeof context.params?.then === 'function' 
      ? await context.params 
      : context.params
    const docId = resolvedParams?.docId || request.nextUrl.pathname.split('/').pop()
    const doc = await getLegalDocument(docId)
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

    const html = renderMarkdownToHtml(doc.content)

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
          html,
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
