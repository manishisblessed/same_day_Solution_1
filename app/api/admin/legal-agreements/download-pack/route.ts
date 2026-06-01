import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getAllLegalDocumentsContent, loadLegalManifest } from '@/lib/legal/server'
import { renderMarkdownToHtml } from '@/lib/legal/renderMarkdown'
import JSZip from 'jszip'

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

    const format = request.nextUrl.searchParams.get('format') || 'md'
    const [manifest, documents] = await Promise.all([loadLegalManifest(), getAllLegalDocumentsContent()])

    if (format === 'zip') {
      const zip = new JSZip()
      documents.forEach((doc) => {
        zip.file(doc.fileName, doc.content)
      })
      const buffer = await zip.generateAsync({ type: 'nodebuffer' })
      return addCorsHeaders(
        request,
        new NextResponse(new Uint8Array(buffer), {
          status: 200,
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="sameday-solutions-legal-pack-v${manifest.version}.zip"`,
            'Cache-Control': 'no-store',
          },
        })
      )
    }

    if (format === 'html') {
      const combinedHtml = documents
        .map((doc) => {
          const html = renderMarkdownToHtml(doc.content)
          return `<div style="page-break-after:always;margin-bottom:2em;"><h1 style="font-size:20pt;border-bottom:2px solid #333;padding-bottom:8px;">${doc.title}</h1><p style="color:#666;font-size:10pt;">Document ID: ${doc.id} | Version: ${doc.version} | Effective: ${doc.effectiveDate}</p>${html}</div>`
        })
        .join('\n')

      const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Georgia,serif;font-size:11pt;line-height:1.7;max-width:800px;margin:0 auto;padding:40px 20px;color:#222}h1{font-size:18pt}h2{font-size:14pt}h3{font-size:12pt}table{border-collapse:collapse;width:100%;margin:1em 0}td,th{border:1px solid #999;padding:6px 10px}th{background:#f5f5f5;font-weight:bold}ol,ul{padding-left:1.5em}</style></head><body><div style="text-align:center;margin-bottom:2em;border-bottom:3px solid #333;padding-bottom:1em;"><h1 style="font-size:22pt;margin:0;">${manifest.company.legalName}</h1><p style="font-size:12pt;color:#555;">Channel Partner Legal Document Pack</p><p style="font-size:10pt;color:#888;">Version ${manifest.version} | Effective ${manifest.effectiveDate}</p></div>${combinedHtml}</body></html>`

      return addCorsHeaders(
        request,
        new NextResponse(fullHtml, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        })
      )
    }

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
