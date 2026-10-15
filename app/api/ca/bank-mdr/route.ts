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

function buildRow(body: any): { row?: any; error?: string } {
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
    row: {
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

/** POST /api/ca/bank-mdr */
export async function POST(request: NextRequest) {
  const auth = await requireCA(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const { row, error: buildError } = buildRow(body)
    if (buildError) return NextResponse.json({ error: buildError }, { status: 400 })

    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from('ca_bank_mdr_config')
      .insert({ ...row, created_by: auth.user.email })
      .select(`*, brands:brand_id ( id, key, name, short_name )`)
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true, config: data }, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/** PUT /api/ca/bank-mdr  { id, ...fields } */
export async function PUT(request: NextRequest) {
  const auth = await requireCA(request)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const body = await request.json()
    const id = String(body.id || '').trim()
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    const { row, error: buildError } = buildRow(body)
    if (buildError) return NextResponse.json({ error: buildError }, { status: 400 })

    const supabase = getSupabaseAdmin()
    const { error } = await supabase
      .from('ca_bank_mdr_config')
      .update(row)
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
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
    // Soft-delete (deactivate) so historical reimbursement invoices retain the reference
    const { error } = await supabase
      .from('ca_bank_mdr_config')
      .update({ is_active: false })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
