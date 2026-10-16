import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { checkCompanyComplete } from '@/lib/ca/company-invoice'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Text + JSON fields the CA can set on the company invoice profile.
const TEXT_FIELDS = [
  'gstin', 'legal_name', 'address', 'pan', 'email', 'phone', 'state_code', 'cin',
  'place_of_supply', 'jurisdiction', 'reverse_charge',
  'bank_account_number', 'bank_account_type', 'bank_holder_name', 'bank_name',
  'bank_branch', 'bank_ifsc', 'authorized_signatory_name', 'signature_image',
] as const

function sanitizeServiceLines(v: any): any[] {
  if (!Array.isArray(v)) return []
  return v
    .map((l) => ({
      description: String(l?.description ?? '').trim(),
      sac: String(l?.sac ?? '').trim(),
      percent: Number(l?.percent) || 0,
    }))
    .filter((l) => l.description || l.sac)
}

function sanitizeTerms(v: any): string[] {
  if (!Array.isArray(v)) return []
  return v.map((t) => String(t ?? '').trim()).filter(Boolean)
}

async function requireCA(request: NextRequest) {
  const { user } = await getCurrentUserWithFallback(request)
  if (!user) return { error: 'Session expired. Please login again.', status: 401 as const }
  if (user.role !== 'ca_executive' && user.role !== 'admin') {
    return { error: 'CA access required', status: 403 as const }
  }
  return { user }
}

/** GET /api/ca/company-config?brand_id= */
export async function GET(request: NextRequest) {
  const auth = await requireCA(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const brandId = request.nextUrl.searchParams.get('brand_id')?.trim()
    const supabase = getSupabaseAdmin()

    let q = supabase
      .from('ca_company_config')
      .select(`*, brands:brand_id ( id, key, name, short_name )`)
      .order('created_at', { ascending: false })

    if (brandId) q = q.eq('brand_id', brandId)

    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    const configs = (data || []).map((c: any) => ({ ...c, completeness: checkCompanyComplete(c) }))
    return NextResponse.json({ success: true, configs })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/** POST /api/ca/company-config  — upsert by brand_id */
export async function POST(request: NextRequest) {
  const auth = await requireCA(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()

    const brand_id = String(body.brand_id || '').trim()
    if (!brand_id) return NextResponse.json({ error: 'brand_id is required' }, { status: 400 })

    const margin_percent = Number(body.margin_percent ?? 20)
    if (!Number.isFinite(margin_percent) || margin_percent < 0) {
      return NextResponse.json({ error: 'margin_percent must be >= 0' }, { status: 400 })
    }

    const gst_percent = Number(body.gst_percent ?? 18)
    if (!Number.isFinite(gst_percent) || gst_percent < 0) {
      return NextResponse.json({ error: 'gst_percent must be >= 0' }, { status: 400 })
    }

    const row: Record<string, any> = {
      brand_id,
      margin_percent,
      gst_percent,
      service_lines: sanitizeServiceLines(body.service_lines),
      terms: sanitizeTerms(body.terms),
      created_by: auth.user.email,
    }
    for (const f of TEXT_FIELDS) {
      row[f] = body[f] !== undefined && body[f] !== null && String(body[f]).trim() !== '' ? String(body[f]).trim() : null
    }

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('ca_company_config')
      .upsert(row, { onConflict: 'brand_id' })
      .select(`*, brands:brand_id ( id, key, name, short_name )`)
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true, config: data }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/** PUT /api/ca/company-config  { id, ...fields } */
export async function PUT(request: NextRequest) {
  const auth = await requireCA(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const id = String(body.id || '').trim()
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const patch: Record<string, any> = {}
    if (body.margin_percent !== undefined) {
      const v = Number(body.margin_percent)
      if (!Number.isFinite(v) || v < 0) return NextResponse.json({ error: 'margin_percent must be >= 0' }, { status: 400 })
      patch.margin_percent = v
    }
    if (body.gst_percent !== undefined) {
      const v = Number(body.gst_percent)
      if (!Number.isFinite(v) || v < 0) return NextResponse.json({ error: 'gst_percent must be >= 0' }, { status: 400 })
      patch.gst_percent = v
    }
    for (const f of TEXT_FIELDS) {
      if (body[f] !== undefined) patch[f] = body[f] && String(body[f]).trim() !== '' ? String(body[f]).trim() : null
    }
    if (body.service_lines !== undefined) patch.service_lines = sanitizeServiceLines(body.service_lines)
    if (body.terms !== undefined) patch.terms = sanitizeTerms(body.terms)

    const supabase = getSupabaseAdmin()
    const { error } = await supabase.from('ca_company_config').update(patch).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
