import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getLegalVersion, listLegalDocuments, loadLegalManifest } from '@/lib/legal/server'

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
