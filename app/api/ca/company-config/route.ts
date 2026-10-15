import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
    return NextResponse.json({ success: true, configs: data || [] })
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

    const row = {
      brand_id,
      margin_percent,
      gst_percent,
      gstin: body.gstin ? String(body.gstin).trim() : null,
      legal_name: body.legal_name ? String(body.legal_name).trim() : null,
      address: body.address ? String(body.address).trim() : null,
      created_by: auth.user.email,
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
    if (body.gstin !== undefined) patch.gstin = body.gstin ? String(body.gstin).trim() : null
    if (body.legal_name !== undefined) patch.legal_name = body.legal_name ? String(body.legal_name).trim() : null
    if (body.address !== undefined) patch.address = body.address ? String(body.address).trim() : null

    const supabase = getSupabaseAdmin()
    const { error } = await supabase.from('ca_company_config').update(patch).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
