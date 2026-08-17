import { NextRequest, NextResponse } from 'next/server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getLegalVersion, listLegalDocuments, loadLegalManifest } from '@/lib/legal/server'
import { requireLegalAdmin } from '@/lib/legal/authz'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireLegalAdmin(request)
    if ('error' in auth) {
      return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))
    }

    const [manifest, documents] = await Promise.all([loadLegalManifest(), listLegalDocuments()])

    return addCorsHeaders(
      request,
      NextResponse.json({
        success: true,
        version: getLegalVersion(),
        manifestVersion: manifest.version,
        effectiveDate: manifest.effectiveDate,
        company: manifest.company,
        governingLaw: manifest.governingLaw,
        jurisdiction: manifest.jurisdiction,
        documents,
      })
    )
  } catch (error) {
    console.error('[Legal Agreements] List error:', error)
    return addCorsHeaders(
      request,
      NextResponse.json({ success: false, error: 'Failed to load legal agreements' }, { status: 500 })
    )
  }
}
