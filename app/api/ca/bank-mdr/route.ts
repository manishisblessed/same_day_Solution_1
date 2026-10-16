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

const num = (v: any, fallback = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** Reprice existing issued reimbursements for a brand over an effective window.
 *  Best-effort: never blocks the rate save if it fails. */
async function recomputeMdr(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  brandId: string,
  effectiveFrom: string,
  effectiveTo: string | null,
): Promise<number> {
  try {
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase.rpc('ca_recompute_reimbursement_mdr', {
      p_brand_id: brandId,
      p_date_from: effectiveFrom || null,
      p_date_to: effectiveTo || today,
    })
    return Number(data ?? 0)
  } catch (e: any) {
    console.warn('[ca_recompute_reimbursement_mdr]', e?.message || e)
    return 0
  }
}

const CARD_BRANDS = ['VISA', 'MASTER', 'AMEX', 'DINERS', 'RUPAY', '*'] as const

function buildBase(body: any): { base?: any; error?: string } {
  const brand_id = String(body.brand_id || '').trim()
  if (!brand_id) return { error: 'brand_id is required' }

  const tid = body.tid ? String(body.tid).trim() || null : null

  const payment_mode = String(body.payment_mode || '*').toUpperCase()
  if (!['CARD', 'UPI', '*'].includes(payment_mode)) return { error: "payment_mode must be CARD, UPI, or *" }

  const card_type = String(body.card_type || '*').toUpperCase()
  if (!['CREDIT', 'DEBIT', 'PREPAID', '*'].includes(card_type)) return { error: "card_type must be CREDIT, DEBIT, PREPAID, or *" }

  const bank_mdr_percent = num(body.bank_mdr_percent)
  if (bank_mdr_percent < 0 || bank_mdr_percent > 100) return { error: 'bank_mdr_percent must be between 0 and 100' }

  const effective_from = body.effective_from
    ? String(body.effective_from).trim()
    : new Date().toISOString().split('T')[0]

  const effective_to = body.effective_to ? String(body.effective_to).trim() : null

  if (effective_to && effective_to < effective_from) {
    return { error: 'effective_to must be on or after effective_from' }
  }

  return {
    base: {
      brand_id,
      tid,
      payment_mode,
      card_type,
      bank_mdr_percent,
      effective_from,
      effective_to,
      notes: body.notes ? String(body.notes).trim() : null,
      is_active: body.is_active !== undefined ? !!body.is_active : true,
    },
  }
}

/** Resolve `card_brands` → array of normalized brand values. '*' means "any". */
function resolveCardBrands(body: any): { brands?: string[]; error?: string } {
  let raw = body.card_brands
  if (!raw && body.card_brand) raw = [body.card_brand]
  if (!raw || (Array.isArray(raw) && raw.length === 0)) return { brands: ['*'] }

  const arr = (Array.isArray(raw) ? raw : [raw])
    .map((v: any) => String(v || '').trim().toUpperCase())
    .filter(Boolean)

  const bad = arr.find((v) => !CARD_BRANDS.includes(v as any))
  if (bad) return { error: `Invalid card_brand "${bad}". Allowed: ${CARD_BRANDS.join(', ')}` }

  // If '*' is in the list, collapse to just '*'
  if (arr.includes('*')) return { brands: ['*'] }
  return { brands: Array.from(new Set(arr)) }
}

/** GET /api/ca/bank-mdr?brand_id=&tid=&active_only=true */
export async function GET(request: NextRequest) {
  const auth = await requireCA(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const sp = request.nextUrl.searchParams
    const brandId = sp.get('brand_id')?.trim()
    const tid = sp.get('tid')?.trim()
    const activeOnly = sp.get('active_only') !== 'false'

    const supabase = getSupabaseAdmin()
    let q = supabase
      .from('ca_bank_mdr_config')
      .select(`
        *,
        brands:brand_id ( id, key, name, short_name )
      `)
      .order('brand_id')
      .order('tid', { nullsFirst: true })
      .order('effective_from', { ascending: false })

    if (brandId) q = q.eq('brand_id', brandId)
    if (tid) q = q.eq('tid', tid)
    if (activeOnly) q = q.eq('is_active', true)

    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true, configs: data || [] })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/** POST /api/ca/bank-mdr
 *  Accepts `card_brands: string[]` → creates one row per card_brand.
 *  Falls back to `card_brand` / defaults to ['*'] (any brand).
 */
export async function POST(request: NextRequest) {
  const auth = await requireCA(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const { base, error: buildError } = buildBase(body)
    if (buildError) return NextResponse.json({ error: buildError }, { status: 400 })

    const { brands, error: brandErr } = resolveCardBrands(body)
    if (brandErr) return NextResponse.json({ error: brandErr }, { status: 400 })

    const rows = brands!.map((card_brand) => ({
      ...base,
      card_brand,
      created_by: auth.user.email,
    }))

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('ca_bank_mdr_config')
      .insert(rows)
      .select(`*, brands:brand_id ( id, key, name, short_name )`)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    const repriced = await recomputeMdr(supabase, base!.brand_id, base!.effective_from, base!.effective_to)

    return NextResponse.json(
      { success: true, configs: data || [], created: (data || []).length, repriced },
      { status: 201 },
    )
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/** PUT /api/ca/bank-mdr  { id, ...fields }
 *  Edits a single row. `card_brand` (singular) is used for the update.
 */
export async function PUT(request: NextRequest) {
  const auth = await requireCA(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const id = String(body.id || '').trim()
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const { base, error: buildError } = buildBase(body)
    if (buildError) return NextResponse.json({ error: buildError }, { status: 400 })

    const { brands, error: brandErr } = resolveCardBrands(body)
    if (brandErr) return NextResponse.json({ error: brandErr }, { status: 400 })
    const card_brand = (brands && brands[0]) || '*'

    const supabase = getSupabaseAdmin()
    const { error } = await supabase
      .from('ca_bank_mdr_config')
      .update({ ...base, card_brand })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    const repriced = await recomputeMdr(supabase, base!.brand_id, base!.effective_from, base!.effective_to)

    return NextResponse.json({ success: true, repriced })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/** DELETE /api/ca/bank-mdr?id= */
export async function DELETE(request: NextRequest) {
  const auth = await requireCA(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const id = request.nextUrl.searchParams.get('id')?.trim()
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const supabase = getSupabaseAdmin()

    // Capture brand + window before deactivating so we can reprice afterwards.
    const { data: existing } = await supabase
      .from('ca_bank_mdr_config')
      .select('brand_id, effective_from, effective_to')
      .eq('id', id)
      .maybeSingle()

    // Soft-delete (deactivate) so historical reimbursement invoices retain the reference
    const { error } = await supabase
      .from('ca_bank_mdr_config')
      .update({ is_active: false })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    let repriced = 0
    if (existing?.brand_id) {
      repriced = await recomputeMdr(supabase, existing.brand_id, existing.effective_from, existing.effective_to)
    }

    return NextResponse.json({ success: true, repriced })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
