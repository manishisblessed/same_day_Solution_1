import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { validateServiceVendorBand, validateMinVsVendor, type ServiceKind, type RateType } from '@/lib/service-vendor/rates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function OPTIONS(request: NextRequest) {
  const response = handleCorsPreflight(request)
  return response || new NextResponse(null, { status: 204 })
}

async function requireAdmin(request: NextRequest) {
  const { user: admin } = await getCurrentUserWithFallback(request)
  if (!admin) return { error: 'Session expired. Please login again.', status: 401 as const }
  if (admin.role !== 'admin') return { error: 'Admin access required', status: 403 as const }
  return { admin }
}

const VALID_KINDS = ['BBPS', 'PAYOUT']
const VALID_TYPES = ['PERCENT', 'FLAT']

const num = (v: any) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

function buildRow(body: any): { row?: any; error?: string } {
  const service_kind = String(body.service_kind || '').toUpperCase()
  if (!VALID_KINDS.includes(service_kind)) return { error: 'Invalid service_kind (BBPS | PAYOUT)' }

  const scope_key = body.scope_key ? String(body.scope_key).trim() : '*'
  const category = body.category ? String(body.category).trim() : null

  const min_amount = num(body.min_amount ?? 0)
  const max_amount = num(body.max_amount ?? 999999999)
  if (!(min_amount >= 0)) return { error: 'min_amount must be >= 0' }
  if (!(max_amount > 0)) return { error: 'max_amount must be > 0' }
  if (min_amount > max_amount) return { error: 'min_amount must be <= max_amount' }

  const vendor_rate_type = String(body.vendor_rate_type || 'PERCENT').toUpperCase()
  const min_charge_type = String(body.min_charge_type || 'PERCENT').toUpperCase()
  if (!VALID_TYPES.includes(vendor_rate_type)) return { error: 'Invalid vendor_rate_type' }
  if (!VALID_TYPES.includes(min_charge_type)) return { error: 'Invalid min_charge_type' }

  const vendor_rate = num(body.vendor_rate ?? 0)
  const min_charge = num(body.min_charge ?? 0)
  if (Number.isNaN(vendor_rate) || vendor_rate < 0) return { error: 'vendor_rate must be >= 0' }
  if (Number.isNaN(min_charge) || min_charge < 0) return { error: 'min_charge must be >= 0' }
  if (vendor_rate_type === 'PERCENT' && vendor_rate > 100) return { error: 'PERCENT vendor_rate must be <= 100' }
  if (min_charge_type === 'PERCENT' && min_charge > 100) return { error: 'PERCENT min_charge must be <= 100' }

  const gst_inclusive = !!body.gst_inclusive

  const minErr = validateMinVsVendor({
    vendor_rate,
    vendor_rate_type: vendor_rate_type as RateType,
    min_charge,
    min_charge_type: min_charge_type as RateType,
    gst_inclusive,
  })
  if (minErr) return { error: minErr }

  return {
    row: {
      service_kind,
      scope_key: scope_key === '*' ? '*' : scope_key,
      category,
      min_amount,
      max_amount,
      vendor_rate_type,
      vendor_rate,
      min_charge_type,
      min_charge,
      gst_inclusive,
    },
  }
}

/** GET /api/admin/service-vendor-rates?service_kind=BBPS */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request)
  if ('error' in auth) return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))

  try {
    const kind = new URL(request.url).searchParams.get('service_kind')
    const supabase = getSupabaseAdmin()
    let q = supabase.from('service_vendor_rates').select('*').order('service_kind').order('scope_key').order('min_amount')
    if (kind) q = q.eq('service_kind', kind.toUpperCase())
    const { data, error } = await q
    if (error) return addCorsHeaders(request, NextResponse.json({ error: error.message }, { status: 400 }))
    return addCorsHeaders(request, NextResponse.json({ success: true, rates: data || [] }))
  } catch (err: any) {
    return addCorsHeaders(request, NextResponse.json({ error: err.message }, { status: 500 }))
  }
}

/** POST /api/admin/service-vendor-rates */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request)
  if ('error' in auth) return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))

  try {
    const body = await request.json()
    const { row, error: buildError } = buildRow(body)
    if (buildError) return addCorsHeaders(request, NextResponse.json({ error: buildError }, { status: 400 }))

    const overlap = await validateServiceVendorBand(
      row.service_kind as ServiceKind,
      { scope_key: row.scope_key, category: row.category },
      { min_amount: row.min_amount, max_amount: row.max_amount }
    )
    if (overlap) return addCorsHeaders(request, NextResponse.json({ error: overlap }, { status: 400 }))

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('service_vendor_rates')
      .insert({ ...row, created_by: null })
      .select()
      .single()
    if (error) return addCorsHeaders(request, NextResponse.json({ error: error.message }, { status: 400 }))
    return addCorsHeaders(request, NextResponse.json({ success: true, rate: data }, { status: 201 }))
  } catch (err: any) {
    return addCorsHeaders(request, NextResponse.json({ error: err.message }, { status: 500 }))
  }
}

/** PUT /api/admin/service-vendor-rates (id in body) */
export async function PUT(request: NextRequest) {
  const auth = await requireAdmin(request)
  if ('error' in auth) return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))

  try {
    const body = await request.json()
    const id = String(body.id || '').trim()
    if (!id) return addCorsHeaders(request, NextResponse.json({ error: 'id is required' }, { status: 400 }))

    const { row, error: buildError } = buildRow(body)
    if (buildError) return addCorsHeaders(request, NextResponse.json({ error: buildError }, { status: 400 }))

    const overlap = await validateServiceVendorBand(
      row.service_kind as ServiceKind,
      { scope_key: row.scope_key, category: row.category },
      { min_amount: row.min_amount, max_amount: row.max_amount },
      id
    )
    if (overlap) return addCorsHeaders(request, NextResponse.json({ error: overlap }, { status: 400 }))

    const patch: any = { ...row }
    if (body.active !== undefined) patch.active = !!body.active
    const supabase = getSupabaseAdmin()
    const { error } = await supabase.from('service_vendor_rates').update(patch).eq('id', id)
    if (error) return addCorsHeaders(request, NextResponse.json({ error: error.message }, { status: 400 }))
    return addCorsHeaders(request, NextResponse.json({ success: true }))
  } catch (err: any) {
    return addCorsHeaders(request, NextResponse.json({ error: err.message }, { status: 500 }))
  }
}

/** DELETE /api/admin/service-vendor-rates?id=... */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin(request)
  if ('error' in auth) return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))

  try {
    const id = new URL(request.url).searchParams.get('id')?.trim()
    if (!id) return addCorsHeaders(request, NextResponse.json({ error: 'id is required' }, { status: 400 }))
    const supabase = getSupabaseAdmin()
    const { error } = await supabase.from('service_vendor_rates').delete().eq('id', id)
    if (error) return addCorsHeaders(request, NextResponse.json({ error: error.message }, { status: 400 }))
    return addCorsHeaders(request, NextResponse.json({ success: true }))
  } catch (err: any) {
    return addCorsHeaders(request, NextResponse.json({ error: err.message }, { status: 500 }))
  }
}
