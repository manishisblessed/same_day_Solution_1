import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import {
  loadInviteByToken,
  OPEN_INVITE_STATUSES,
  VERIFICATION_TABLE,
  upsertVerification,
  getVerifications,
} from '@/lib/onboarding/invites'
import { uploadOnboardingFile, decodeDataUrl } from '@/lib/onboarding/storage'
import { ONBOARD_DOCUMENTS, SELF_DECLARATION_TYPE, isGpsDoc } from '@/lib/onboarding/requiredDocuments'

export const dynamic = 'force-dynamic'

const VALID_DOC_TYPES = new Set<string>([
  ...ONBOARD_DOCUMENTS.map((d) => d.type),
  SELF_DECLARATION_TYPE,
])

function verificationTypeFor(docType: string): string {
  return docType === SELF_DECLARATION_TYPE ? 'SELF_DECLARATION' : `DOCUMENT_${docType}`
}

/**
 * GET /api/onboard/[token]/documents — list uploaded documents.
 */
export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  const supabase = getSupabaseAdmin()
  const { invite, error } = await loadInviteByToken(supabase, params.token)
  if (error || !invite) return NextResponse.json({ error: error || 'Invite not found' }, { status: 404 })

  const verifications = await getVerifications(supabase, invite.id)
  const docs = verifications
    .filter((v) => v.type.startsWith('DOCUMENT_') || v.type === 'SELF_DECLARATION')
    .map((v) => ({
      type: v.type === 'SELF_DECLARATION' ? SELF_DECLARATION_TYPE : v.type.replace('DOCUMENT_', ''),
      status: v.status,
      url: (v.response_payload as any)?.url || null,
    }))
  return NextResponse.json({ ok: true, documents: docs })
}

/**
 * POST /api/onboard/[token]/documents
 * Body: { type, dataUrl, lat?, lng? }
 * Uploads a document image/PDF to the partner-documents bucket and records it.
 */
export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const supabase = getSupabaseAdmin()
    const { invite, error } = await loadInviteByToken(supabase, params.token)
    if (error || !invite) return NextResponse.json({ error: error || 'Invite not found' }, { status: 404 })
    if (!OPEN_INVITE_STATUSES.includes(invite.status)) {
      return NextResponse.json({ error: 'This invite is not active' }, { status: 410 })
    }

    const body = await request.json().catch(() => ({}))
    const type = String(body.type || '').trim()
    const dataUrl = String(body.dataUrl || '')

    if (!VALID_DOC_TYPES.has(type)) {
      return NextResponse.json({ error: `Unknown document type: ${type}` }, { status: 400 })
    }
    if (!dataUrl) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (isGpsDoc(type) && (body.lat == null || body.lng == null)) {
      return NextResponse.json({ error: 'Location (GPS) is required for this photo' }, { status: 400 })
    }

    const { buffer, contentType } = decodeDataUrl(dataUrl, 'image/jpeg')
    if (buffer.length > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 })
    }

    const uploaded = await uploadOnboardingFile(supabase, {
      inviteId: invite.id,
      kind: 'documents',
      type,
      buffer,
      contentType,
    })
    if ('error' in uploaded) {
      return NextResponse.json({ error: `Upload failed: ${uploaded.error}` }, { status: 500 })
    }

    await upsertVerification(supabase, {
      inviteId: invite.id,
      type: verificationTypeFor(type),
      status: 'Uploaded',
      payload: {
        url: uploaded.url,
        path: uploaded.path,
        lat: body.lat ?? null,
        lng: body.lng ?? null,
        uploadedAt: new Date().toISOString(),
      },
    })

    return NextResponse.json({ ok: true, type, url: uploaded.url })
  } catch (error: any) {
    console.error('[onboard documents POST] error:', error)
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 })
  }
}

/**
 * DELETE /api/onboard/[token]/documents?type=... — remove an uploaded doc so it
 * can be re-uploaded.
 */
export async function DELETE(request: NextRequest, { params }: { params: { token: string } }) {
  const supabase = getSupabaseAdmin()
  const { invite, error } = await loadInviteByToken(supabase, params.token)
  if (error || !invite) return NextResponse.json({ error: error || 'Invite not found' }, { status: 404 })

  const type = request.nextUrl.searchParams.get('type')?.trim() || ''
  if (!VALID_DOC_TYPES.has(type)) {
    return NextResponse.json({ error: 'Unknown document type' }, { status: 400 })
  }

  await supabase
    .from(VERIFICATION_TABLE)
    .delete()
    .eq('invite_id', invite.id)
    .eq('type', verificationTypeFor(type))

  return NextResponse.json({ ok: true, removed: type })
}
