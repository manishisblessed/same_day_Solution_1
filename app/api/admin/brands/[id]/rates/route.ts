import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserWithFallback } from '@/lib/auth-server'
import { addCorsHeaders, handleCorsPreflight } from '@/lib/cors'
import { getSupabaseAdmin } from '@/lib/supabase/server-admin'
import { validateBrandRate, validateMinMdrVsVendor, normBrandValue, normBrandDim } from '@/lib/brand/mdr'

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

const VALID_MODE = ['CARD', 'UPI', '*']
const VALID_CARD_TYPE = ['CREDIT', 'DEBIT', 'PREPAID']

const pct = (v: any) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : NaN
}

/** Build a sanitized, validated rate row from client input. */
function buildRate(body: any): { row?: any; error?: string } {
  const provider = body.provider ? normBrandValue(body.provider) : '*'
  const mode = body.mode ? normBrandValue(body.mode) : '*'
  if (!VALID_MODE.includes(mode)) return { error: 'Invalid mode (CARD | UPI | *)' }

  const card_type = normBrandDim(body.card_type)
  if (card_type && !VALID_CARD_TYPE.includes(card_type)) return { error: 'Invalid card_type' }
  const brand_type = normBrandDim(body.brand_type)
  const card_classification = normBrandDim(body.card_classification)

  const min_amount = Number(body.min_amount ?? 0)
  const max_amount = Number(body.max_amount ?? 999999999)
  if (!Number.isFinite(min_amount) || min_amount < 0) return { error: 'min_amount must be >= 0' }
  if (!Number.isFinite(max_amount) || max_amount <= 0) return { error: 'max_amount must be > 0' }
  if (min_amount > max_amount) return { error: 'min_amount must be <= max_amount' }

  const mdr_value = pct(body.mdr_value ?? 0)
  const mdr_value_t0 = pct(body.mdr_value_t0 ?? 0)
  const min_mdr_value = pct(body.min_mdr_value ?? 0)
  const min_mdr_value_t0 = pct(body.min_mdr_value_t0 ?? 0)
  if ([mdr_value, mdr_value_t0, min_mdr_value, min_mdr_value_t0].some((n) => Number.isNaN(n))) {
    return { error: 'MDR values must be a percent between 0 and 100' }
  }

  const minErr = validateMinMdrVsVendor({ mdr_value, mdr_value_t0, min_mdr_value, min_mdr_value_t0 })
  if (minErr) return { error: minErr }

  return {
    row: {
      provider,
      mode,
      card_type,
      brand_type,
      card_classification,
      min_amount,
      max_amount,
      mdr_type: 'PERCENT',
      mdr_value,
      mdr_value_t0,
      min_mdr_value,
      min_mdr_value_t0,
      gst_inclusive: !!body.gst_inclusive,
    },
  }
}

/** POST /api/admin/brands/:id/rates — add a rate (band-overlap validated). */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(request)
  if ('error' in auth) {
    return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))
  }

  try {
    const supabase = getSupabaseAdmin()
    const { data: brand } = await supabase.from('brands').select('id').eq('id', params.id).maybeSingle()
    if (!brand) return addCorsHeaders(request, NextResponse.json({ error: 'Brand not found' }, { status: 404 }))

    const body = await request.json()
    const { row, error: buildError } = buildRate(body)
    if (buildError) return addCorsHeaders(request, NextResponse.json({ error: buildError }, { status: 400 }))

    const overlap = await validateBrandRate(
      params.id,
      {
        provider: row.provider,
        mode: row.mode,
        card_type: row.card_type,
        brand_type: row.brand_type,
        card_classification: row.card_classification,
      },
      { min_amount: row.min_amount, max_amount: row.max_amount }
    )
    if (overlap) return addCorsHeaders(request, NextResponse.json({ error: overlap }, { status: 400 }))

    const { data, error } = await supabase
      .from('brand_mdr_rates')
      .insert({ brand_id: params.id, ...row })
      .select()
      .single()
    if (error) return addCorsHeaders(request, NextResponse.json({ error: error.message }, { status: 400 }))

    return addCorsHeaders(request, NextResponse.json({ success: true, rate: data }, { status: 201 }))
  } catch (err: any) {
    return addCorsHeaders(request, NextResponse.json({ error: err.message }, { status: 500 }))
  }
}

/** PATCH /api/admin/brands/:id/rates — edit a rate (rateId in body). */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(request)
  if ('error' in auth) {
    return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))
  }

  try {
    const body = await request.json()
    const rateId = String(body.rateId || '').trim()
    if (!rateId) return addCorsHeaders(request, NextResponse.json({ error: 'rateId is required' }, { status: 400 }))

    const supabase = getSupabaseAdmin()
    const { data: existing } = await supabase
      .from('brand_mdr_rates')
      .select('*')
      .eq('id', rateId)
      .eq('brand_id', params.id)
      .maybeSingle()
    if (!existing) return addCorsHeaders(request, NextResponse.json({ error: 'Rate not found' }, { status: 404 }))

    // Merge body over existing, then re-validate the full row.
    const merged: any = { ...existing }
    for (const k of ['provider', 'mode', 'card_type', 'brand_type', 'card_classification', 'min_amount', 'max_amount', 'mdr_value', 'mdr_value_t0', 'min_mdr_value', 'min_mdr_value_t0', 'gst_inclusive']) {
      if (body[k] !== undefined) merged[k] = body[k]
    }
    const { row, error: buildError } = buildRate(merged)
    if (buildError) return addCorsHeaders(request, NextResponse.json({ error: buildError }, { status: 400 }))

    const overlap = await validateBrandRate(
      params.id,
      {
        provider: row.provider,
        mode: row.mode,
        card_type: row.card_type,
        brand_type: row.brand_type,
        card_classification: row.card_classification,
      },
      { min_amount: row.min_amount, max_amount: row.max_amount },
      rateId
    )
    if (overlap) return addCorsHeaders(request, NextResponse.json({ error: overlap }, { status: 400 }))

    const patch: any = { ...row }
    if (body.active !== undefined) patch.active = !!body.active
    const { error } = await supabase.from('brand_mdr_rates').update(patch).eq('id', rateId)
    if (error) return addCorsHeaders(request, NextResponse.json({ error: error.message }, { status: 400 }))

    return addCorsHeaders(request, NextResponse.json({ success: true }))
  } catch (err: any) {
    return addCorsHeaders(request, NextResponse.json({ error: err.message }, { status: 500 }))
  }
}

/** DELETE /api/admin/brands/:id/rates?rateId=... — remove a rate. */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(request)
  if ('error' in auth) {
    return addCorsHeaders(request, NextResponse.json({ error: auth.error }, { status: auth.status }))
  }

  try {
    const rateId = new URL(request.url).searchParams.get('rateId')?.trim()
    if (!rateId) return addCorsHeaders(request, NextResponse.json({ error: 'rateId is required' }, { status: 400 }))

    const supabase = getSupabaseAdmin()
    const { error } = await supabase.from('brand_mdr_rates').delete().eq('id', rateId).eq('brand_id', params.id)
    if (error) return addCorsHeaders(request, NextResponse.json({ error: error.message }, { status: 400 }))

    return addCorsHeaders(request, NextResponse.json({ success: true }))
  } catch (err: any) {
    return addCorsHeaders(request, NextResponse.json({ error: err.message }, { status: 500 }))
  }
}
