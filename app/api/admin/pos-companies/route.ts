import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { getPosCompanies, isValidPOSMerchantSlug } from '@/lib/merchant-companies'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KEY_PREFIX = 'pos_company:'

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

/**
 * GET /api/admin/pos-companies
 * Returns each POS company with its archived state.
 * Archived state is stored in portal_settings rows keyed `pos_company:<slug>`,
 * where enabled=false means archived (hidden from default views).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if ('error' in auth) {
    return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))
  }

  try {
    const supabase = getSupabaseAdmin()
    const { data: rows } = await supabase
      .from('portal_settings')
      .select('service_key, enabled')
      .like('service_key', `${KEY_PREFIX}%`)

    const archivedMap: Record<string, boolean> = {}
    for (const row of rows || []) {
      const slug = row.service_key.slice(KEY_PREFIX.length)
      // enabled=false => archived
      archivedMap[slug] = row.enabled === false
    }

    const companies = getPosCompanies().map((c) => ({
      ...c,
      archived: archivedMap[c.slug] === true,
    }))

    return addCorsHeaders(request, NextResponse.json({ success: true, companies }))
  } catch (err: any) {
    return addCorsHeaders(request, NextResponse.json({ success: false, error: err.message }, { status: 500 }))
  }
}

/**
 * POST /api/admin/pos-companies
 * Body: { slug: string, archived: boolean }
 * Toggles a company's archived state.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if ('error' in auth) {
    return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))
  }

  try {
    const body = await request.json()
    const slug = String(body.slug || '').toLowerCase().trim()
    const archived = body.archived === true

    if (!slug || !isValidPOSMerchantSlug(slug)) {
      return addCorsHeaders(request, NextResponse.json({ error: 'Invalid company slug' }, { status: 400 }))
    }

    const supabase = getSupabaseAdmin()
    const adminEmail = auth.admin.email || 'admin'

    const { error } = await supabase
      .from('portal_settings')
      .upsert({
        service_key: `${KEY_PREFIX}${slug}`,
        enabled: !archived,
        active_provider: 'system',
        updated_by: adminEmail,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'service_key' })

    if (error) {
      return addCorsHeaders(request, NextResponse.json({ success: false, error: error.message }, { status: 500 }))
    }

    await supabase.from('portal_audit_log').insert({
      service_key: `${KEY_PREFIX}${slug}`,
      action: archived ? 'Company ARCHIVED' : 'Company ACTIVATED',
      old_value: String(!archived),
      new_value: String(archived),
      performed_by: adminEmail,
    }).then(() => {}, () => {}) // best-effort audit

    return addCorsHeaders(request, NextResponse.json({ success: true, slug, archived }))
  } catch (err: any) {
    return addCorsHeaders(request, NextResponse.json({ success: false, error: err.message }, { status: 500 }))
  }
}
