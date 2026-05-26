import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getAllLegalDocumentsContent, loadLegalManifest } from '@/lib/legal/server'

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

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin(request)
    if ('error' in auth) {
      return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))
    }

    const [manifest, documents] = await Promise.all([loadLegalManifest(), getAllLegalDocumentsContent()])

    const packContent = documents
      .map((doc) => {
        return [
          '',
          '='.repeat(80),
          doc.title.toUpperCase(),
          `Document ID: ${doc.id}`,
          `Version: ${doc.version} | Effective Date: ${doc.effectiveDate}`,
          '='.repeat(80),
          '',
          doc.content,
          '',
        ].join('\n')
      })
      .join('\n')

    const header = [
      'SAMEDAY SOLUTIONS PRIVATE LIMITED',
      'CHANNEL PARTNER LEGAL DOCUMENT PACK',
      `Version: ${manifest.version}`,
      `Effective Date: ${manifest.effectiveDate}`,
      `Generated from admin panel`,
      '',
      manifest.company.registeredOffice,
      '',
    ].join('\n')

    const fullContent = `${header}\n${packContent}`

    return addCorsHeaders(
      request,
      new NextResponse(fullContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="sameday-solutions-legal-pack-v${manifest.version}.md"`,
          'Cache-Control': 'no-store',
        },
      })
    )
  } catch (error) {
    console.error('[Legal Agreements] Pack download error:', error)
    return addCorsHeaders(
      request,
      NextResponse.json({ success: false, error: 'Failed to generate legal pack' }, { status: 500 })
    )
  }
}
